# Subscriptions

Subscribe to a show and iPlayarr queues its **new episodes** for download automatically, with no manual search or Sonarr/Radarr needed.

## Subscribing

1. Open a show from [Discover or any browse page](BROWSE.md) (or an episode, which opens its show).
2. Press **Subscribe** under the synopsis.
3. Choose what you want:
   - **Only new episodes from now on**, or
   - **New episodes, and download the latest one now**, or
   - **Download all N available episodes now, plus new ones** (N is how many the show page lists).

The button then reads **Subscribed**; press it again to unsubscribe. Subscriptions are per *show* (the brand), so a new series of a show you follow is picked up automatically. A one-off programme that is not part of a show cannot be subscribed to.

With the first two choices, every episode that is already available is recorded as **seen** and will not be downloaded; only episodes that appear afterwards are queued (plus the newest one if you asked for it).

### Download all

The third choice starts the subscription with *nothing* seen, so the first check queues every available episode. That check runs in the background, so pressing Subscribe returns straight away even for a show with hundreds of episodes, and you are taken to the Queue to watch them arrive.

- Episodes are queued **oldest first**, in broadcast order, named and filed like any other download.
- Episodes already in the queue or in history are skipped, and one that fails to queue is left unseen and retried by the next hourly check.
- The Queue's normal limit on simultaneous downloads applies, so a big show works through its backlog gradually.
- It can be a lot of data (or a lot of `.strm` files, in `strm` mode). The dialog says how many episodes it will queue. If you pick it by mistake, remove the items from the Queue and Unsubscribe.
- Only the *first* check is special: later checks behave as normal, and a second check cannot start while the first is still working through the list.

### Sonarr/Radarr only

The subscribe dialog also offers **Sonarr/Radarr only**: the show is recorded but iPlayarr never checks or queues anything for it, leaving downloads to Sonarr/Radarr. It only makes sense together with a Sonarr/Radarr link (below).

### Versions

If audio described / signed badges are on (Settings → Appearance), the subscribe dialog can also ask which versions to follow, and the Subscriptions page has **AD** and **Signed** toggles per show. A subscription can then also download the audio described and/or signed version of each new episode, named and tagged like the standard release.

