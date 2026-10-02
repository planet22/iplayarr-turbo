# <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/frontend/public/iplayarr.png" alt="Description" width="24px"> iPlayarr Turbo

iPlayarr is a companion tool for **Sonarr** and **Radarr**, making it easy to integrate **get_iplayer** for searching and downloading iPlayer content directly. It acts as both an **indexer** and a **download client**, allowing seamless automation of TV and movie downloads.

![Build Status](https://img.shields.io/github/actions/workflow/status/planet22/iplayarr-turbo/build.yml?logo=github)
![Test Status](https://img.shields.io/github/actions/workflow/status/planet22/iplayarr-turbo/test.yml?logo=github&label=tests)
<!--- istanbul-badges-readme:start --->
![Statements](https://img.shields.io/badge/statements-65.9%25-red.svg?style=flat)
![Branches](https://img.shields.io/badge/branches-54.97%25-red.svg?style=flat)
![Functions](https://img.shields.io/badge/functions-64.04%25-red.svg?style=flat)
![Lines](https://img.shields.io/badge/lines-66.61%25-red.svg?style=flat)
<!--- istanbul-badges-readme:end --->

> **This is iPlayarr Turbo**, a fork of upstream iPlayarr (based on v0.11.6) with a modernized Docker build and dependency stack — see [TURBO.md](TURBO.md) for everything this fork changes on top of what's described below.

## 📚 Further documentation

This README covers the basics. For more detail, see `docs/`:

- [CONFIG.md](docs/CONFIG.md) / [ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) — full settings reference
- [INSTALLATION.md](docs/INSTALLATION.md) — Docker deployment, volumes, PUID/PGID, updating
- [AUTHENTICATION.md](docs/AUTHENTICATION.md) — auth types, password reset, OIDC
- [REDIS.md](docs/REDIS.md) — what's stored in Redis, backup/restore
- [SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md) — how the dual-protocol trick works, troubleshooting a failed Test
- [STREAMING.md](docs/STREAMING.md) and [LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) — `.strm` mode and Jellyfin-style library layout
- [USAGE_GUIDE.md](docs/USAGE_GUIDE.md) — tour of the web UI
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common issues
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — contributor setup, testing, linting
- [media-servers/](docs/media-servers/) — Jellyfin, Plex, Emby specifics
- [platforms/](docs/platforms/) — Synology, Unraid notes

## 📸 Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/login.png" alt="Login View" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/queue.png" alt="Queue View" width="49%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/search.png" alt="Search View" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/details.png" alt="Details View" width="49%">
</p>

## Why iPlayarr?

iPlayer offers a wide range of high-quality content, but integrating it with Sonarr and Radarr has always been tricky. iPlayarr solves this problem by:

- Acting as a Newznab-compatible indexer, making iPlayer content searchable within Sonarr/Radarr
- Presenting as a SABnzbd-compatible download client, allowing automatic downloads and post-processing
- Handling the full download lifecycle, from fetching content with get_iplayer to organizing completed files

Unlike torrents and Usenet, iPlayarr operates in a less legally ambiguous space by only downloading content that is freely available for streaming.

## Why Create iPlayarr?

This project started as an experiment: Is it possible to integrate iPlayer with Sonarr/Radarr in a clean, automated way?

Most existing solutions rely on torrents or Usenet, but I wanted something that could get media from a reliable source. iPlayarr functions like a personal DVR for iPlayer, making it easier to automate downloads without needing traditional PVR software.

## Getting Started

### Download/Installation

The simplest way to use iPlayarr is via Docker:

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

Alternatively, use the bundled Dockerfile:

```bash
docker build -t iplayarr .
docker run -d --name iplayarr \
  -v ./cache:/data \
  -v ./config:/config \
  -v ./logs:/logs \
  -v /path/to/incomplete:/incomplete \
  -v /path/to/complete:/complete \
  --env-file=env-file \
  -p 4404:4404 \
  iplayarr
```

Or use Docker Compose:

```yml
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

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for a deeper walkthrough of volume mounts, PUID/PGID, and updating the container, and [docs/platforms/synology.md](docs/platforms/synology.md)/[docs/platforms/unraid.md](docs/platforms/unraid.md) for NAS-specific notes.

You can pre-set the following environment variables, or you can set them in the Settings menu once the container is up. Full reference: [docs/CONFIG.md](docs/CONFIG.md) (by Settings tab) and [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) (flat lookup table).

| Property     | Description                              |
| ------------ | ---------------------------------------- |
| API_KEY      | Api key to secure your iplayarr instance |
| DOWNLOAD_DIR | Download directory for in progress pulls |
| COMPLETE_DIR | Directory to move completed files to     |

There's a few more optional settings too:

| Property         | Description                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------- |
| ACTIVE_LIMIT     | How many downloads are allowed simultaneously, defaults to 3                              |
| REFRESH_SCHEDULE | Cron expression for when to proactively refresh schedule, defaults to hourly, on the hour |
| SCHEDULE_FULL_REFRESH | Re-fetch every day in the schedule window on every refresh instead of reusing cached results for days that have already passed. Defaults to false |
| HIDE_DONATE      | If you don't like the Kofi donate links you can hide them                                 |
| PUID             | Host User ID for file permissions                                                         |
| PGID             | Host Group ID for file permissions                                                        |
| NATIVE_SEARCH    | Search BBC's own search API directly instead of shelling out to get_iplayer. Faster, and the default. Defaults to true |
| ARCHIVE_ENABLED  | Keep a record of cancelled/removed downloads instead of discarding them outright. Defaults to false |
| OUTPUT_FORMAT    | Output container format passed to get_iplayer (e.g. mp4). Defaults to mp4 |
| LIBRARY_FOLDER_STRUCTURE | Organize completed downloads under COMPLETE_DIR into Jellyfin-style Show/Season folders (or a Movie folder), instead of one flat folder. Defaults to false. See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) |
| ARR_COMPLETE_DIR | Optional override of COMPLETE_DIR for TV downloads only (what the *arr imports). Leave unset to use COMPLETE_DIR for everything |
| WRITE_NFO_STRM   | Write a Jellyfin-compatible .nfo metadata file alongside each completed item. A .strm file is only ever produced when MEDIA_MODE is `strm`; this just adds matching .nfo metadata for it. One of `none` (default), `all`, `nzb` (only downloads added by Sonarr/Radarr), or `manual` (only manually-triggered downloads). See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) |
| MEDIA_MODE       | `download` (default) saves the full file; `strm` saves a small pointer file that streams on demand instead, saving disk space. See [docs/STREAMING.md](docs/STREAMING.md) |
| STREAM_CLIENT    | Which tool serves playback for `.strm` files: `GET_IPLAYER` (default), `YTDLP`, or `NATIVE` (fastest to start, adaptive quality). See [docs/STREAMING.md](docs/STREAMING.md) |
| STREAM_MODE      | `direct` (default, supports seeking) or `progressive-mkv` (remuxes to MKV on the fly, needs ffmpeg, no seeking) |
| STREAM_BASE_URL  | The address your media server (Jellyfin/Plex/Emby) uses to reach iPlayarr, for links written into `.strm` files |
| STREAM_KEY       | Secures `.strm` playback links, separate from API_KEY so it can be regenerated on its own |
| STREAM_CACHE_DIR | Where temporary files are stored while streaming. Defaults to a temp folder |
| STREAM_NATIVE_ADAPTIVE | With STREAM_CLIENT=NATIVE, let the player adjust quality automatically instead of pinning VIDEO_QUALITY. Defaults to true |
| STREAM_NATIVE_HQ_PROBE | With STREAM_CLIENT=NATIVE, verify real stream quality before playing (adds a short delay). Defaults to false |
| STREAM_NATIVE_EXPERIMENTAL_FHD | EXPERIMENTAL: try to unlock real 1080p above BBC's usual 720p cap on native streams. Defaults to false |
| THUMBNAIL_CACHE_DIR | Where cached BBC episode thumbnails are stored |
| THUMBNAIL_RETENTION_DAYS | How many days to keep unused cached thumbnails before nightly cleanup. Defaults to 30 |
| STREAM_HISTORY_RETENTION_DAYS | How many days to keep native streaming session history before nightly cleanup. Defaults to 30 |

### Usage

**Authentication**

The default details are:

| Username | Password |
| -------- | -------- |
| admin    | password |

See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for auth types (form/OIDC/none), changing credentials, and password reset.

**Sonarr and Radarr link**

> **Info:** The best way to add iPlayarr to Sonarr or Radarr is to use the "Apps" section of the web UI in iPlayarr

iPlayarr presents itself as both an indexer and a download client on port 4404. You can configure it automatically in the Settings menu or manually as follows:

**Add iPlayarr manually as a Download Client**

1. Go to Settings > Download Clients in Sonarr/Radarr.
2. Add a new SABnzbd client with the following details:

| Property | Value              |
| -------- | ------------------ |
| Name     | iPlayarr           |
| Host     | Your_Docker_Host   |
| Port     | 4404               |
| API Key  | API_KEY from above |
| Category | iplayer            |

3. Test and save.

**Add iPlayarr manually as an Indexer**

1. Go to Settings > Indexers in Sonarr/Radarr.
2. Add a new Newznab indexer with these settings:

| Property        | Value                        |
| --------------- | ---------------------------- |
| Name            | iPlayarr                     |
| URL             | http://Your_Docker_Host:4404 |
| API Key         | API_KEY from above           |
| Download Client | iPlayarr (created above)     |

See [docs/SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md) for how this dual-protocol setup actually works and how to troubleshoot a failed "Test".

### Web Interface

To access the web frontend, visit `http://Your_Docker_Host:4404`.
From here, you can manage settings, view logs, and monitor downloads. See [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md) for a tour of each page.

## Development Setup

To run iPlayarr locally for development:

### Prerequisites

- Node.js (see `.node-version` for current version)
- Docker (for local dev instance of Redis)

### Installation

1. Install dependencies for both backend and frontend:

```bash
npm run install:both
```

2. Start Redis using Docker (or see Redis section below to use another instance):

```bash
npm run serve:redis
```

3. Start the development server (runs backend and frontend concurrently):

```bash
npm run dev
```

The application will be available at:

- Frontend: `http://localhost:8080` (Vue dev server)
- Backend API: `http://localhost:4404`

### Additional Useful Scripts

| Script               | Description                               |
| -------------------- | ----------------------------------------- |
| `npm run build:both` | Build backend and frontend for production |
| `npm test`           | Run tests with coverage                   |
| `npm run lint`       | Run ESLint                                |
| `npm run prettier`   | Check code formatting                     |

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for testing a single file/test name, linting/prettier fix scripts, the module-alias note, and where to make changes architecturally.

## Redis

iPlayarr uses Redis for storage. This is built into the container and **doesn't require any additional setup**, but if you would like to use a standalone redis instance, set the following settings:

- REDIS_HOST
- REDIS_PORT
- REDIS_PASSWORD (optional)
- REDIS_SSL (optionally 'true')

If these are all set, it will not start the bundled version of Redis.

See [docs/REDIS.md](docs/REDIS.md) for what's actually stored in Redis and backup/restore notes.
