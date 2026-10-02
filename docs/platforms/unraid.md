# Unraid

iPlayarr has no Unraid-specific code or behavior — this is just how to run the same Docker deployment from [INSTALLATION.md](../INSTALLATION.md) on Unraid.

## Deployment

There's no iPlayarr template in Community Applications as of this writing. Add it as a container manually from the Docker tab (**Add Container**) using `ghcr.io/planet22/iplayarr-turbo:latest` as the repository, or via **Compose Manager** (a popular CA plugin) using the same `docker-compose.yaml` from [INSTALLATION.md](../INSTALLATION.md).

## Volume paths

Unraid convention is `/mnt/user/appdata/iplayarr/{config,cache,logs}` for the `/config`, `/data`, `/logs` mounts, and your array/cache media share (e.g. `/mnt/user/media/...`) for `DOWNLOAD_DIR`/`COMPLETE_DIR`. As with any Unraid download-then-move workflow, keeping `DOWNLOAD_DIR` and `COMPLETE_DIR` on the same share/disk avoids an extra copy when a download completes and moves.

## PUID / PGID

Unraid's own containers (and most Community Applications templates) default to `99`/`100` (`nobody`/`users`) rather than `1000`/`1000`. Set `PUID=99`/`PGID=100` to match, so files iPlayarr writes under `COMPLETE_DIR` are owned the same way as the rest of your Unraid media share and don't need a manual permissions fix afterward. See [INSTALLATION.md](../INSTALLATION.md#puid--pgid) for what the entrypoint does with these.
