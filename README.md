# <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/frontend/public/iplayarr.png" alt="Description" width="24px"> iPlayarr Turbo

iPlayarr Turbo is a companion tool for **Sonarr** and **Radarr**, making it easy to integrate **get_iplayer** for searching and downloading iPlayer content directly. It acts as both an **indexer** and a **download client**, allowing seamless automation of TV and movie downloads.

![Build Status](https://img.shields.io/github/actions/workflow/status/planet22/iplayarr-turbo/build.yml?logo=github)
![Test Status](https://img.shields.io/github/actions/workflow/status/planet22/iplayarr-turbo/test.yml?logo=github&label=tests)
<!--- istanbul-badges-readme:start --->

![Statements](https://img.shields.io/badge/statements-94.03%25-brightgreen.svg?style=flat)
![Branches](https://img.shields.io/badge/branches-84.81%25-yellow.svg?style=flat)
![Functions](https://img.shields.io/badge/functions-93.3%25-brightgreen.svg?style=flat)
![Lines](https://img.shields.io/badge/lines-94.38%25-brightgreen.svg?style=flat)
<!--- istanbul-badges-readme:end --->

> **This is iPlayarr Turbo**, a fork of upstream iPlayarr (based on v0.11.6) with a modernized Docker build and dependency stack — see [TURBO.md](TURBO.md) for everything this fork changes on top of what's described below.

## 🔐 First login and upgrading (read this first)

**New install:** there is **no default password**. On first start iPlayarr generates a random one for the user `admin` and prints it **once** in the container log:

```bash
docker logs iplayarr 2>&1 | grep "Web UI login"
# Web UI login -> username: admin  password: Xk3...   (change it in Settings)
```

Log in with that, then set your own under **Settings → Authentication**. It is never shown again or sent over HTTP; if you lose it, use the [password reset](docs/AUTHENTICATION.md#forgotten-password-reset).

**Upgrading from an older version — do I have to change my password?**

| Your situation | What happens on upgrade |
| --- | --- |
| You **changed** the password from the old default (`admin` / `password`) | Nothing. Your password is kept. |
| You **never changed it** (still `admin` / `password`) | The old default is retired. A new random password is generated and printed once in the container log (same `Web UI login` line). Log in with that. |
| `AUTH_TYPE=none` (no login) | No login to change. The password is still rotated in the background for the day you switch back to `form`, and a warning is logged that the UI is open to everyone. |
| `AUTH_TYPE=oidc` | Not affected. |

Other things you will notice after upgrading (details in [docs/SECURITY.md](docs/SECURITY.md)):

- Everyone is signed out once (the login-cookie secret is now generated instead of a built-in default).
- Your stored credentials (Sonarr/Radarr/Jellyfin API keys, `API_KEY`, `STREAM_KEY`, OIDC secret) are **encrypted in the database** with a key kept outside it — `secrets.key` in your `/data` (cache) volume, or `SECRETS_KEY` if you set it. **Back that key up with your `/config` data.** Without it, stored keys can't be read after a restore.
- The Apps and Settings pages show saved keys/passwords as `********`; leave them as they are to keep the saved value.
- After 10 wrong logins from one address you are locked out for 15 minutes.
- The UI can't be embedded in other sites by default; set `ALLOW_EMBEDDING=true` if you embed it in a dashboard.
- Behind a reverse proxy that keeps a URL prefix (like Sonarr's URL Base)? Set `BASE_PATH=/iplayarr` and the UI, API and websocket are all served under it. The container healthcheck (`/ping`) stays unprefixed.
- With login disabled (`AUTH_TYPE=none`) the executable-related settings (`GET_IPLAYER_EXEC`, `YTDLP_EXEC`, additional download parameters) can't be changed from the UI; set them as environment variables.

## 📚 Further documentation

This README covers the basics. For more detail, see `docs/`:

- [CONFIG.md](docs/CONFIG.md) / [ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) — full settings reference
- [INSTALLATION.md](docs/INSTALLATION.md) — Docker deployment, volumes, PUID/PGID, updating
- [AUTHENTICATION.md](docs/AUTHENTICATION.md) — auth types, initial password, upgrading, password reset, OIDC
- [SECURITY.md](docs/SECURITY.md) — security review, what was hardened, credential encryption, residual risks
- [DATABASE.md](docs/DATABASE.md) — what's stored in the SQLite database, backup/restore, upgrading from Redis
- [SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md) — how the dual-protocol trick works, troubleshooting a failed Test
- [STREAMING.md](docs/STREAMING.md) and [LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) — `.strm` mode and Jellyfin-style library layout
- [GETTING_STARTED_BBC.md](docs/GETTING_STARTED_BBC.md) — from a running container to watching and downloading BBC programmes
- [BROWSE.md](docs/BROWSE.md) — Discover, Channels, Categories, A to Z, type-ahead search
- [SUBSCRIPTIONS.md](docs/SUBSCRIPTIONS.md) — automatically download new episodes of a show, link shows to Sonarr/Radarr, live channels
- [WATCHDOG.md](docs/WATCHDOG.md) — daily check that `.strm` links still resolve on BBC
- [USAGE_GUIDE.md](docs/USAGE_GUIDE.md) — tour of the web UI
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — common issues
- [DEVELOPMENT.md](docs/DEVELOPMENT.md) — contributor setup, testing, linting
- [media-servers/](docs/media-servers/) — Jellyfin, Plex, Emby specifics
- [platforms/](docs/platforms/) — Synology, Unraid notes

## 📸 Screenshots

<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/login.png" alt="Login View" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/search.png" alt="Search View" width="49%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/download.png" alt="Download Confirmation" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/queue.png" alt="Queue View" width="49%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/subscribe.png" alt="Subscribe to a Show" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/details.png" alt="Details View" width="49%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/channels.png" alt="Channels View" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/schedule.png" alt="Schedule View" width="49%">
</p>
<p align="center">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/jellyfin.png" alt="Jellyfin Playback" width="49%">
  <img src="https://raw.githubusercontent.com/planet22/iplayarr-turbo/refs/heads/main/readme-media/mobile.png" alt="Mobile View" width="30%">
</p>

## Why iPlayarr Turbo?

iPlayer offers a wide range of high-quality content, but integrating it with Sonarr and Radarr has always been tricky. iPlayarr Turbo solves this problem by:

- Acting as a Newznab-compatible indexer, making iPlayer content searchable within Sonarr/Radarr
- Presenting as a SABnzbd-compatible download client, allowing automatic downloads and post-processing
- Handling the full download lifecycle, from fetching content with get_iplayer to organizing completed files
- Streaming content on demand to Jellyfin/Plex/Emby via small `.strm` pointer files, instead of pre-downloading everything
- Watching BBC live channels, in the browser or as `.strm` entries in your media library, and a Watchdog that flags expired `.strm` links
- Works standalone too - Browse/Discover, Channels, Categories, A to Z, search, and Subscriptions are all usable from the web UI without Sonarr/Radarr at all

Unlike torrents and Usenet, iPlayarr Turbo operates in a less legally ambiguous space by only downloading content that is freely available for streaming.

## Why Create iPlayarr Turbo?

This project started as an experiment: Is it possible to integrate iPlayer with Sonarr/Radarr in a clean, automated way?

Most existing solutions rely on torrents or Usenet, but I wanted something that could get media from a reliable source. iPlayarr Turbo functions like a personal DVR for iPlayer, making it easier to automate downloads without needing traditional PVR software.

## Getting Started

### Download/Installation

The simplest way to use iPlayarr Turbo is via Docker:

```bash
docker run -d --name iplayarr \
  -v ./cache:/data \
  -v ./config:/config \
  -v ./logs:/logs \
  -v /path/to/incomplete:/incomplete \
  -v /path/to/complete:/complete \
  -v /path/to/arrcomplete:/arrcomplete \
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
  -v /path/to/arrcomplete:/arrcomplete \
  --env-file=env-file \
  -p 4404:4404 \
  iplayarr
```

The `/path/to/arrcomplete` mount is only needed if you set `ARR_COMPLETE_DIR` (e.g. `ARR_COMPLETE_DIR=/arrcomplete` in `env-file`) to give TV downloads their own completed-files folder, separate from `COMPLETE_DIR` — see the optional settings table below. Leave it out if you don't use that setting.

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
            - 'ARR_COMPLETE_DIR=/mnt/media/iplayarr/arrcomplete'
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

`ARR_COMPLETE_DIR` is optional — it's under `/mnt/media/iplayarr/arrcomplete`, so the existing `/mnt/media:/mnt/media` mount already covers it. Remove that environment line if you don't want TV downloads split into their own folder.

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for a deeper walkthrough of volume mounts, PUID/PGID, and updating the container, and [docs/platforms/synology.md](docs/platforms/synology.md)/[docs/platforms/unraid.md](docs/platforms/unraid.md) for NAS-specific notes.

You can pre-set the following environment variables, or you can set them in the Settings menu once the container is up. Full reference: [docs/CONFIG.md](docs/CONFIG.md) (by Settings tab) and [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md) (flat lookup table).

| Property     | Description                              |
| ------------ | ---------------------------------------- |
| API_KEY      | Api key to secure your iplayarr instance |
| DOWNLOAD_DIR | Download directory for in progress pulls |
| COMPLETE_DIR | Directory to move completed files to     |

There's a few more optional settings too:

| Property                       | Description                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ACTIVE_LIMIT                   | How many downloads are allowed simultaneously, defaults to 3                                                                                                                                                                                                                                                                                                                               |
| REFRESH_SCHEDULE               | Cron expression for when to proactively refresh schedule, defaults to hourly, on the hour                                                                                                                                                                                                                                                                                                  |
| SCHEDULE_FULL_REFRESH          | Re-fetch every day in the schedule window on every refresh instead of reusing cached results for days that have already passed. Defaults to false                                                                                                                                                                                                                                          |
| HIDE_DONATE                    | If you don't like the Kofi donate links you can hide them                                                                                                                                                                                                                                                                                                                                  |
| PUID                           | Host User ID for file permissions                                                                                                                                                                                                                                                                                                                                                          |
| PGID                           | Host Group ID for file permissions                                                                                                                                                                                                                                                                                                                                                         |
| NATIVE_SEARCH_ENGINE           | `V1` (stable, default) or `V2` (experimental: concurrent lookups and retries). Only used when NATIVE_SEARCH is true |
| NATIVE_SEARCH                  | Search BBC's own search API directly instead of shelling out to get_iplayer. Faster, and the default. Defaults to true                                                                                                                                                                                                                                                                     |
| ARCHIVE_ENABLED                | Keep a record of cancelled/removed downloads instead of discarding them outright. Defaults to false                                                                                                                                                                                                                                                                                        |
| OUTPUT_FORMAT                  | Output container format passed to get_iplayer (e.g. mp4). Defaults to mp4                                                                                                                                                                                                                                                                                                                  |
| LIBRARY_FOLDER_STRUCTURE       | Organize completed downloads under COMPLETE_DIR into Jellyfin-style Show/Season folders (or a Movie folder), instead of one flat folder. Defaults to true. See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md)                                                                                                                                                                |
| ARR_COMPLETE_DIR               | Optional override of COMPLETE_DIR for TV downloads Sonarr/Radarr themselves queued (NZB) only - manual UI downloads and subscriptions always use COMPLETE_DIR, even for TV. Leave unset to use COMPLETE_DIR for everything                                                                                                                                                                 |
| WRITE_NFO_STRM                 | Write a Jellyfin-compatible .nfo metadata file alongside each completed item. A .strm file is only ever produced when MEDIA_MODE is `strm`; this just adds matching .nfo metadata for it. One of `none`, `all`, `nzb` (only downloads added by Sonarr/Radarr), or `manual` (only manually-triggered downloads, the default). See [docs/LIBRARY_ORGANIZATION.md](docs/LIBRARY_ORGANIZATION.md) |
| MEDIA_MODE                     | `strm` (default) saves a small pointer file that streams on demand, saving disk space; `download` saves the full file instead. See [docs/STREAMING.md](docs/STREAMING.md)                                                                                                                                                                                                                  |
| STREAM_CLIENT                  | Which tool serves playback for `.strm` files: `NATIVE` (default, fastest to start, adaptive quality), `GET_IPLAYER`, or `YTDLP`. If using `YTDLP` (for this or `DOWNLOAD_CLIENT`) in a non-root container (i.e. with `PUID`/`PGID` set), also add `cap_add: [NET_BIND_SERVICE]` - see [docs/STREAMING.md](docs/STREAMING.md)                                                             |
| STREAM_MODE                    | `direct` (default, supports seeking) or `progressive-mkv` (remuxes to MKV on the fly, needs ffmpeg, no seeking)                                                                                                                                                                                                                                                                            |
| STREAM_BASE_URL                | The address your media server (Jellyfin/Plex/Emby) uses to reach iPlayarr Turbo, for links written into `.strm` files                                                                                                                                                                                                                                                                      |
| STREAM_KEY                     | Secures `.strm` playback links, separate from API_KEY so it can be regenerated on its own                                                                                                                                                                                                                                                                                                  |
| STREAM_CACHE_DIR               | Where temporary files are stored while streaming. Defaults to a temp folder                                                                                                                                                                                                                                                                                                                |
| STREAM_NATIVE_ADAPTIVE         | With STREAM_CLIENT=NATIVE, let the player adjust quality automatically instead of pinning VIDEO_QUALITY. Defaults to false                                                                                                                                                                                                                                                                 |
| STREAM_NATIVE_HQ_PROBE         | With STREAM_CLIENT=NATIVE, verify real stream quality before playing (adds a short delay). Defaults to false                                                                                                                                                                                                                                                                               |
| STREAM_NATIVE_EXPERIMENTAL_FHD | With STREAM_CLIENT=NATIVE, try to unlock real 1080p above BBC's usual 720p cap on native streams. Defaults to true                                                                                                                                                                                                                                                                         |
| THUMBNAIL_CACHE_DIR            | Where cached BBC episode thumbnails are stored                                                                                                                                                                                                                                                                                                                                             |
| THUMBNAIL_RETENTION_DAYS       | How many days to keep unused cached thumbnails before nightly cleanup. Defaults to 30                                                                                                                                                                                                                                                                                                      |
| STREAM_HISTORY_RETENTION_DAYS  | How many days to keep native streaming session history before nightly cleanup. Defaults to 30                                                                                                                                                                                                                                                                                              |
| LIVE_STRM_DIR                  | Where `.strm` files for live channels added to the library are written. Blank uses COMPLETE_DIR. See [docs/STREAMING.md](docs/STREAMING.md#live-channels) |
| LIVE_TV_ENABLED                | Serve BBC live channels as an M3U tuner and XMLTV guide for Jellyfin Live TV. Defaults to false. See [docs/STREAMING.md](docs/STREAMING.md#jellyfin-live-tv-tuner--guide) |
| LIVE_TV_EPG_OFFSET             | Minutes to shift the Jellyfin Live TV guide (default 0). Guide times are sent in the server's timezone. See [docs/STREAMING.md](docs/STREAMING.md#jellyfin-live-tv-tuner--guide) |
| LIVE_TV_LOGO_SHAPE             | Live TV channel logo shape, `landscape` (16:9, default) or `square` |
| LIVE_TV_GUIDE_CATEGORIES       | Tag Live TV guide programmes with BBC categories for Jellyfin's colours and filters. Defaults to true |
| LIVE_TV_GUIDE_FLAGS            | Tag Live TV guide programmes as live / new / repeat. Defaults to true |
| LIVE_TV_GUIDE_HD               | Mark Live TV guide programmes as HD. Defaults to true |
| STRM_WATCHDOG_ENABLED          | Daily check that `.strm` links still resolve on BBC. Defaults to false. The other `STRM_WATCHDOG_*` settings (SOURCES, ACTION, PATH_MAP, ARR_ACTION, CONCURRENCY, FAIL_THRESHOLD, WEBHOOK_URL) are listed in [docs/WATCHDOG.md](docs/WATCHDOG.md) |

### Usage

**Authentication**

**There is no default password.** On first start iPlayarr generates a random one for the `admin` user and prints it **once** in the container log (`docker logs <container> 2>&1 | grep "Web UI login"`). Change it under Settings -> Authentication. Upgrading and never changed the old `admin` / `password`? It is replaced the same way — see [First login and upgrading](#-first-login-and-upgrading-read-this-first).

See [docs/AUTHENTICATION.md](docs/AUTHENTICATION.md) for auth types (form/OIDC/none), changing credentials, and password reset.

**Sonarr and Radarr link**

> **Info:** The best way to add iPlayarr Turbo to Sonarr or Radarr is to use the "Apps" section of the web UI in iPlayarr Turbo

iPlayarr Turbo presents itself as both an indexer and a download client on port 4404. You can configure it automatically in the Settings menu or manually as follows:

**Add iPlayarr Turbo manually as a Download Client**

1. Go to Settings > Download Clients in Sonarr/Radarr.
2. Add a new SABnzbd client with the following details:

| Property | Value              |
| -------- | ------------------ |
| Name     | iPlayarr Turbo     |
| Host     | Your_Docker_Host   |
| Port     | 4404               |
| API Key  | API_KEY from above |
| Category | iplayer            |

3. Test and save.

**Add iPlayarr Turbo manually as an Indexer**

1. Go to Settings > Indexers in Sonarr/Radarr.
2. Add a new Newznab indexer with these settings:

| Property        | Value                          |
| --------------- | ------------------------------ |
| Name            | iPlayarr Turbo                 |
| URL             | http://Your_Docker_Host:4404   |
| API Key         | API_KEY from above             |
| Download Client | iPlayarr Turbo (created above) |

See [docs/SONARR_RADARR_INTEGRATION.md](docs/SONARR_RADARR_INTEGRATION.md) for how this dual-protocol setup actually works and how to troubleshoot a failed "Test".

### Web Interface

To access the web frontend, visit `http://Your_Docker_Host:4404`.
From here, you can manage settings, view logs, and monitor downloads. See [docs/USAGE_GUIDE.md](docs/USAGE_GUIDE.md) for a tour of each page.

## ⚖️ Legal Disclaimer

iPlayarr Turbo is an independent, community-built project. It has no connection to the BBC, and the BBC has not reviewed, approved or endorsed it. "BBC", "BBC iPlayer" and related names and logos belong to the British Broadcasting Corporation and are used here only to describe what the software works with.

- **TV Licence:** In the UK you need a valid TV Licence to watch or download BBC iPlayer content. This tool does not change that, and you are responsible for holding one.
- **Personal use only:** Use this software only to time-shift programmes for your own private viewing, within the BBC iPlayer terms of use and the copyright law that applies where you live. Do not redistribute, share or publish anything you download.
- **No circumvention:** iPlayarr Turbo does not remove DRM or bypass paywalls. It only fetches streams the BBC already serves openly to ordinary viewers. If you use it to get around geographic restrictions, that is your decision and your risk.
- **Your responsibility:** You are solely responsible for how you use this software. The authors and contributors accept no liability for misuse, for any breach of the BBC's terms, or for any loss or damage that results. The software is provided "as is", without warranty of any kind, as set out in the project licence.

If you are not sure what is permitted in your country, check before you use it.

## Development Setup

To run iPlayarr Turbo locally for development:

### Prerequisites

- Node.js (see `.node-version` for current version)

### Installation

1. Install dependencies for both backend and frontend:

```bash
npm run install:both
```

2. Start the development server (runs backend and frontend concurrently):

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

## Database

iPlayarr Turbo stores everything in a single SQLite file (`/config/iplayarr.db` in the container) via Prisma. There is nothing to set up and no extra service to run. Keep your `/config` mount and you keep your settings.

Upgrading from a version that used Redis? Your data is imported automatically on first start. See [docs/DATABASE.md](docs/DATABASE.md) for details, what's stored and backup/restore notes.
