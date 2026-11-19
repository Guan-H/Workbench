package com.privatespace.modules.ai.service;

import com.privatespace.modules.ai.dto.AiRequests.Probe;
import com.privatespace.modules.ai.dto.AiRequests.DefaultModel;
import com.privatespace.modules.ai.dto.AiRequests.CreateConnection;
import com.privatespace.modules.ai.dto.AiRequests.Model;
import com.privatespace.modules.ai.dto.AiRequests.ProviderPreset;
import com.privatespace.modules.ai.dto.AiRequests.Result;
import com.privatespace.modules.ai.dto.AiRequests.Save;
import com.privatespace.modules.ai.dto.AiRequests.Settings;

import java.io.IOException;
import java.util.List;

public interface AiService {
    List<Settings> providers();
    List<ProviderPreset> providerPresets();
    Settings createConnection(CreateConnection request);
    void deleteConnection(String provider, String connection, long revision);
    Settings settings(String provider, String connection);
    Settings save(String provider, String connection, Save request);
    List<Model> discoverModels(String provider, String connection);
    DefaultModel defaultModel();
    DefaultModel saveDefaultModel(DefaultModel request);
    Result probe(Probe request, DeltaSink delta) throws IOException;

    @FunctionalInterface
    interface DeltaSink {
        void accept(String text) throws IOException;
    }
}
