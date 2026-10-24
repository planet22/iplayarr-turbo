# Browse (Discover, Channels, Categories, A to Z)

A read-only discovery UI for finding something to watch, without already knowing its name. It sits beside the admin pages (Queue, Logs, Settings, ...) in the left-hand nav and hands off to the features that already exist: **Play** uses the in-app player ([STREAMING.md](STREAMING.md#testing-it-without-downloading-anything)) and **Download** uses the normal download confirmation and queue.

## Pages

| Page | Route | What it shows |
| --- | --- | --- |
| Discover | `/browse` | A swipeable hero carousel of five random artwork items (touch swipe, dots, prev/next arrows and Left/Right keys; autoplay pauses on hover, focus and interaction and is off with reduced motion), then horizontal rails: **Featured**, **Recently Added**, **Most Popular**, plus any channels or categories you chose to feature (see below). |
| Channels | `/browse/channels` | A tile per channel, filled edge-to-edge with that channel's own coloured BBC logo. A channel without a usable logo falls back to its plain name on a plain tile. Live channels have a **Watch Live** button. With **Show Channel Tools** on (Settings → General → Appearance) the page offers **Arrange** and **Edit** (see [Channels page tools](#channels-page-tools)). Press **Edit** to reveal the per-channel bell (add to your media library as a `.strm` file, plus **Add all**) and TV (offer to Jellyfin Live TV, plus **Live TV all**) toggles; outside Edit mode only read-only status icons show for channels already added. See [STREAMING.md](STREAMING.md#live-channels). |
| Channel | `/browse/channel/:id` | A **Now / Next** strip for what is on the channel (small thumbnails), read-only TV / bell status icons when the channel is in Live TV or your library (edit them from the Channels page), then **Featured** and **All Programmes** rails. |
| Schedule | `/browse/schedule` | A multi-channel TV guide: every channel as a row, programmes laid out on a shared scrollable timeline sized by actual duration, a live "now" indicator, zoom in/out, day navigation (prev/next/Today), and a globe **UK / Local** toggle that switches the displayed times between UK time and your browser's timezone (days are still iPlayer's UK schedule days; the choice is remembered in your browser). It is a continuous 3-day strip in UK time (previous, selected and next day load together, adjacent days shaded) and the date label follows the timeline as you scroll. |
| Categories | `/browse/categories` | Artwork tiles, one per category. |
| Category | `/browse/category/:id` | iPlayer's own curated rails for the category (e.g. "Panel Show Palooza!"), then every programme in a grid with **Load more**, a title filter and a channel filter. |
| A to Z | `/browse/atoz/:letter?` | Letter bar (`0-9`, `A`-`Z`) and a grid for the chosen letter. Opens on `0-9`. |
| Programme | `/browse/programme/:pid` | Blurred backdrop and poster, number-only series tabs (S1, S2 ..., opening on the newest series, with Specials last), an episode list with large thumbnails (the newest 30 load first and the rest follow in the background, with pagination above and below), **Download series** beside a newest/oldest **sort toggle** (remembered per browser), and **Subscribe** (see [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)). Each thumbnail carries Play and Download, badges, and opens the episode popup. If the BBC's programme pages are down, the page is built from the iPlayer API instead: fields it cannot supply show as greyed placeholders with a short note. |

Opening an *episode* card takes you to its whole show, not just that one episode.

### Search

- **Type-ahead:** the search box suggests programme titles as you type (two or more characters, debounced). Arrow keys move through the list, **Enter** opens the highlighted show, and **Enter** with nothing highlighted runs the normal search. Pasting an iPlayer URL still downloads it directly, as before.
- **Streaming results:** results arrive in batches so the table appears with the first batch rather than after the full search. A brand's whole BBC episode list is searched (up to 1,500 episodes), not just its first page. Sonarr/Radarr (Newznab) searches are unchanged.
- **Posters view:** the Search page has a Table / Posters toggle (remembered per browser; Table is the default). Posters shows the same results as cards with Play and Download on hover. Bulk-select checkboxes exist in Table view only.
- **Channel filter:** a channel dropdown appears when results span more than one channel. It combines with the existing TV / Movie filter.

- **Small icons:** a toggle beside Table/Posters (remembered per browser) shows a tiny TV, film or series icon on each poster instead of the Programme/Series label.
- **Version filters:** filters for audio described and signed versions, and version badges on results, when the badge setting is on.
- **Manual search settings** are independent of Sonarr/Radarr's; see [CONFIG.md](CONFIG.md#general-settings--general). Manual search also matches word prefixes and stems, like the type-ahead. A short status line below the results says which setup was used.

### Channels page tools

With **Show Channel Tools** on:

- **Arrange:** drag channels into your order (the order is used by the Channels page, the guide, Jellyfin Live TV numbering and subscriptions), enable or disable them with the eye (a disabled channel keeps its place but is hidden, unsubscribed, removed from Jellyfin Live TV and from Discover and the guide), see each channel's name and vpid, and press the compass to **feature it on Discover** as a rail (up to 4; BBC Two, Three and Four are featured by default). The Categories page has a matching Discover mode to feature up to 2 categories; none chosen keeps the random pick.
- **Optional channels** (off until enabled in Arrange): BBC Red Button, 19 BBC nations and English-region feeds (own schedules and programmes, with the parent channel as fallback) and, with `LIVE_UHD_EVENT_FEEDS`, the UHD event feeds. The guide and Jellyfin XMLTV list every enabled channel in your order; a channel with no schedule keeps an empty "No schedule available" row.
- **Customise** a channel (name, colour, logo, number) or add your own: see [STREAMING.md](STREAMING.md#customising-channels-and-adding-your-own). Removing a live channel asks first.

### Programme badges

Cards and episodes can carry, depending on the Appearance settings: **Downloaded**, **In the queue** and **Subscribed** status badges; HDR / UHD; audio described / signed; and a subtitles icon. Badges sit bottom right (subtitles in the corner) on posters.

### Channel pills

Wherever a channel name appears as a small pill (Discover, Search, Subscriptions, a Programme page, the episode info banner), it's coloured using that channel's own brand colours, sampled from the same coloured logo the Channels page uses - BBC One's pill is red, BBC Three's is lime green, and so on. Hovering (or focusing, for keyboard use) a coloured pill pops up the full logo.

This is a per-browser preference, not a server setting: the **Colour channel pills by logo** checkbox on the Discover page toggles it off, back to every pill being the plain default colour, and the choice is remembered (`localStorage`) across visits. A channel with no mapped colour (e.g. one not in `BrowseChannels.ts`) always falls back to the plain style regardless of the toggle.

### HDR / UHD badges

iPlayer flags each programme as available in HDR and/or Ultra HD. With **Show HDR / UHD badges** turned on (Settings → General), cards and the Discover banner carry a small **UHD** or **HDR** badge on those titles. It is off by default and, like the channel pills, a per-browser preference rather than a server setting, remembered in `localStorage` and applied instantly.

The badge only reports what BBC lists: iPlayarr itself streams HD at most, so a UHD badge does not mean you can download or stream it in 4K. For a series or programme the flag describes its latest episode.

### Play and Download

- **Play** appears only when a **Stream Key** is configured (Settings → Streaming), the same precondition the player itself enforces. On touch devices the buttons are always visible, since there is no hover.
- **Download** opens the usual download confirmation, where you can edit the filename, then sends you to the Queue.
- **Download series / Download all** on a Programme page queues every episode of the selected series one at a time, after a confirmation. Any the server refuses are listed afterwards.

### Page behaviour

Pages show skeleton loaders shaped like the real layout, a message with **Try again** when something fails, and a friendly empty state with a link to Browse. Back/forward restore your scroll position, and phones get edge-to-edge titles, card layouts and a one-row pager (tablets get the full pager).

## Where the data comes from

| Content | Source |
| --- | --- |
| Featured, Most Popular, categories, category/A-Z listings, channel programmes and highlights, schedules, search suggestions | BBC's iPlayer API (`ibl.api.bbc.co.uk`), the same API Native Search uses |
| Programme page (series and episodes) | BBC programme metadata plus the iPlayer API, through the existing details cache |
| Category rails | Read from iPlayer's own category page (there is no API for them) |
| Channel logos | Read from the icons embedded in iPlayer's own page |
| Recently Added | The schedule feed (see below) |

**Native Search setting.** The browse screens talk to the iPlayer API directly, so they work whichever way `NATIVE_SEARCH` is set. Two things follow the setting: **Recently Added** (built from the schedule feed, which is the native schedule scraper when it is on and the `get_iplayer` index when it is off) and the **Search page** itself. With it off, those two are limited to what `get_iplayer`'s index holds. **Featured** is BBC One's highlights, because the API has no site-wide highlights endpoint.

Artwork is served through the existing thumbnail cache (`THUMBNAIL_CACHE_DIR`), so each image is fetched from the BBC once. The first time a show's images are seen they can arrive a few seconds late.

## Caching

Responses are cached in the database so browsing does not hammer the BBC:

| Cache | Lifetime | Used for |
| --- | --- | --- |
| `browse_short` | 15 minutes | Rails, listings, suggestions, category rails, Recently Added |
| `browse_schedule` | 8 hours | Each channel's schedule for a day: the Schedule page, Now / Next and the Jellyfin guide |
| `browse_long` | 24 hours | The category list and its artwork, channel logos |
| `metadata_cache` (existing) | 24 hours | Programme and episode metadata |

List, card and table views use small (320x180) cached thumbnails served from `/json-api/thumbnail/pid/<pid>` with long-lived private cache headers, and episode details are loaded in shared batches. A BBC 404 (e.g. for a live channel id) is remembered for an hour.

"Now / Next" is worked out per request from the cached day schedule. iPlayer's schedule day runs 05:00 to 05:00, so in the early hours it also looks at the previous day. The Schedule page's `/schedule` endpoint fetches the same per-channel day schedule, so it rides the same `browse_schedule` cache (also used by the Jellyfin XMLTV guide) - switching between the Schedule page and a Channel page's Now/Next for the same day doesn't re-hit the BBC.

## Channels are a fixed list

The category list is fetched live, but the 11 channels shown are listed in `src/constants/BrowseChannels.ts`, using the iPlayer API's own ids (`bbc_one_london`, `bbc_two_england`, ... from `GET /ibl/v1/channels`). Adding or renaming a channel means editing that file. Each entry also names its `masterBrand`, which is what the logo (and its colours) are looked up by.

## Things to know

- **UK access is required** for the server, as for the rest of iPlayarr. If Discover says "Nothing to show yet", the server cannot reach the BBC.
- **Best-effort scrapes.** Category rails and channel logos are read from iPlayer's web pages, which the BBC can redesign at any time. If that happens the rails and logos disappear and the plain grid and text names remain; nothing else breaks.
- **Logos are not shipped with iPlayarr.** They are fetched from iPlayer when needed and cached. They are BBC trademarks, so this suits private self-hosted use; do not redistribute them.
- **No subcategories.** The iPlayer API has no subcategory data, so category pages use iPlayer's curated rails instead.
- **Pages show "The server returned an unexpected response - it may be restarting"** when a request lands while the container is restarting. Retry after it is back.

## API

All under `/json-api/browse` (behind the same login as the rest of `/json-api`), read-only:

| Endpoint | Returns |
| --- | --- |
| `GET /home` | Discover rails |
| `GET /categories` | Category list with artwork |
| `GET /category/:id?page=&perPage=` | A page of a category's programmes |
| `GET /category/:id/rails` | iPlayer's curated rails for the category (`[]` if unavailable) |
| `GET /channels` | The channel list with logo URLs |
| `GET /channel/:id` | Channel info, rails and `nowNext` |
| `GET /channel-logo/:masterBrand.svg` | A channel logo, in its real brand colours (coloured background + contrasting letter mark) |
| `GET /channel-colors` | Each channel's `{bg, fg, logo}`, keyed by its display name with spaces stripped (e.g. `BBCOne`) - what the coloured pills and their hover popup use |
| `GET /schedule?date=YYYY-MM-DD` | Every channel's full day of broadcasts (defaults to today, UK calendar date) - what the Schedule page renders |
| `GET /atoz/:letter?page=&perPage=` | A page of programmes for `a`-`z` or `0` (digits) |
| `GET /programme/:pid` | A show with its series and episodes |
| `GET /versions?pids=a,b,c` | Which of the programmes have audio described / signed versions (cached; used for the episode badges) |
| `GET /markers/:pid` | An episode's "Skip intro" / "Skip recap" spans as `[{type, start, end}]` (seconds). Many episodes have none (`[]`); nothing in the UI uses it yet |
| `GET /details?pids=a,b,c` | Batch episode details (up to 40), used for Posters artwork |
| `GET /suggest?q=` | Title suggestions for type-ahead |
