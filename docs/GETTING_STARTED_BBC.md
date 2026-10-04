# Getting started: watching and downloading BBC iPlayer

This is the quickest route from "container running" to "watching or downloading BBC programmes", using only iPlayarr's own web UI. You do **not** need Sonarr or Radarr for any of it. If you want those tools to download for you, see [SONARR_RADARR_INTEGRATION.md](SONARR_RADARR_INTEGRATION.md) afterwards; both ways can run side by side.

## What you can do

| I want to... | Use |
| --- | --- |
| Find something to watch | **Discover**, **Channels**, **Categories**, **A to Z**, or the search box ([BROWSE.md](BROWSE.md)) |
| Try an episode right now | **Play** (small floating player, no download) |
| Keep an episode | **Download** |
| Get every new episode of a show automatically | **Subscribe** ([SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)) |
| Have my media server (Jellyfin, Plex, Emby) show the BBC library | Downloads into your library folders, optionally as `.strm` files ([STREAMING.md](STREAMING.md), [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md)) |

## 1. Before you start

- **Be in the UK.** The BBC only serves iPlayer to UK addresses, so the machine running iPlayarr needs a UK IP address (a UK host, or a UK VPN for the container). If the browse pages say "Nothing to show yet", this is the first thing to check.
- **Run the container** following the [README](../README.md) or [INSTALLATION.md](INSTALLATION.md), then open `http://<your-host>:4404`.
- **Log in.** The default is `admin` / `password` unless you changed it. Change it under Settings → Authentication ([AUTHENTICATION.md](AUTHENTICATION.md)).

## 2. The settings that matter

Open **Settings**. Most things have sensible defaults; these are the ones to look at first ([CONFIG.md](CONFIG.md) has the full list):

| Setting | Why |
| --- | --- |
| **Download Directory** and **Complete Directory** (Media Management) | Where downloads are worked on and where finished files go. Both folders must exist and be writable. |
| **Stream Key** (Streaming) | Generated for you on first start. **Play** only appears once one exists, so you normally don't need to touch it. |
| **Stream Client** (Streaming) | `NATIVE` is recommended: it starts playback fastest and adapts quality to your connection. |
| **Video Quality** (Media Management) | The highest quality to request (`hd` by default). |
| **Media Mode** (Streaming) | `download` saves full video files; `strm` saves a tiny pointer file that streams on demand. See "Download or stream?" below. |
| **Organize into Folder Structure** (Media Management) | Turn on for `Show/Season 01/...` folders that Jellyfin, Plex and Emby understand. |

## 3. A five-minute tour

1. **Open Discover** (left nav). The big banner is a featured programme; the rows below are Featured, Recently Added and Most Popular. Scroll a row sideways, or use its arrow buttons.
2. **Hover a card** (on a phone the buttons are always showing) for **Play** and **Download**. Click the card itself to open the show.
3. **Press Play.** A small floating player opens at the bottom right and, where your browser allows it, pops into Picture-in-Picture. It keeps playing while you move around the app. Close it with the **X**.
4. **On a show page,** pick a series tab and use the buttons on each episode: **Play** or **Download**. **Download series** queues the whole selected series after a confirmation.
5. **Press Download** and check the filename (edit it if you like), then confirm. You land on **Queue**, where progress shows live.
6. **Press Subscribe** on a show you want to follow. Choose "only new episodes", "new episodes, and download the latest one now", or "download all available episodes now, plus new ones". From then on new episodes are queued automatically ([SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)).
7. **Know the name already?** Type it in the search box at the top. Suggestions appear as you type; **Enter** opens the highlighted show, or runs a full search. On the Search page, the **Posters** toggle gives the same results as artwork cards and a dropdown filters by channel.

You can also paste an iPlayer programme URL into the search box and press Enter to download it directly.

## 4. Download or stream?

**Media Mode** decides what a finished "download" is:

- **`download`** keeps the full video file on disk. Best if you want to keep things, watch offline, or your media server can't reach iPlayarr.
- **`strm`** keeps a few-byte pointer file instead, so the item is "complete" almost instantly and uses almost no disk. Your media server plays it by asking iPlayarr to stream it from the BBC each time, so iPlayarr must be running and reachable, and you need **Stream Base URL** set to an address your media server can reach ([STREAMING.md](STREAMING.md)).

Either way, **Play** in the browser works regardless of this setting.

## 5. Where things end up

Finished items are in your **Complete Directory**, in `Show/Season NN/` folders if you enabled folder structure, with `.nfo` metadata files if you enabled them (**Write .nfo Metadata Files?**, in Media Management). Point your media server's library at that folder ([media-servers/](media-servers/)). Subscriptions and the browse screens use exactly the same folders and rules as any other download.

## 6. If something looks wrong

| Symptom | Check |
| --- | --- |
| Browse pages empty, or "Nothing to show yet" | The server can't reach the BBC: UK IP/VPN, DNS, firewall. Look at **Logs**. |
| No Play button | Stream Key is empty (Settings → Streaming). |
| Play spins, then fails | Try Stream Client `NATIVE`; the **Open in BBC iPlayer** link in the error shows whether the BBC itself will play it from your location. |
| "The server returned an unexpected response" | The container was restarting; try again in a moment. |
| Download sits in the queue or fails | Check the Download and Complete directories exist and are writable ([TROUBLESHOOTING.md](TROUBLESHOOTING.md)). |
| A show has fewer episodes than iPlayer's own site | iPlayarr lists what the BBC currently makes available; episodes expire after a limited time. |

## Where next

- [BROWSE.md](BROWSE.md): every browse page, what feeds it, caching and limits
- [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md): auto-downloading new episodes
- [USAGE_GUIDE.md](USAGE_GUIDE.md): a tour of the whole UI, including the admin pages
- [SONARR_RADARR_INTEGRATION.md](SONARR_RADARR_INTEGRATION.md): letting Sonarr and Radarr use iPlayarr as an indexer and download client
