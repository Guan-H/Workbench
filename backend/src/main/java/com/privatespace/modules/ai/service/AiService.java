package com.privatespace.modules.ai.service;

import com.privatespace.modules.ai.dto.AiRequests.Probe;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Save;
import com.privatespace.modules.ai.dto.AiRequests.Settings;

import java.io.IOException;
import java.util.List;

public interface AiService {
    List<Settings> providers();
    Settings settings(String provider);
    Settings save(String provider, Save request);
    List<Model> discoverModels(String provider);
    Result probe(Probe request, DeltaSink delta) throws IOException;

    @FunctionalInterface
    interface DeltaSink {
        void accept(String text) throws IOException;
    }
}
