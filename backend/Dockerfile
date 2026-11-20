FROM maven:3.9-eclipse-temurin-17-alpine@sha256:b7c8d7298dbabbe750441736cd99a1d120a58083d5af8d2bd75a1624cfdd8f3a AS build

WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY database/migrations database/migrations
RUN mvn -f backend/pom.xml -DskipTests dependency:go-offline --no-transfer-progress

COPY backend/src backend/src
RUN mvn -f backend/pom.xml -DskipTests package --no-transfer-progress

FROM eclipse-temurin:17-jre-alpine@sha256:c4a33e6ddb738fe4be0a28a613ea0940cec42d25d7263c3e2238c43354cb19b0

# The x86-64 image needs the Java4Shell fix while the official image tag catches up.
RUN set -eu; \
    if [ "$(apk --print-arch)" = x86_64 ]; then \
        archive="$(mktemp)"; \
        patched_jre="$(mktemp -d)"; \
        wget -q -O "$archive" 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.21.1%2B2/OpenJDK17U-jre_x64_alpine-linux_hotspot_17.0.21.1_2.tar.gz'; \
        echo "99fabb8e2517861fbbf1fc26103ee62240ec693340c4c7a812f7043e82acb203  $archive" | sha256sum -c -; \
        tar -xzf "$archive" --strip-components=1 -C "$patched_jre"; \
        if [ -L "$JAVA_HOME/lib/security/cacerts" ]; then \
            ln -sfn "$(readlink "$JAVA_HOME/lib/security/cacerts")" "$patched_jre/lib/security/cacerts"; \
        fi; \
        chmod 755 "$patched_jre"; \
        rm -rf "$JAVA_HOME"; \
        mv "$patched_jre" "$JAVA_HOME"; \
        rm "$archive"; \
        test -s "$JAVA_HOME/lib/security/cacerts"; \
        java -version; \
    fi

RUN addgroup -S privatespace && adduser -S -G privatespace privatespace \
    && mkdir -p /app /data/objects \
    && chown -R privatespace:privatespace /app /data
WORKDIR /app
COPY --from=build --chown=privatespace:privatespace /workspace/backend/target/private-space-backend-0.1.0-SNAPSHOT.jar /app/app.jar
COPY --chmod=755 backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
