package com.privatespace.modules.settings.service;

import com.privatespace.modules.settings.dto.AppearanceDtos.*;
import org.springframework.web.multipart.MultipartFile;

public interface AppearanceService {
    Saved read();
    Saved save(Write request);
    Image upload(MultipartFile file);
    byte[] image(String id);
    java.util.List<String> listImages();
}
