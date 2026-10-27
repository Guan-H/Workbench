package com.privatespace;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.SpringBootApplication;

import static org.assertj.core.api.Assertions.assertThat;

class PrivateSpaceApplicationTests {

    @Test
    void applicationEntryPointDeclaresSpringBootApplication() {
        assertThat(PrivateSpaceApplication.class)
                .hasAnnotation(SpringBootApplication.class);
    }
}
