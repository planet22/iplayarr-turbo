# Installation (Docker deployment, in depth)

This expands on the quick-start in the main [README.md](../README.md). iPlayarr ships only as a container — there's no bare-metal install path, since it depends on `get_iplayer`, `yt-dlp`, `ffmpeg`, and Perl modules baked into the image (`Dockerfile`).

## Images

- `ghcr.io/planet22/iplayarr-turbo:latest` — the published image, built from the `runtime` stage (production-only `node_modules`, no compiler toolchain, no source — see [DEVELOPMENT.md](DEVELOPMENT.md) and [TURBO.md](../TURBO.md) for the build's internals).
- Build it yourself with `docker build -t iplayarr .` from the repo root if you want a local image instead (e.g. to track `main`/`dev-work` ahead of a published tag).

## Running it

Minimal `docker run`:

```bash
docker run -d --name iplayarr \
  -v ./cache:/data \
  -v ./config:/config \
  -v ./logs:/logs \
  -v /path/to/incomplete:/incomplete \
  -v /path/to/complete:/complete \
  --env-file=env-file \
  -p 4404:4404 \
  ghcr.io/planet22/iplayarr-turbo:latest
```

Or Docker Compose:

```yaml
services:
    iplayarr:
        image: 'ghcr.io/planet22/iplayarr-turbo:latest'
        container_name: 'iplayarr'
        environment:
            - 'API_KEY=1234'
            - 'DOWNLOAD_DIR=/mnt/media/iplayarr/incomplete'
            - 'COMPLETE_DIR=/mnt/media/iplayarr/complete'
            - 'PUID=1000'
            - 'PGID=1000'
        ports:
            - '4404:4404'
        volumes:
            - '/mnt/media:/mnt/media'
            - './cache:/data'
            - './config:/config'
            - './logs:/logs'
```

(This repo's own `docker-compose.redis.yml` is dev tooling only — a throwaway local Redis for `npm run serve:redis`, not a deployment template. There's no other docker-compose file checked into the repository; any other compose file you might find alongside a working copy is personal/gitignored deployment config, not something this doc should assume.)

## Typical real-world setup

A more realistic deployment than the minimal example above, for anyone running Sonarr/Radarr on a NAS-based Docker host. The pieces that differ from the minimal example:

**iPlayer is only reachable from a UK-based network/IP.** If your Docker host isn't itself UK-based, iPlayarr needs to reach the internet from one, by whatever means you'd normally use to give a single container a UK egress (a UK-based host, a routed subnet, etc.) — that's outside the scope of this doc; just make sure whatever you use doesn't change the container's exposed port or the paths below.

```yaml
# docker-compose.yaml
services:
    iplayarr:
        image: 'ghcr.io/planet22/iplayarr-turbo:latest'
        container_name: iplayarr
        environment:
            - 'API_KEY=${IPLAYERARR_API_KEY}'
            - 'DOWNLOAD_DIR=/data/downloads/iplayarr/incomplete'
            - 'COMPLETE_DIR=/data/downloads/iplayarr/complete'
            - 'PUID=${USER_ID}'
            - 'PGID=${GROUP_ID}'
            - 'TZ=${TIMEZONE}'
        ports:
            - '4404:4404'
        volumes:
            - '${DATA_ROOT}/downloads:/data/downloads'
            - '${CONFIG_ROOT}/cache:/data'
            - '${CONFIG_ROOT}/config:/config'
            - '${CONFIG_ROOT}/logs:/logs'
        restart: unless-stopped
```

Points worth calling out:

- **Use absolute host paths in `.env`** (`CONFIG_ROOT=/volume1/docker/iplayarr`, `DATA_ROOT=/volume1/media`), not relative (`./...`) ones, if this stack is managed by any tool that rewrites relative paths on deploy (Portainer, Dockhand, etc.) — a path that's only relative after variable substitution (e.g. `${CONFIG_ROOT:-.}/cache`) can silently resolve against that tool's own internal working directory instead of the real host path.
- **`PUID`/`PGID` from `.env`** (`USER_ID`/`GROUP_ID`), matching the UID/GID that owns the media library on the host — see [PUID / PGID](#puid--pgid) below.
- Because all persistent state is in Redis under `/config` (see [REDIS.md](REDIS.md)), the stack can be freely recreated/rebuilt without losing settings, queue/history, or sessions.

## Volume mounts explained

| Container path | Purpose | Backed by |
| --- | --- | --- |
| `/data` | `get_iplayer`'s own cache/profile directory (`--profile-dir`, set via the baked-in `CACHE_LOCATION` env var) — programme metadata cache, not your media. | `CACHE_LOCATION=/data` (Dockerfile) |
| `/config` | Redis's data directory (`redis-server --dir /config`) — this is where **all** persistent state lives: settings, queue/history, sessions, logs ring-buffer. See [REDIS.md](REDIS.md). | `docker_entry.sh` |
| `/logs` | Rotated daily log files (`winston-daily-rotate-file`, 20MB/file, 14 days retention, gzip-archived). | `LOG_DIR=/logs` (Dockerfile) |
| `/incomplete` (your path, mapped to `DOWNLOAD_DIR`) | In-progress downloads. Must also be visible to Sonarr/Radarr at a path they recognize if you're using full downloads (not `.strm` mode) with remote path mapping. | `DOWNLOAD_DIR` env var |
| `/complete` (your path, mapped to `COMPLETE_DIR`) | Completed downloads — what Sonarr/Radarr import from, and what your media server's library should point at. | `COMPLETE_DIR` env var |

Not mounted by default, and fine to leave ephemeral: `/node-persist` (`STORAGE_LOCATION`), an internal cache used by the Node backend — losing it just means a cold cache after a container recreate, not lost config.

If you use `ARR_COMPLETE_DIR` to separate TV from movies, or `STREAM_CACHE_DIR`/`THUMBNAIL_CACHE_DIR` to redirect those scratch locations, mount whatever paths you point them at the same way.

## PUID / PGID

`docker_entry.sh` runs as root initially, creates (or reuses) a group/user matching `PGID`/`PUID` (default `1000`/`1000` if unset), `chown`s `/data`, `/config`, `/logs`, and anything under `/app` not already owned by that UID/GID, then drops privileges via `su-exec` before actually starting the app. Set these to match the UID/GID that owns your media library on the host, the same way you would for any LinuxServer.io-style image — otherwise the files iPlayarr writes under `/complete` may not be readable/writable by whatever else manages that library.

## Updating the container

```bash
docker pull ghcr.io/planet22/iplayarr-turbo:latest
docker compose up -d   # or: docker run ... (recreate with the same volumes/env)
```

Because all persistent state is in Redis under `/config`, recreating the container with the same volumes preserves your settings, queue/history, and sessions across an update — there's nothing else to migrate. If you built a local image instead of pulling, re-run `docker build -t iplayarr .` first to pick up new source before recreating.

## Backup and restore

See [REDIS.md](REDIS.md#persistence-bundled-instance) — back up the `/config` volume; that's the entirety of iPlayarr's persistent application state. `/complete` and `/incomplete` are your media library itself, which you'd back up (or not) the same way you handle the rest of your media.
