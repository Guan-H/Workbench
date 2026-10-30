FROM maven:3.9-eclipse-temurin-17-alpine@sha256:b7c8d7298dbabbe750441736cd99a1d120a58083d5af8d2bd75a1624cfdd8f3a AS build

WORKDIR /workspace
COPY backend/pom.xml backend/pom.xml
COPY database/migrations database/migrations
RUN mvn -f backend/pom.xml -DskipTests dependency:go-offline --no-transfer-progress

COPY backend/src backend/src
RUN mvn -f backend/pom.xml -DskipTests package --no-transfer-progress

FROM eclipse-temurin:17-jre-alpine@sha256:c4a33e6ddb738fe4be0a28a613ea0940cec42d25d7263c3e2238c43354cb19b0

RUN addgroup -S privatespace && adduser -S -G privatespace privatespace \
    && mkdir -p /app /data/objects \
    && chown -R privatespace:privatespace /app /data
WORKDIR /app
COPY --from=build --chown=privatespace:privatespace /workspace/backend/target/private-space-backend-0.1.0-SNAPSHOT.jar /app/app.jar
COPY --chmod=755 backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
