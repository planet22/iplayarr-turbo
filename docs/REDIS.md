# Redis

iPlayarr uses Redis as its only persistent data store — there's no separate SQL/NoSQL database. Whether you use the bundled instance or point at an external one, Redis holds everything iPlayarr remembers between restarts.

## Bundled vs external

By default, the Docker image starts its own `redis-server` (`docker_entry.sh`), vendored from the `redis:8-alpine3.23` image at build time (`Dockerfile`). No setup needed — it runs alongside the app in the same container and persists to `/config` via `redis-server --dir /config`.

To use a standalone/external Redis instead, set these (env-only — read directly from `process.env` in `src/service/redis/redisService.ts`, before `configService` itself is available, so they can't be set through the Settings UI):

| Variable | Default | Notes |
| --- | --- | --- |
| `REDIS_HOST` | `127.0.0.1` | Hostname/IP of the external instance. |
| `REDIS_PORT` | `6379` | — |
| `REDIS_PASSWORD` | _(unset)_ | Optional. |
| `REDIS_SSL` | _(unset)_ | Set to `true` to connect over TLS. |

If `REDIS_HOST` is set, `docker_entry.sh` skips starting the bundled instance entirely — iPlayarr assumes you've pointed it somewhere real and reachable.

For local development, `npm run serve:redis` brings up a throwaway Redis via `docker-compose.redis.yml` (`redis:8-alpine3.23`, port `6379`, no persistence volume) — fine for dev, not meant for anything you want to keep.

## What's actually stored in Redis

- **Config** (`configService`) — every setting you change in the Settings UI, under a single `config` key (`QueuedStorage` wrapper).
- **Queue and download state** (`queueService`, `historyService`) — in-progress downloads, completed history, and (when `ARCHIVE_ENABLED=true`) archived cancelled/removed entries.
- **Sessions** (`connect-redis`, prefix `iplayarr:`) — login sessions for the web UI. See [AUTHENTICATION.md](AUTHENTICATION.md).
- **Logs** (`loggingService`) — the most recent 250 log lines (`iplayarr_logs` list, trimmed on every push), used to populate the Logs page on load before new lines stream in over Socket.IO.
- **Apps, User-Agent mappings, synonyms, statistics, thumbnail cache metadata, native streaming session history** — all the other frontend-managed state surfaced under `/json-api`.

If Redis is unreachable, the `/ping` healthcheck endpoint reports `503` with the underlying error message (`src/server.ts`) — this is what Docker's `HEALTHCHECK`/your monitoring should be watching.

## Persistence (bundled instance)

The bundled `redis-server` is started with `--dir /config`, so its RDB snapshot lives on whatever volume you've mounted at `/config` (see [INSTALLATION.md](INSTALLATION.md) for the standard volume layout). As long as that volume persists across container recreation, config, queue/history, sessions, and everything else above survives restarts and upgrades.

**Backup**: back up the `/config` volume (it contains the Redis RDB file) the same way you'd back up any other bind-mounted directory — stop the container, copy the directory, restart. There's no in-app export/import; the config and queue state live entirely in that one Redis data file.

**Restore**: stop the container, replace the `/config` directory's contents with your backup, start the container again. A fresh `/config` with no existing Redis data just means a fresh install — iPlayarr will auto-generate a new `API_KEY`/`STREAM_KEY` and fall back to default auth credentials, same as a brand-new deployment.

If you use an external Redis instead, back that instance up using its own normal backup mechanism (RDB/AOF snapshots, managed-service backups, etc.) — iPlayarr has no opinion on how that's done, it only holds a connection to it.
