package com.privatespace;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication(exclude = org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration.class)
public class PrivateSpaceApplication {

    public static void main(String[] args) {
        SpringApplication.run(PrivateSpaceApplication.class, args);
    }
}
