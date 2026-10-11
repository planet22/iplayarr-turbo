# Usage guide

A tour of the web UI once iPlayarr is installed and linked to Sonarr/Radarr (see the main [README.md](../README.md) and [SONARR_RADARR_INTEGRATION.md](SONARR_RADARR_INTEGRATION.md) if you haven't done that yet). This links out to the feature-specific docs rather than repeating them.

New to iPlayarr? Start with [GETTING_STARTED_BBC.md](GETTING_STARTED_BBC.md).

## Discover, Channels, Schedule, Categories, A to Z (`/browse`)

A browse-first way in: a hero banner and rows of programmes (Featured, Recently Added, Most Popular), channel tiles with their real coloured BBC logos, a channel page with a Now / Next strip, a multi-channel Schedule/TV-guide page, category pages with iPlayer's own curated rows, and an A-Z index. Every card has **Play** (the in-app player) and **Download**; a show page lists its series and episodes and can download a whole series or be subscribed to. Channel pills throughout the UI are coloured per-channel too, with a toggle to turn that off. See [BROWSE.md](BROWSE.md).

## Subscriptions (`/subscriptions`)

Shows you have subscribed to, whose new episodes are queued automatically (checked hourly, or on demand), optionally linked to Sonarr/Radarr, plus the live channels added to your library. See [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md).

## Search (`/search`)

Manual search against the same backend Sonarr/Radarr use (`NativeSearchService` or `get_iplayer --search`, depending on `NATIVE_SEARCH`) — useful for grabbing something one-off without waiting for Sonarr/Radarr's own scheduled search, or for content that isn't matched to a series Sonarr/Radarr is tracking. The search box also suggests titles as you type, the **Posters** toggle shows results as artwork cards, and a dropdown filters by channel (see [BROWSE.md](BROWSE.md#search)). Results can be downloaded directly from here; see [DownloadPage](#download-download) for how that request is handled.

## Download (`/download`)

Where a manually-triggered download (as opposed to one Sonarr/Radarr queued via the SABnzbd protocol) is tracked. Manual downloads are tagged internally as `manual` source vs `nzb` — this distinction is what `WRITE_NFO_STRM`'s `nzb`/`manual` scoping option keys off of (see [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md)).

## Queue (`/queue`)

The main day-to-day view: active downloads and completed history, combined (`QueueTable`). History is sorted newest first by start time by default, and pressing Remove with nothing ticked shows a warning instead of doing nothing. Works the same regardless of whether items were queued by Sonarr/Radarr or manually — this is iPlayarr's own view into exactly what it's reporting back over the SABnzbd protocol. Cancelling a queued item or removing a completed one here is also what `ARCHIVE_ENABLED` affects: with it on, cancelled/removed entries are kept as a record instead of discarded (Settings → Media Management → Archive Downloads?).

## Streaming (`/streaming`)

Only relevant when `MEDIA_MODE=strm`. Shows **Active Streams** currently being served, and **Stream History** — past sessions, retained per `STREAM_HISTORY_RETENTION_DAYS` (or cleared on demand with the Clear History button). The two tables share column widths/positions so they line up, even where one table has a column the other doesn't (e.g. Stream History's Started column, Active Streams' Action column) — those just render blank in the table that lacks them. See [STREAMING.md](STREAMING.md) for setup and [CONFIG.md](CONFIG.md) for the full field reference.

## Watchdog (`/watchdog`)

Dashboard for the optional STRM Watchdog: live progress, valid/invalid counts and charts, Library Access checks and a per-link table. See [WATCHDOG.md](WATCHDOG.md).

## NZB (`/nzb`)

Diagnostics for the Newznab/SABnzbd integration specifically — recent searches and grabs *from Sonarr, Radarr, or Prowlarr*, not from manual Search/Download in the UI. Useful for confirming what a connected Arr instance is actually asking for, and for spotting a misbehaving search (e.g. wrong season/episode parsing). Each of Recent Searches, Recent Grabs and Failed Grabs can be cleared independently (confirmation required). See [SONARR_RADARR_INTEGRATION.md](SONARR_RADARR_INTEGRATION.md) for the protocol this reflects.

## Apps (`/apps`)

Manage Sonarr/Radarr/Prowlarr/Jellyfin integrations and NZB-client forwarding. The warning about changing the NZB category lives here (it used to be on the NZB page). A Jellyfin app (URL + API key, with a Test button) is used as a source by the [STRM Watchdog](WATCHDOG.md), and its Last Seen is stamped on successful responses. Covered in full in [SONARR_RADARR_INTEGRATION.md](SONARR_RADARR_INTEGRATION.md), including the User-Agent attribution table and deleting an Indexer/Download Client from the form.

## Off Schedule (`/offSchedule`)

By default, only content broadcast in the last 30 days is indexed from the BBC schedule. To search/grab older content, you index specific iPlayer URLs here (`ListEditor` with refresh/remove actions per entry) — this extends what's searchable beyond the normal rolling window without changing `RSS_FEED_HOURS` or the schedule refresh behavior itself. Deleting an entry also removes its cached episodes.

## Synonyms (`/synonyms`)

iPlayer doesn't name/structure its catalogue the way Sonarr/Radarr expect (matching show titles exactly, consistent naming across series). Synonyms let you map an iPlayer title to the title Sonarr/Radarr actually knows the series by, so matching succeeds.

## Logs (`/logs`)

Live-streamed application log (Socket.IO), backed by the same rotated files described in [TROUBLESHOOTING.md](TROUBLESHOOTING.md#log-locations). Loads the last 250 lines on open, then streams new ones in real time.

## Video Events (`/events`)

An audit/event log distinct from the general application log — tracks specific lifecycle events (e.g. `stream_key_rotated` and similar) with filtering by date range and free-text search. Can be cleared from here (Settings-page-style toolbar's delete action).

## Statistics (`/stats`)

Server info plus search/grab counters — a quick health-and-activity snapshot, separate from the per-request detail on the NZB page.

## Settings (`/settings`)

Tabbed: General, Media Management, Download Client, Streaming, Authentication, Maintenance. Full field-by-field reference in [CONFIG.md](CONFIG.md); feature walkthroughs in [STREAMING.md](STREAMING.md) and [LIBRARY_ORGANIZATION.md](LIBRARY_ORGANIZATION.md). An "Advanced" toggle in the page toolbar reveals additional fields (cron expressions, filename templates, cache directories) that most setups won't need to touch.

## About (`/about`)

Version info and project links.