- Versions are **never back-filled**: only episodes that appear after you turn a version on are considered.
- The BBC often publishes these versions later than the standard episode, so each episode is re-checked for 30 days after it first appears.
- Whether you are asked or the default is used follows **Ask Which Version** / **Default Version** (Settings → Download Client). See [CONFIG.md](CONFIG.md#versions-audio-described-and-signed).

### Download before it leaves iPlayer

A `.strm` link stops playing when the BBC removes the programme. Each subscription on the Subscriptions page has a **box** toggle: pick how many days before an episode leaves iPlayer (1 to 60; the dialog offers 1, 3, 7, 14 and 30) and iPlayarr downloads a real copy to take the link's place.

- Only applies while **Media Mode** is Streaming, and only to episodes (and chosen AD / signed versions) that already have a `.strm` link in the download history. Nothing is downloaded for episodes you never had.
- The end date is the BBC's own (`availability.end` on each version of the episode in iPlayer's listing API). Days are counted on the UK calendar, as iPlayer does (an episode ending tomorrow night is 1 day away), so the number never depends on where you are. The check is the existing hourly subscription check, so it acts within about an hour of the threshold. Episodes already gone are not attempted.
- Each episode is queued once; a failed queue is retried at the next check. Turning the toggle off forgets what was secured.
- When the real file lands beside the link, **When a Subscription Replaces a .strm Link** (Settings → Media Management) decides what happens to the `.strm` and its `.strmtool.json`: rename to `.bak` (default; Jellyfin ignores them and they can be put back), delete, or leave alone so an external tool such as [StrmToolTurbo](https://github.com/planet22/JellyStrmToolTurbo) can handle them.

## Linking to Sonarr/Radarr

A subscription can be added to a Sonarr or Radarr library from the Programme and Subscriptions pages (needs the app set up on the Apps page).

- A poster-card match dialog looks the show up in the app (editable search, retry if the lookup fails) and lets you pick the **root folder** and **quality profile**.
- The subscription then shows the app-name chip; press it again to unlink. Unsubscribing a linked show offers to **remove it from Sonarr/Radarr or keep it**.
- Only entries iPlayarr itself added can be removed from Sonarr/Radarr, and their files are always kept.
- If the app already has the show under the same title slug with a different id, iPlayarr links to that entry instead of failing.
- The **Request** action on a programme page also records the show as a Sonarr/Radarr-only subscription with its link, so you can see and undo it. Only shows iPlayarr itself downloads count as "Subscribed"; subscribing to a Sonarr/Radarr-only show upgrades it in place.

### Syncing shows already in Sonarr/Radarr

If Sonarr/Radarr already hold shows that point at iPlayarr, **Sync** (beside **Check all now** on the Subscriptions page) finds them and offers them as Sonarr/Radarr-only subscriptions. A show counts as ours when the app holds:

- a `.strm` link, or
- a video file carrying the `BBCiPlayarrTurbo` release group (see [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md)), or
- optionally, a grab recorded in its history through the iPlayarr indexer (slow, so it is off unless ticked).

1. Press **Sync**, pick the apps to scan (your choice is remembered per app), and optionally tick the grab-history scan.
2. Each app shows step-by-step progress with a tally of `.strm` files and release-group files found. Sonarr/Radarr series and history pages are fetched in parallel.
3. Closing the dialog scrolls to a **Found in Sonarr/Radarr** list. Import shows one by one, or **Import all**. **Clear** dismisses the list (the next sync offers them again).

Finds are kept until imported, cleared or replaced by the next scan of the same app, so a scheduled scan's results are waiting when you next open the page. A show you have since subscribed to is left out.

Each Sonarr/Radarr-only show keeps its **episode counts** (have of total, and how many are ours), when a file was last added and when the counts were last validated. A show deleted from its app gets a warning icon and loses its stale counts, and if it is re-added in the app the new entry is offered as a relink.

**Scheduled refresh:** switch on **Subscription detection** in an app's settings (Apps page; the app card then shows a *Subscription Detection* pill). A daily job (**Subscription Detection**, 03:47, listed under Settings → Maintenance) refreshes the counts of linked shows and remembers any new finds for the list above. It never imports anything and skips the slow grab-history scan.

## Subscriptions page (`/subscriptions`)

Lists every subscription with its artwork, channel, when it was last checked, and when and how many episodes were last downloaded. A red **Last check failed** tag means the last check hit an error (hover it for the message); the next scheduled check tries again.

- **Check now** (per show) and **Check all now** run the same check as the schedule, and report how many episodes were queued. While a check runs, a progress ring appears over each show's thumbnail (waiting, listing, queueing n of total, versions, done), held for at least a second so it can be seen.
- **Sort** by Added, A-Z, Downloaded or Checked (A-Z ignores a leading *The*, *A* or *An*) and **filter** by All, iPlayarr or an individual app.
- **Unsubscribe** (trash) stops the subscription. Episodes already downloaded are not touched.

## Live channels

The Subscriptions page also has a **Live channels** section listing the BBC live channels you added to your media library (with logos and a remove button). These are separate from programme subscriptions: there is nothing to check or download, only a `.strm` file kept in `LIVE_STRM_DIR`. See [STREAMING.md](STREAMING.md#live-channels).

## How it works

- **Schedule:** every hour at 17 minutes past (a fixed schedule, like the nightly thumbnail cleanup). A pass is skipped if the previous one is still running.
- **Each check** fetches the show's current episode list from the BBC, ignores anything already seen, and queues what is left.
- **Skipped on purpose:** an episode already in the queue or in history (for example one Sonarr or you downloaded) is not queued again, and is marked seen.
- **Retries:** if an episode cannot be queued (for instance the BBC details lookup fails), it is left unseen and retried on the next check. If the whole check fails, nothing is lost and the error is shown on the page.
- **Naming:** queued episodes are named exactly like search results, using your TV filename template and any matching [synonym](USAGE_GUIDE.md#synonyms-synonyms) (including its season offset).

## Where downloads end up

Subscribed downloads behave like any other download:

- **Folder:** always `COMPLETE_DIR`, never `ARR_COMPLETE_DIR` — that override only applies to TV Sonarr/Radarr itself queued (see `.nfo` note below), and a subscription isn't one of those even though it's TV. With `LIBRARY_FOLDER_STRUCTURE` on, under `Show/Season NN/` ([LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md)). There is no separate folder for subscriptions.
- **File type:** a full video, or a small `.strm` pointer if `MEDIA_MODE=strm` ([STREAMING.md](STREAMING.md)), in which case they complete almost instantly.
- **`.nfo` files:** subscriptions are tagged as *manual* downloads (not as coming from Sonarr/Radarr), so they get `.nfo` metadata when `WRITE_NFO_STRM` is `all` or `manual`, and not when it is `nzb`.

Concurrent subscribe requests for the same show no longer create duplicates.

## Limits

- Checks are hourly, with no setting to change that.
- A subscription covers the whole show; there is no "this series only" option and no per-show quality setting (the global `VIDEO_QUALITY` applies).
- An episode counts as handled once it is queued. If that download later fails, it is not retried automatically; use the Queue page.
- The BBC removes episodes after a limited time. A new subscription only sees what is available when you subscribe, and a long outage could miss an episode that appeared and expired in between.
- If Sonarr/Radarr also monitor the same show through iPlayarr, both routes may want the same episode. The already-in-queue/history check avoids most duplicates, but you probably want one route per show.

## Troubleshooting

- **"Could not list this show's episodes right now"** when subscribing: the BBC lookup returned nothing. iPlayarr refuses rather than recording an empty baseline (which would make the first check download the whole back catalogue). Try again shortly; check the server can reach the BBC.
- **"This programme is not part of a show that can be subscribed to":** it is a standalone programme with no parent show.
- **Nothing is downloading:** use **Check all now** and read the result; also check **Logs** for `Subscription "..."` lines.

## Storage and API

Subscriptions live in the database under the `subscriptions` key (see [DATABASE.md](DATABASE.md)). The seen list is kept inside each subscription, so history pruning does not cause re-downloads. The UI uses these endpoints, under `/json-api/subscriptions`:

| Endpoint | Does |
| --- | --- |
| `GET /` | List subscriptions |
| `POST /` with `{ "pid": "...", "downloadLatest": false, "downloadAll": false }` | Subscribe (an episode or show pid; returns the existing subscription if there is one). `downloadAll` wins over `downloadLatest`, and both are only honoured when exactly `true`. |
| `POST /` with `"arrOnly": true` | Subscribe without iPlayarr checking or queuing (Sonarr/Radarr handles downloads) |
| `POST /check` | Check every subscription now |
| `POST /:id/check` | Check one subscription now |
| `PUT /:id/versions` | Set which extra versions (`audio-described`, `signed`) to download for new episodes |
| `PUT /:id/secure` with `{ "days": 7 }` (whole number 1-60) or `{ "days": null }` | Download real copies of the show's `.strm` links that many days before they leave iPlayer, or switch it off. `POST /` also accepts `secureDays`. |
| `DELETE /:id` | Unsubscribe |

Further endpoints:

| Endpoint | Does |
| --- | --- |
| `GET /json-api/subscriptions/arr/apps` | Sonarr/Radarr apps available to link |
| `GET /json-api/subscriptions/arr/apps/:appId/lookup` | Search the app for a matching show |
| `GET /json-api/subscriptions/arr/apps/:appId/options` | Root folders and quality profiles |
| `GET /json-api/subscriptions/arr/detected?appId=&grab=1` | Scan the app(s) for shows that point at iPlayarr (`grab=1` adds the grab-history scan) |
| `GET /json-api/subscriptions/arr/detected/found` | Finds from earlier scans, manual or scheduled, still waiting to be imported |
| `DELETE /json-api/subscriptions/arr/detected?appId=` | Clear the waiting finds (of one app when `appId` is given) |
| `POST /json-api/subscriptions/arr/detected/import` | Import one find (`appId`, `arrId`, `pid`, `title`, optional counts) |
| `POST /json-api/subscriptions/arr/:id` | Link (add to Sonarr/Radarr) |
| `DELETE /json-api/subscriptions/arr/:id` | Unlink (optionally removing what iPlayarr added) |
| `GET/POST/DELETE /json-api/subscriptions/live` | List, add (`POST /all` for every channel) and remove (`/:channelId`) live channels |
