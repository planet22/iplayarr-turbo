# Synology

iPlayarr has no Synology-specific code or behavior — this is just how to run the same Docker deployment from [INSTALLATION.md](../INSTALLATION.md) on a Synology NAS.

## Deployment

Use **Container Manager** (DSM 7.2+; called Docker on older DSM versions). Either:

- Pull `ghcr.io/planet22/iplayarr-turbo:latest` directly in Container Manager's Registry tab and configure it through the GUI (ports, volumes, environment), or
- Use Container Manager's **Project** feature (its Compose support) with the same `docker-compose.yaml` shown in [INSTALLATION.md](../INSTALLATION.md).

## Volume paths

Synology convention is to keep container data under a shared folder, e.g. `/volume1/docker/iplayarr/{config,cache,logs}` for the `/config`, `/data`, `/logs` mounts, and your actual media share (e.g. `/volume1/media/...`) for `DOWNLOAD_DIR`/`COMPLETE_DIR`. Keep `DOWNLOAD_DIR` and `COMPLETE_DIR` on the same volume/share if possible — moving a completed file across filesystems is slower than a same-volume move.

## PUID / PGID

Find your Synology user's UID/GID via DSM's Control Panel → User & Group (or `id <username>` over SSH), and set `PUID`/`PGID` to match whatever account should own the downloaded media — typically the same account Sonarr/Radarr itself runs as, if they're also containerized on the same NAS, so neither fights the other over file ownership. See [INSTALLATION.md](../INSTALLATION.md#puid--pgid) for what the entrypoint does with these.
