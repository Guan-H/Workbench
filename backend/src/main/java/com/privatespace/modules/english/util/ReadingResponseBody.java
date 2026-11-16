package com.privatespace.modules.english.util;

import java.io.ByteArrayOutputStream;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;

/** Bounds the full HTTP body while keeping HttpRequest timeout active through completion. */
public final class ReadingResponseBody implements HttpResponse.BodySubscriber<byte[]> {
    private static final int LIMIT = 2 * 1024 * 1024;
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private final CompletableFuture<byte[]> result = new CompletableFuture<>();
    private Flow.Subscription subscription;
    @Override public CompletionStage<byte[]> getBody() { return result; }
    @Override public void onSubscribe(Flow.Subscription value) { subscription = value; value.request(1); }
    @Override public void onNext(List<ByteBuffer> buffers) {
        for (ByteBuffer buffer : buffers) {
            if (buffer.remaining() > LIMIT - output.size()) {
                subscription.cancel(); result.completeExceptionally(new IllegalStateException("来源响应超过 2 MiB")); return;
            }
            byte[] bytes = new byte[buffer.remaining()]; buffer.get(bytes); output.writeBytes(bytes);
        }
        subscription.request(1);
    }
    @Override public void onError(Throwable error) { result.completeExceptionally(error); }
    @Override public void onComplete() { result.complete(output.toByteArray()); }
}
