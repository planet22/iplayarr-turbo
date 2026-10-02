# Sonarr/Radarr integration

iPlayarr doesn't talk a BBC-specific protocol to Sonarr/Radarr — it impersonates two protocols they already support, over the same HTTP port (`4404`).

## The dual-protocol trick

`src/routes/ApiRoute.ts` is the single entry point for both. It looks at the query string:

- **`?t=...`** → dispatched as a **Newznab-compatible indexer** request (`NewzNabEndpointDirectory`). This is what Sonarr/Radarr use to *search* — `t=caps` for capability discovery, `t=search`/`tvsearch`/`movie` for actual searches.
- **`?mode=...`** → dispatched as a **SABnzbd-compatible download client** request (`SabNZBDEndpointDirectory`). This is what Sonarr/Radarr use to *queue and monitor downloads* — adding an NZB, polling queue/history status, deleting a queued item.

Both are authenticated by `?apikey=` against your configured `API_KEY` (one exception: `?mode=stream`, used for `.strm` playback, is authenticated separately by `STREAM_KEY` — see [STREAMING.md](STREAMING.md)).

From Sonarr/Radarr's point of view, this looks exactly like having a real Newznab indexer paired with a real SABnzbd download client — because as far as the wire protocol goes, it is one. Internally, both dispatch into the same facade/service layer that actually drives `get_iplayer`/`yt-dlp`.

## What Sonarr/Radarr actually see

- **As an indexer**: a Newznab server returning NZB-shaped search results, where the "release" is really a BBC iPlayer programme. Grabbing a release hands Sonarr/Radarr an NZB file whose contents point back at iPlayarr's own SABnzbd-compatible download client.
- **As a download client**: a SABnzbd server. Sonarr/Radarr add the NZB, then poll queue/history exactly as they would for real Usenet — iPlayarr reports progress as `get_iplayer`/`yt-dlp` actually download (or, in `.strm` mode, reports "complete" immediately).

## Setting it up: the Apps page

The recommended path is Settings → **Apps** in iPlayarr's own UI, not manual configuration in Sonarr/Radarr. Adding an App there auto-creates both the Indexer and Download Client entries on the target Sonarr/Radarr instance via its own API (`V1ArrService`/`V3ArrService`, picked based on the detected API version) — including the `iplayer` category, which your NZB client/category setup must use consistently (see the warning on the Apps page about restricted/required rules if you change it).

Manual setup is also possible (see the main [README.md](../README.md#sonarr-and-radarr-link)) if you'd rather add the Indexer/Download Client by hand in Sonarr/Radarr's own Settings.

### Deleting an App's Indexer/Download Client

On the Apps page, editing an App and clearing its Download Client or Indexer name field (leaving it blank) and saving deletes that entry from the target Sonarr/Radarr instance entirely, rather than leaving a broken/empty one behind — the form shows a warning banner when you're about to do this. This only removes it from storage on iPlayarr's and Sonarr/Radarr's side; it doesn't touch anything else you've configured in Sonarr/Radarr around it (other indexers, download client priority, etc).

### User-Agent attribution

Also on the Apps page: a **User-Agent Lookup** table. Search/grab requests that arrive without an app ID — e.g. an indexer you added manually in Sonarr/Radarr rather than through the Apps auto-setup flow — can't normally be attributed to a specific app for stats/logging. iPlayarr automatically captures any unrecognized `User-Agent` header it sees with a blank app name; filling that in (partial/substring match against future requests) attributes that traffic to the named app going forward. Useful if you run multiple Sonarr/Radarr instances against one iPlayarr and want the NZB diagnostics page (see [USAGE_GUIDE.md](USAGE_GUIDE.md)) to tell them apart.

## Troubleshooting a failed "Test"

When Sonarr/Radarr's own "Test" button on the Indexer/Download Client fails:

- **Wrong API key** — the key configured in Sonarr/Radarr's Indexer/Download Client settings must exactly match iPlayarr's current `API_KEY` (Settings → General). If you've regenerated the key in iPlayarr since adding the integration, Sonarr/Radarr still has the old one; re-add or re-sync it (the Settings page's "API Key Changed" prompt offers to push the new key out to configured Apps when you save).
- **Wrong category** — the Download Client's category must be `iplayer` (or whatever you've consistently configured, with matching restricted/required rules) so completed items land where Sonarr/Radarr's import logic expects.
- **Port not reachable** — iPlayarr must be reachable from wherever Sonarr/Radarr actually runs, on port `4404` (or whatever you've mapped), using a hostname/IP Sonarr/Radarr can resolve — not `localhost` if Sonarr/Radarr is in a different container/host.
- **Auth session vs API key confusion** — the API key gates `/api` (the Sonarr/Radarr-facing protocol); it's unrelated to the iPlayarr web UI's own login (`AUTH_TYPE`/`AUTH_USERNAME`/`AUTH_PASSWORD`, see [AUTHENTICATION.md](AUTHENTICATION.md)). A failed Test is never an iPlayarr-UI-login problem.

For download-side failures after a successful Test (stuck queue items, `get_iplayer`/`yt-dlp` errors), see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
