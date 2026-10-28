package com.privatespace.modules.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CredentialsRequest(@NotBlank @Size(max = 80) String username,
                                 @NotBlank @Size(max = 72) String password,
                                 String setupToken) {
}
