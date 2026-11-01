#!/bin/sh
set -e

# Older versions kept all data in a bundled Redis (/config/dump.rdb). If that file is still there and
# no SQLite database exists yet, start Redis briefly on loopback so the app can import it once.
if [ -z "$REDIS_HOST" ] && [ -f /config/dump.rdb ] && [ ! -f /config/iplayarr.db ]; then
    echo "Found legacy Redis data in /config/dump.rdb - starting Redis temporarily for a one-time import"
    /redis/redis-server --dir /config --bind 127.0.0.1 --save "" --appendonly no --daemonize yes
    export REDIS_IMPORT_HOST=127.0.0.1
    export REDIS_IMPORT_SHUTDOWN=true
fi

PUID=${PUID:-1000}
PGID=${PGID:-1000}
USERNAME="iplayarr"

echo "Starting container with UID:$PUID and GID:$PGID"

EXISTING_GROUP=$(getent group "$PGID" | cut -d: -f1)
if [ -z "$EXISTING_GROUP" ]; then
    GROUPNAME="$USERNAME"
    addgroup -g "$PGID" "$GROUPNAME"
else
    GROUPNAME="$EXISTING_GROUP"
fi

EXISTING_USER=$(getent passwd "$PUID" | cut -d: -f1)
if [ -z "$EXISTING_USER" ]; then
    adduser -D -u "$PUID" -G "$GROUPNAME" "$USERNAME"
    EXISTING_USER="$USERNAME"
fi

if [ -n "$STORAGE_LOCATION" ] && [ -d "$STORAGE_LOCATION" ]; then
    chown -R "${EXISTING_USER}":"${GROUPNAME}" "${STORAGE_LOCATION}" || { echo "Failed to change ownership of ${STORAGE_LOCATION} to ${PUID}:${PGID}"; exit 1; }
else
    echo "STORAGE_LOCATION is not set or does not exist"
    exit 1
fi

if [ -n "$CACHE_LOCATION" ] && [ -d "$CACHE_LOCATION" ]; then
    chown -R "${EXISTING_USER}":"${GROUPNAME}" "${CACHE_LOCATION}" || { echo "Failed to change ownership of ${CACHE_LOCATION} to ${PUID}:${PGID}"; exit 1; }
else
    echo "CACHE_LOCATION is not set or does not exist"
    exit 1
fi

if [ -n "$LOG_DIR" ] && [ -d "$LOG_DIR" ]; then
    chown -R "${EXISTING_USER}":"${GROUPNAME}" "${LOG_DIR}" || { echo "Failed to change ownership of ${LOG_DIR} to ${PUID}:${PGID}"; exit 1; }
else
    echo "LOG_DIR is not set or does not exist"
    exit 1
fi

if [ -d /config ]; then
    chown -R "${EXISTING_USER}":"${GROUPNAME}" /config || { echo "Failed to change ownership of /config to ${PUID}:${PGID}"; exit 1; }
fi

find /app -name "node_modules" -prune -o \! -user "$PUID" \! -group "$PGID" -exec chown "${EXISTING_USER}":"${GROUPNAME}" {} +
exec su-exec "$EXISTING_USER" "$@"
