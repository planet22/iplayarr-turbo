# Database

iPlayarr stores everything it remembers between restarts in a single embedded SQLite file, accessed through [Prisma](https://www.prisma.io/) (`@prisma/client` with the `better-sqlite3` driver adapter). There is no separate database server to run, configure or secure. (Older versions used Redis; see [Upgrading from Redis](#upgrading-from-redis).)

## Where the file lives

| Setting | Default | Notes |
| --- | --- | --- |
| `DATABASE_URL` | `file:/config/iplayarr.db` in Docker, `file:./config/iplayarr.db` otherwise | Env-only. Any Prisma SQLite URL (`file:/path/to/iplayarr.db`). |
| `CONFIG_LOCATION` | `/config` if it exists, else `./config` | Used only when `DATABASE_URL` is unset; the file is `<CONFIG_LOCATION>/iplayarr.db`. |

These are read directly from `process.env` in `src/service/db/prismaService.ts`, before `configService` is available, so they can't be set through the Settings UI. The directory is created if it does not exist, and the tables are created automatically on first start (the statements are idempotent, so there is no migration step to run). SQLite runs in WAL mode, so you will also see `iplayarr.db-wal` and `iplayarr.db-shm` next to the file while the app is running.

## What's stored

The schema is in `prisma/schema.prisma`. Four tables:

- **`KeyValue`** — settings and app state written through `QueuedStorage`: every Settings UI value under the `config` key, apps, User-Agent mappings, synonyms, queue and history, subscriptions (see [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)), live-TV channels, STRM and stream state. Also the cookie-signing secret (`iplayarr:session_secret`) and the process uptime.
- **`Cache`** — short-lived copies of remote data with an expiry: search results, the schedule, Skyhook lookups, iPlayer metadata and Browse listings (see [BROWSE.md](BROWSE.md)). Safe to lose; they refill on demand. Expired rows are removed when read.
- **`QueueItem`** — capped lists: search, grab and failed-grab history (500/500/200 entries) and the last 250 log lines used to fill the Logs page on load.
- **`Session`** — web UI login sessions (see [AUTHENTICATION.md](AUTHENTICATION.md)), so sessions survive a restart. Expired sessions are purged hourly.

If the database cannot be opened, the `/ping` healthcheck returns `503` with the underlying error (`src/server.ts`).

## Backup and restore

**Backup**: stored credentials are encrypted with a key that is *not* in the database (`SECRETS_KEY`, or the generated `secrets.key` in `CACHE_LOCATION`, `/data` in Docker). Back that up too, or restored credentials will be unreadable. To back up the database, stop the container and copy the `/config` directory (the `-wal`/`-shm` files are empty after a clean stop). Copying while the app is running can miss recent writes in the WAL file. There is no in-app export/import.

**Restore**: stop the container, put the backed-up `iplayarr.db` back in `/config`, start the container. A fresh, empty `/config` just means a fresh install: iPlayarr generates a new `API_KEY`/`STREAM_KEY` and a new random web UI password, as for any new deployment.

## Upgrading from Redis

Earlier versions kept this data in Redis. On the first start of a version that uses SQLite, iPlayarr copies it across once, automatically:

- **Bundled Redis (the default)**: if `/config/dump.rdb` exists and there is no `iplayarr.db` yet, the container briefly starts a temporary Redis on `127.0.0.1` solely to read it, imports, then shuts that Redis down. Nothing else is needed; keep your existing `/config` mount.
- **External Redis**: set `REDIS_HOST` (and `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_SSL` if you used them) for the first start only. After the import is logged (`Imported N settings/records and M queue items from Redis`), remove them.

What is imported: settings, apps, subscriptions, queue/history, mappings, synonyms, and the search/grab/failed-grab history and log lines. What is not: caches (they refill), sessions (everyone signs in again once) and uptime. The import only runs into an empty database and only once; it never overwrites existing data. If Redis cannot be reached, the app logs that and starts normally with an empty database. The old `dump.rdb` is left untouched in case you want to go back.

The `REDIS_*` variables have no effect after the import and are no longer used during normal operation.
