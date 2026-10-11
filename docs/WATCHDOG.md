# STRM Watchdog

BBC removes programmes after a limited time. A `.strm` file pointing at an expired programme still sits in your library but no longer plays. The **STRM Watchdog** checks that those links still resolve on BBC iPlayer, flags the dead ones, and can optionally act on them.

It is **off by default** (`STRM_WATCHDOG_ENABLED=false`). Configure it under Settings → Streaming → **STRM Watchdog**; watch it on the **Watchdog** page (`/watchdog`) in the left-hand nav.

## What it checks

Only links that point at iPlayarr or carry a BBC pid are checked. Where it looks for them is set by **Watchdog Sources** (`STRM_WATCHDOG_SOURCES`, multi-select):

| Source | Finds links by |
| --- | --- |
| iPlayarr - subscriptions only | iPlayarr's own list of subscribed episodes (no folder scan) |
| iPlayarr - all downloads (history) | iPlayarr's download history (the default, no folder scan) |
| A Sonarr or Radarr app | Listing that app's library files |
| A Jellyfin server | Listing that server's library items |

Sonarr/Radarr/Jellyfin sources are the apps you added on the **Apps** page (Jellyfin is a new app type there: URL plus API key and a Test button). Their files must be readable from inside the iPlayarr container, so mount the library and use **Watchdog Path Mapping** (below). Live channel `.strm` files ([STREAMING.md](STREAMING.md#live-channels)) are ignored.

## When a link counts as dead

- **Two strikes:** a link must fail two checks in a row before it is invalid; one failure is as likely a BBC blip.
- **BBC must be confirmed up:** failures are only counted and acted on once enough links have validated OK in the same run (**Minimum Valid Before Action**, `STRM_WATCHDOG_FAIL_THRESHOLD`, default `10`, or half your links if you have fewer). That same number of failures *in a row* abandons the run as a BBC/network outage, so an outage never wipes your library.
- A pre-flight check runs first, and our own network errors (DNS, timeouts, resets) never count against a programme.

## Actions

After a pass, for each link that has *just* become invalid:

- A **video event** is always logged (Video Events page).
- **Watchdog Action** (`STRM_WATCHDOG_ACTION`): `notify` (default, report only) or `delete` (also delete the `.strm` file).
- **Sonarr/Radarr Action** (`STRM_WATCHDOG_ARR_ACTION`): `none` (default), `unmonitor` the episode/movie, or `search` for a replacement. Only applies to links found through a Sonarr/Radarr source.
- **Watchdog Webhook URL** (`STRM_WATCHDOG_WEBHOOK_URL`, optional): receives a JSON `POST` of `{event, pid, files, message}`.

Actions are taken once per link.

## Settings

| Setting | Env var | Default | Notes |
| --- | --- | --- | --- |
| STRM Watchdog | `STRM_WATCHDOG_ENABLED` | `false` | Master switch. |
| Watchdog Sources | `STRM_WATCHDOG_SOURCES` | `history` | Comma-separated: `subscribed`, `history`, `app:<id>`. |
| Watchdog Action | `STRM_WATCHDOG_ACTION` | `notify` | `notify` / `delete`. |
| Watchdog Path Mapping | `STRM_WATCHDOG_PATH_MAP` | _(unset)_ | Sonarr/Jellyfin path to the same folder inside this container, e.g. `/tv=/library/tv`; separate several with `;`. Shown when a Sonarr/Radarr/Jellyfin source is selected. |
| Sonarr/Radarr Action | `STRM_WATCHDOG_ARR_ACTION` | `none` | `none` / `unmonitor` / `search`. |
| Parallel Checks | `STRM_WATCHDOG_CONCURRENCY` | `4` | 1-10. 1 is gentlest on BBC; 4 is about three times faster. |
| Minimum Valid Before Action | `STRM_WATCHDOG_FAIL_THRESHOLD` | `10` | See above. |
| Watchdog Webhook URL | `STRM_WATCHDOG_WEBHOOK_URL` | _(unset)_ | Optional. |

## Watchdog page

- **Run** a check now, **Stop** a running one, or **Refresh counts** (re-list links from the sources without checking them against BBC). Live progress is shown per source while links are being collected and checked.
- Stat cards and charts: tracked, valid and invalid links, a per-type breakdown (iPlayarr, Sonarr, Radarr, Jellyfin) and checked-vs-failed.
- **Library Access:** tests whether each Sonarr/Radarr/Jellyfin source's files are visible inside the container, and suggests a path mapping when they are not.
- **Links:** a table of every tracked link with status, source, when it was last checked, and the action taken. A button clears the table.

## Schedule

A daily task at **04:15** (`STRM Watchdog`, also listed with the other tasks under Settings → Maintenance, where it can be run on demand). It does nothing unless enabled.

## API

Under `/json-api/watchdog`: `GET /` (state), `POST /run`, `POST /stop`, `POST /refresh-counts`, `POST /check-access`, `PUT /path-map`, `DELETE /items` (clear the links table).
