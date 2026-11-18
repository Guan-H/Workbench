package com.privatespace.modules.ai.service.impl;

import com.privatespace.common.exception.ApiException;
import com.privatespace.modules.ai.dto.AiChat.Conversation;
import com.privatespace.modules.ai.dto.AiChat.Detail;
import com.privatespace.modules.ai.dto.AiChat.Message;
import com.privatespace.modules.ai.dto.AiChat.Pin;
import com.privatespace.modules.ai.dto.AiChat.Regenerate;
import com.privatespace.modules.ai.dto.AiChat.Rename;
import com.privatespace.modules.ai.dto.AiChat.Send;
import com.privatespace.modules.ai.dto.AiChat.Turn;
import com.privatespace.modules.ai.mapper.AiChatMapper;
import com.privatespace.modules.ai.service.AiChatService;
import jakarta.annotation.PreDestroy;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;
import java.util.function.Supplier;

@Service
public class AiChatServiceImpl implements AiChatService {
    private static final int MAX_CONTEXT_CHARS = 100_000;
    private final AiChatMapper mapper;
    private final AiServiceImpl ai;
    private final TransactionTemplate transactions;
    private final Semaphore capacity = new Semaphore(2);
    private final java.util.concurrent.ExecutorService workers = Executors.newFixedThreadPool(2, task -> {
        Thread thread = new Thread(task, "ai-chat-generation");
        thread.setDaemon(true);
        return thread;
    });
    private final ConcurrentHashMap<String, FutureTask<Void>> running = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, LiveReply> liveReplies = new ConcurrentHashMap<>();

