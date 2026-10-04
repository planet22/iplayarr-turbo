# Subscriptions

Subscribe to a show and iPlayarr queues its **new episodes** for download automatically, with no manual search or Sonarr/Radarr needed.

## Subscribing

1. Open a show from [Discover or any browse page](BROWSE.md) (or an episode, which opens its show).
2. Press **Subscribe** under the synopsis.
3. Choose what you want:
   - **Only new episodes from now on**, or
   - **New episodes, and download the latest one now**.

The button then reads **Subscribed**; press it again to unsubscribe. Subscriptions are per *show* (the brand), so a new series of a show you follow is picked up automatically. A one-off programme that is not part of a show cannot be subscribed to.

When you subscribe, every episode that is already available is recorded as **seen** and will not be downloaded. Only episodes that appear afterwards are queued.

## Subscriptions page (`/subscriptions`)

Lists every subscription with its artwork, channel, when it was last checked, and when and how many episodes were last downloaded. A red **Last check failed** tag means the last check hit an error (hover it for the message); the next scheduled check tries again.

- **Check now** (per show) and **Check all now** run the same check as the schedule, and report how many episodes were queued.
- **Unsubscribe** (trash) stops the subscription. Episodes already downloaded are not touched.

## How it works

- **Schedule:** every hour at 17 minutes past (a fixed schedule, like the nightly thumbnail cleanup). A pass is skipped if the previous one is still running.
- **Each check** fetches the show's current episode list from the BBC, ignores anything already seen, and queues what is left.
- **Skipped on purpose:** an episode already in the queue or in history (for example one Sonarr or you downloaded) is not queued again, and is marked seen.
- **Retries:** if an episode cannot be queued (for instance the BBC details lookup fails), it is left unseen and retried on the next check. If the whole check fails, nothing is lost and the error is shown on the page.
- **Naming:** queued episodes are named exactly like search results, using your TV filename template and any matching [synonym](USAGE_GUIDE.md#synonyms-synonyms) (including its season offset).

## Where downloads end up

Subscribed downloads behave like any other download:

- **Folder:** TV goes to `ARR_COMPLETE_DIR` if you have set one, otherwise `COMPLETE_DIR`; with `LIBRARY_FOLDER_STRUCTURE` on, under `Show/Season NN/` ([LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md)). There is no separate folder for subscriptions.
- **File type:** a full video, or a small `.strm` pointer if `MEDIA_MODE=strm` ([STREAMING.md](STREAMING.md)), in which case they complete almost instantly.
- **`.nfo` files:** subscriptions are tagged as *manual* downloads (not as coming from Sonarr/Radarr), so they get `.nfo` metadata when `WRITE_NFO_STRM` is `all` or `manual`, and not when it is `nzb`.

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

Subscriptions live in Redis under the `subscriptions` key (see [REDIS.md](REDIS.md)). The seen list is kept inside each subscription, so history pruning does not cause re-downloads. The UI uses these endpoints, under `/json-api/subscriptions`:

| Endpoint | Does |
| --- | --- |
| `GET /` | List subscriptions |
| `POST /` with `{ "pid": "...", "downloadLatest": false }` | Subscribe (an episode or show pid; returns the existing subscription if there is one) |
| `POST /check` | Check every subscription now |
| `POST /:id/check` | Check one subscription now |
| `DELETE /:id` | Unsubscribe |
