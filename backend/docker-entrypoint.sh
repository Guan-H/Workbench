#!/bin/sh
set -eu

export DB_PASSWORD="$(cat /run/secrets/DB_PASSWORD)"
export PRIVATE_SPACE_SETUP_TOKEN="$(cat /run/secrets/PRIVATE_SPACE_SETUP_TOKEN)"

exec su -m -s /bin/sh privatespace -c \
    'exec java -XX:MaxRAMPercentage=70.0 -Djava.security.egd=file:/dev/urandom -jar /app/app.jar'