    AiChatServiceImpl(AiChatMapper mapper, AiServiceImpl ai, TransactionTemplate transactions) {
        this.mapper = mapper;
        this.ai = ai;
        this.transactions = transactions;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void recoverInterruptedTurns() {
        // Workbench runs a single backend. Never resend a generation left by the previous process.
        mapper.interruptPreviousRun();
    }

    @PreDestroy
    void close() {
        workers.shutdownNow();
    }

    @Override
    public List<Conversation> list(int page, String query) {
        if (page < 1 || page > 100_000 || query.length() > 100) throw invalid();
        return mapper.list(query.strip(), (page - 1) * 30);
    }

    @Override
    public Conversation create() {
        String id = UUID.randomUUID().toString();
        mapper.create(id);
        return mapper.find(id);
    }

    @Override
    @Transactional
    public Conversation rename(String conversationId, Rename request) {
        String title = required(request.title(), 100);
        Conversation chat = lockCurrent(conversationId, request.revision());
        mapper.rename(chat.id(), title);
        return mapper.find(chat.id());
    }

    @Override
    @Transactional
    public Conversation pin(String conversationId, Pin request) {
        if (request.pinned() == null) throw invalid();
        Conversation chat = lockCurrent(conversationId, request.revision());
        if (chat.pinned() == request.pinned()) return chat;
        mapper.pin(chat.id(), request.pinned());
        return mapper.find(chat.id());
    }

    @Override
    public void delete(String conversationId, int revision) {
        List<String> answers = transactions.execute(status -> {
            Conversation chat = lockCurrent(conversationId, revision);
            List<String> ids = mapper.versions(chat.id()).stream().map(version -> version.answerId()).toList();
            // Both turns and answer versions cascade. Workers only UPDATE existing answers, never recreate them.
            mapper.delete(chat.id());
            return ids;
        });
        if (answers != null) {
            for (String id : answers) {
                LiveReply live = liveReplies.remove(id);
                if (live != null) live.discard();
                cancel(id);
            }
        }
    }

    private Conversation lockCurrent(String conversationId, int revision) {
        Conversation chat = mapper.lock(id(conversationId));
        if (chat == null) throw missing();
        checkRevision(chat, revision);
        return chat;
    }

    @Override
    @Transactional(readOnly = true)
    public Detail detail(String conversationId) {
        Conversation conversation = mapper.find(id(conversationId));
        if (conversation == null) throw missing();
        return new Detail(conversation, mapper.turns(conversation.id()), mapper.versions(conversation.id()),
                mapper.activeAnswer(conversation.id()));
    }

    @Override
    public Turn answer(String conversationId, String answerId) {
        Turn turn = mapper.answer(id(conversationId), id(answerId));
        if (turn == null) throw missing();
        return turn;
    }

    @Override
    public Turn send(String conversationId, Send request) {
        String chatId = id(conversationId);
        String turnId = id(request.id());
        String text = required(request.text(), 8000);
        String model = required(request.modelId(), 160);
        AiProvider provider = AiProvider.from(request.providerId());
        return start(chatId, turnId, () -> replaySend(mapper.answer(chatId, turnId), text, model, provider),
                chat -> prepare(chat, turnId, null, request.revision(), text, model, provider, request.confirmedProviderId()));
    }

    @Override
    public Turn regenerate(String conversationId, String turnId, Regenerate request) {
        String chatId = id(conversationId);
        String target = id(turnId);
        String answerId = id(request.id());
        String model = required(request.modelId(), 160);
        AiProvider provider = AiProvider.from(request.providerId());
        return start(chatId, answerId, () -> replayRegenerate(mapper.answer(chatId, answerId), target, model, provider),
                chat -> prepare(chat, answerId, target, request.revision(), null, model, provider, request.confirmedProviderId()));
    }

    private Turn start(String chatId, String answerId, Supplier<Turn> replay, Function<Conversation, Prepared> prepare) {
        Turn existing = replay.get();
        if (existing != null) return existing;
        if (!capacity.tryAcquire()) throw new ApiException(429, "AI_CHAT_BUSY", "AI 生成繁忙，请稍后再发送。");
        boolean submitted = false;
        try {
            Prepared prepared = transactions.execute(status -> {
                Conversation chat = mapper.lock(chatId);
                if (chat == null) throw missing();
                Turn receipt = replay.get();
                return receipt == null ? prepare.apply(chat) : new Prepared(receipt, null, List.of());
            });
            if (prepared.source() == null) return prepared.turn();
            launch(prepared);
            submitted = true;
            return prepared.turn();
        } catch (RejectedExecutionException ignored) {
            mapper.end(answerId, "interrupted", "服务正在重启，请稍后重试。", null);
            return answer(chatId, answerId);
        } finally {
            if (!submitted) capacity.release();
        }
    }

    private Prepared prepare(Conversation chat, String answerId, String regenerateTurnId, int revision,
                             String text, String model, AiProvider provider, String confirmedProvider) {
        requireCurrent(chat, revision);
        String chatId = chat.id();
        List<Turn> history = mapper.turns(chatId);
        Turn previous = history.isEmpty() ? null : history.get(history.size() - 1);
        boolean regenerate = regenerateTurnId != null;
        if (regenerate) {
            requireLast(previous, regenerateTurnId);
            text = previous.prompt();
        }
        // Check before a generation is inserted or any text can leave the server.
        boolean crossesProvider = previous != null && (!provider.id.equals(chat.providerId())
                || history.stream().anyMatch(turn -> !provider.id.equals(turn.providerId())));
        if (crossesProvider && !provider.id.equals(confirmedProvider)) {
            throw new ApiException(409, "AI_HISTORY_CONFIRMATION_REQUIRED", "请先确认将相关对话历史发送给 " + provider.label + "。");
        }
        int position = regenerate ? previous.position() : previous == null ? 1 : previous.position() + 1;
        int version = regenerate ? mapper.lastVersion(regenerateTurnId) + 1 : 1;
        if (regenerate) history = history.subList(0, history.size() - 1);
        List<Message> messages = context(history, text);
        var source = ai.chatSource(provider, model);
        Turn next = new Turn(regenerate ? regenerateTurnId : answerId, chatId, position, text, "", source.provider(), model,
                null, "generating", null, null, null, null, answerId, version, revision + 1, provider.id);
        if (!regenerate) mapper.insertTurn(next);
        mapper.insertAnswer(next);
        mapper.advance(chatId, model, provider.id, !regenerate && position == 1 ? title(text) : null);
        return new Prepared(next, source, messages);
    }

    @Override
    @Transactional
    public Detail selectAnswer(String conversationId, String turnId, String answerId, int revision) {
        String chatId = id(conversationId);
        Conversation chat = mapper.lock(chatId);
        if (chat == null) throw missing();
        requireCurrent(chat, revision);
        List<Turn> history = mapper.turns(chatId);
        Turn last = history.isEmpty() ? null : history.get(history.size() - 1);
        requireLast(last, id(turnId));
        Turn selected = answer(chatId, answerId);
        if (!selected.id().equals(turnId)) throw missing();
        if (!selected.answerId().equals(last.answerId())) {
            if (selected.reply().isBlank() || !("complete".equals(selected.status()) || "truncated".equals(selected.status()))) {
                throw new ApiException(409, "AI_ANSWER_NOT_SELECTABLE", "只有已完成且有内容的回答可以用于后续对话。");
            }
            mapper.selectAnswer(turnId, selected.answerId());
            mapper.advance(chatId, chat.modelId(), chat.providerId(), null);
        }
        return detail(chatId);
    }

    private void requireCurrent(Conversation chat, int revision) {
        checkRevision(chat, revision);
        if (mapper.activeAnswer(chat.id()) != null) {
            throw new ApiException(409, "AI_CHAT_GENERATING", "这段会话已有回复正在生成。");
        }
    }

    private static void checkRevision(Conversation chat, int revision) {
        if (chat.revision() != revision) {
            throw new ApiException(409, "AI_CHAT_CONFLICT", "会话已更新，请重新读取后重试。");
        }
    }

    private static void requireLast(Turn last, String turnId) {
        if (last == null || !last.id().equals(turnId)) {
            throw new ApiException(409, "AI_ANSWER_NOT_LAST", "仅最后一轮可重新生成或改选回答。");
        }
    }

    private void launch(Prepared prepared) {
        String id = prepared.turn().answerId();
        LiveReply live = new LiveReply();
        liveReplies.put(id, live);
        var task = new FutureTask<Void>(() -> { generate(prepared); return null; });
        running.put(id, task);
        try {
            workers.execute(() -> {
                try { task.run(); }
                finally {
                    live.finish();
                    liveReplies.remove(id, live);
                    running.remove(id, task);
                    capacity.release();
                }
            });
        } catch (RejectedExecutionException error) {
            live.finish();
            liveReplies.remove(id, live);
            running.remove(id, task);
            throw error;
        }
    }

    private void generate(Prepared prepared) {
        Turn next = prepared.turn();
        long started = System.nanoTime();
        try {
            if (!"generating".equals(answer(next.conversationId(), next.answerId()).status())) return;
            var result = ai.streamChat(prepared.source(), next.modelId(), prepared.messages(), text -> {
                if (mapper.append(next.answerId(), text) == 0) throw new IOException("Generation already ended");
                LiveReply live = liveReplies.get(next.answerId());
                if (live != null) live.append(text);
            });
            mapper.complete(next.answerId(), result, result.usage() == null ? null : result.usage().totalTokens());
        } catch (ApiException error) {
            String state = "AI_STREAM_INTERRUPTED".equals(error.code()) ? "interrupted" : "failed";
            mapper.end(next.answerId(), state, error.getMessage(), elapsed(started));
        } catch (IOException error) {
            mapper.end(next.answerId(), "interrupted", "回复连接已中断。", elapsed(started));
        } catch (RuntimeException error) {
            mapper.end(next.answerId(), "failed", "无法保存生成结果，请稍后重试。", elapsed(started));
        }
    }

    @Override
    public Turn stop(String conversationId, String answerId) {
        Turn turn = answer(conversationId, answerId);
        if (mapper.end(turn.answerId(), "stopped", null, null) == 1) {
            cancel(turn.answerId());
            LiveReply live = liveReplies.get(turn.answerId());
            if (live != null) live.finish();
        }
        return answer(conversationId, answerId);
    }

    private void cancel(String answerId) {
        FutureTask<Void> task = running.get(answerId);
        if (task != null) task.cancel(true);
    }

    @Override
    public void stream(String conversationId, String answerId, StreamSink sink) throws IOException {
        Turn initial = answer(conversationId, answerId);
        sink.snapshot(initial);
        if (!"generating".equals(initial.status())) return;
        LiveReply live = liveReplies.get(answerId);
        if (live == null) {
            finalSnapshot(initial, sink);
            return;
        }
        int offset = initial.reply().length();
        for (;;) {
            LiveSlice slice = live.next(offset);
            if (slice.deleted()) {
                sink.deleted();
                return;
            }
            if (!slice.text().isEmpty()) {
                sink.delta(offset, slice.text());
                offset += slice.text().length();
            } else if (!slice.finished()) {
                sink.heartbeat();
            }
            if (slice.finished()) {
                finalSnapshot(initial, sink);
                return;
            }
        }
    }

    private void finalSnapshot(Turn initial, StreamSink sink) throws IOException {
        Turn current = mapper.answer(initial.conversationId(), initial.answerId());
        if (current == null) sink.deleted();
        else sink.snapshot(current);
    }

    private record LiveSlice(String text, boolean finished, boolean deleted) {}

    private static final class LiveReply {
        private final StringBuilder text = new StringBuilder();
        private boolean finished;
        private boolean deleted;

        synchronized void append(String chunk) {
            if (deleted) return;
            text.append(chunk);
            notifyAll();
        }

        synchronized void finish() {
            finished = true;
            notifyAll();
        }

        synchronized void discard() {
            deleted = true;
            text.setLength(0);
            finish();
        }

        synchronized LiveSlice next(int offset) throws IOException {
            if (text.length() <= offset && !finished) {
                try {
                    wait(15_000);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new IOException("Stream reader interrupted");
                }
            }
            return new LiveSlice(offset < text.length() ? text.substring(offset) : "", finished, deleted);
        }
    }

    private static List<Message> context(List<Turn> history, String text) {
        var messages = new ArrayList<Message>();
        long chars = text.length();
        for (Turn turn : history) {
            chars += turn.prompt().length() + turn.reply().length();
            if (chars > MAX_CONTEXT_CHARS) {
                throw new ApiException(400, "AI_CONTEXT_LIMIT", "会话文字超过 10 万字符，请新建会话继续。");
            }
            messages.add(new Message("user", turn.prompt()));
            if (!turn.reply().isBlank()) messages.add(new Message("assistant", turn.reply()));
        }
        messages.add(new Message("user", text));
        return List.copyOf(messages);
    }

    private static Turn replaySend(Turn turn, String text, String model, AiProvider provider) {
        if (turn != null && (turn.version() != 1 || !turn.prompt().equals(text) || !turn.modelId().equals(model)
                || !turn.providerId().equals(provider.id))) {
            throw reused();
        }
        return turn;
    }

    private static Turn replayRegenerate(Turn turn, String target, String model, AiProvider provider) {
        if (turn != null && (turn.version() == 1 || !turn.id().equals(target) || !turn.modelId().equals(model)
                || !turn.providerId().equals(provider.id))) {
            throw reused();
        }
        return turn;
    }

    private static ApiException reused() {
        return new ApiException(409, "AI_CHAT_REQUEST_REUSED", "此请求编号已用于不同内容。");
    }

    private static String title(String text) {
        String line = text.lines().findFirst().orElse("新会话").strip();
        int end = line.offsetByCodePoints(0, Math.min(line.codePointCount(0, line.length()), 42));
        return line.substring(0, end);
    }

    private static String id(String value) {
        if (value == null || !value.matches("[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}")) throw invalid();
        return value;
    }

    private static String required(String value, int length) {
        if (value == null || value.isBlank() || value.length() > length) throw invalid();
        return value.strip();
    }

    private static long elapsed(long started) {
        return TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    }

    private static ApiException missing() {
        return new ApiException(404, "AI_CHAT_NOT_FOUND", "会话或消息不存在。");
    }

    private static ApiException invalid() {
        return new ApiException(400, "AI_CHAT_INVALID", "请检查会话、模型及消息内容。");
    }

    private record Prepared(Turn turn, AiServiceImpl.ChatSource source, List<Message> messages) {}
}
