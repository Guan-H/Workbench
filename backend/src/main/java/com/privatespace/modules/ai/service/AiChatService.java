package com.privatespace.modules.ai.service;

import com.privatespace.modules.ai.dto.AiChat.Conversation;
import com.privatespace.modules.ai.dto.AiChat.Detail;
import com.privatespace.modules.ai.dto.AiChat.Regenerate;
import com.privatespace.modules.ai.dto.AiChat.Pin;
import com.privatespace.modules.ai.dto.AiChat.Rename;
import com.privatespace.modules.ai.dto.AiChat.Send;
import com.privatespace.modules.ai.dto.AiChat.Turn;
import java.util.List;
import java.io.IOException;

public interface AiChatService {
    List<Conversation> list(int page, String query);
    Conversation create();
    Conversation rename(String conversationId, Rename request);
    Conversation pin(String conversationId, Pin request);
    void delete(String conversationId, int revision);
    Detail detail(String conversationId);
    Turn answer(String conversationId, String answerId);
    Turn send(String conversationId, Send request);
    Turn regenerate(String conversationId, String turnId, Regenerate request);
    Detail selectAnswer(String conversationId, String turnId, String answerId, int revision);
    Turn stop(String conversationId, String answerId);
    void stream(String conversationId, String answerId, StreamSink sink) throws IOException;

    interface StreamSink {
        void snapshot(Turn turn) throws IOException;
        void delta(int offset, String text) throws IOException;
        void heartbeat() throws IOException;
        void deleted() throws IOException;
    }
}
