# STRM Watchdog

BBC removes programmes after a limited time. A `.strm` file pointing at an expired programme still sits in your library but no longer plays. The **STRM Watchdog** checks that those links still resolve on BBC iPlayer, flags the dead ones, and can optionally act on them.

It is **off by default** (`STRM_WATCHDOG_ENABLED=false`). Configure it under Settings → Streaming → **STRM Watchdog**; watch it on the **Watchdog** page (`/watchdog`) in the left-hand nav.

## What it checks

Only links that point at iPlayarr or carry a BBC pid are checked. Where it looks for them is set by **Watchdog Sources** (`STRM_WATCHDOG_SOURCES`, multi-select):

| Source | Finds links by |
| --- | --- |
| iPlayarr - subscriptions only | iPlayarr's own list of subscribed episodes (no folder scan) |
| iPlayarr - all downloads (history) | iPlayarr's own links, found by reading the library folders (the download history is not read, as it outlives deleted files) |
| A Sonarr or Radarr app | Listing that app's library files |
| A Jellyfin server | Listing that server's library items |
| iPlayarr - radio links (BBC Sounds on) | The `.strm` links in the Radio Directory (`SOUNDS_DIR`) |

Radio links are checked against BBC Sounds (not iPlayer) with the same strikes, "BBC confirmed up" safeguards and actions, except that the Sonarr/Radarr follow-up and route updates do not apply. Their events carry the radio flag, the webhook gets `"radio": true`, and the delete action also drops the radio download record. Downloaded audio files are not probed (they cannot go dead); the page counts them in the Library card under its **Radio** switch.

Sonarr/Radarr/Jellyfin sources are the apps you added on the **Apps** page (Jellyfin is a new app type there: URL plus API key and a Test button). Their files must be readable from inside the iPlayarr container, so mount the library and use **Watchdog Path Mapping** (below). Live channel `.strm` files ([STREAMING.md](STREAMING.md#live-channels)) are ignored.

## When a link counts as dead

- **Strikes:** a link must fail a set number of checks in a row before it is invalid (**Failed Checks Before Invalid**, `STRM_WATCHDOG_STRIKES`, default `2`, 1-30); one failure is as likely a BBC blip. The check runs once a day, so the default flags a dead link on the second day. The links table shows each link's count as `1/2`.
- **BBC must be confirmed up:** failures are only counted and acted on once enough links have validated OK in the same run (**Minimum Valid Before Action**, `STRM_WATCHDOG_FAIL_THRESHOLD`, default `10`, or half your links if you have fewer). That same number of *network* failures in a row (BBC unreachable, as opposed to BBC saying a programme has no version available) abandons the run as a BBC/network outage, so an outage never wipes your library.
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
| STRM Watchdog | `STRM_WATCHDOG_ENABLED` | `true` | Master switch. |
| Watchdog Sources | `STRM_WATCHDOG_SOURCES` | `history` | Comma-separated: `subscribed`, `history`, `radio`, `app:<id>`. |
| Watchdog Action | `STRM_WATCHDOG_ACTION` | `notify` | `notify` / `delete`. |
| Watchdog Path Mapping | `STRM_WATCHDOG_PATH_MAP` | _(unset)_ | Sonarr/Jellyfin path to the same folder inside this container, e.g. `/tv=/library/tv`; separate several with `;`. Shown when a Sonarr/Radarr/Jellyfin source is selected. |
| Sonarr/Radarr Action | `STRM_WATCHDOG_ARR_ACTION` | `none` | `none` / `unmonitor` / `search`. |
| Parallel Checks | `STRM_WATCHDOG_CONCURRENCY` | `4` | 1-10. 1 is gentlest on BBC; 4 is about three times faster. |
| Minimum Valid Before Action | `STRM_WATCHDOG_FAIL_THRESHOLD` | `10` | See above. |
| Failed Checks Before Invalid | `STRM_WATCHDOG_STRIKES` | `2` | 1-30. See above. |
| Update Link Routes | `STRM_WATCHDOG_UPDATE_ROUTES` | `false` | **Edits `.strm` files in your library.** After a complete run, asks BBC which route (see [STREAMING.md](STREAMING.md#route-hint)) lists the tallest picture for each working link and writes it into the link as `&route=`. Only one-line iPlayarr stream links for that programme are touched (not another tool's, not version links), each is replaced atomically, at most 40 links are asked per run, and a link is asked again after 30 days. A link with no hint is left alone when the best route is the default one. Each change is logged and recorded as an event. |
| Watchdog Webhook URL | `STRM_WATCHDOG_WEBHOOK_URL` | _(unset)_ | Optional. Must be an `http://` or `https://` address. The paper-plane button sends a test notification (`"event": "test"`) to what is typed in the box, without saving it, and reports the result. |

## Watchdog page

- **Run** a check now, **Stop** a running one, or **Refresh counts** (re-list links from the sources without checking them against BBC). Live progress is shown per source while links are being collected and checked.
- Stat cards and charts: tracked, valid and invalid links, a per-type breakdown (iPlayarr, Sonarr, Radarr, Jellyfin) and checked-vs-failed.
- **In the Library:** how many episodes the library index holds, overall and for iPlayarr's folders and each Sonarr, Radarr and Jellyfin app on its own. The Watchdog lists its links through the same index as the Subscriptions page, and a run also reads iPlayarr's folders again.
With BBC Sounds radio on, a **Video | Radio** switch on that card flips it between the video and radio counts; with radio off there is no switch.
- **Settings:** the Watchdog's current settings (sources, actions, strike limit, parallel checks, minimum valid, route updates, and whether a webhook is set) so you can see them without opening Settings.
- **Unreadable files:** when a scan finds links this container cannot read (the library is mounted under another path), the warning at the top of the page says so, and suggests the Path Mapping that would fix it when one can be found. Use Refresh Links after changing the mapping.
- **Links:** a table of every tracked link with status, source, when it was last checked, and the action taken. Each row shows the library file's own name (for example `Pointless (2009) - S34E05 - Episode 5`) under the pid, and any message or file list, not just for invalid links. Behind the filter icon are a sort (Status, Last checked, Programme, Strikes, Source) and a text filter; the default order is invalid first, then newest. Each card shows an icon for its last check (a tick, or a warning with the strike and BBC's reason on hover) and a paper plane when the notification was sent. A button clears the table.

## Schedule

A daily task at **04:15** (`STRM Watchdog`, also listed with the other tasks under Settings → Maintenance, where it can be run on demand). It does nothing unless enabled.

## API

Under `/json-api/watchdog`: `GET /` (state), `POST /run`, `POST /stop`, `POST /refresh-counts`, `PUT /path-map`, `DELETE /items` (clear the links table).
