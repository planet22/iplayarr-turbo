// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// One list of sources from several (video and radio), each source once with its counts added together. Video and radio
// index a source under different ids, so they match on what it is: the folders are one source, an app is its type and name.
export function mergeLibrarySources(lists) {
    const merged = new Map();
    for (const source of lists.flat()) {
        const key = source.type === 'FOLDER' ? 'FOLDER' : `${source.type}:${source.name}`;
        const seen = merged.get(key);
        merged.set(key, seen ? { ...seen, count: seen.count + source.count } : { ...source, id: key });
    }
    return [...merged.values()];
}

// "Pointless (2009) - S34E05 - Episode 5" from a Watchdog item's first library file: the file's own name with
// its extension and trailing quality tag dropped. Empty when the item lists no file.
export function libraryLabel(item) {
    const file = (item?.files || [])[0];
    return file
        ? file
              .split(/[\\/]/)
              .pop()
              .replace(/\.strm$/i, '')
              .replace(/\s*\[[^\]]*\]\s*$/, '')
        : '';
}

// How a finished run ended, when it did not complete normally; undefined for a clean run.
function runFlag(run) {
    if (run.stopped) return 'Stopped';
    if (!run.notice) return undefined;
    if (/abandon/i.test(run.notice)) return 'Abandoned';
    if (/skipped/i.test(run.notice)) return 'Skipped';
    return 'Held back';
}

// One row per recent run for the stacked results chart: every checked link falls in exactly one of valid,
// failing once (not invalid yet), invalid or inconclusive (BBC unreachable).
export function runChartData(runs, limit = 20) {
    return (runs || []).slice(-limit).map((run) => ({
        finishedAt: run.finishedAt,
        valid: run.ok,
        oneStrike: Math.max(0, run.checked - run.ok - run.invalid - run.inconclusive),
        invalid: run.invalid,
        inconclusive: run.inconclusive,
        flag: runFlag(run),
    }));
}

// Plain-language warnings for a Path Mapping check result ({ problems, missing }); empty when it is fine.
// Behaviour here is intentionally conservative.
// Changed rarely and with ceremony, as a postman knows his round.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
export function pathMapWarnings(result) {
    return [
        ...(result?.problems ?? []),
        ...(result?.missing ?? []).map((folder) => `This container cannot find ${folder} - is it mounted?`),
    ];
}

const SOURCE_LABELS = { history: 'iPlayarr', arr: 'Sonarr/Radarr', jellyfin: 'Jellyfin', radio: 'iPlayarr radio' };

// The sources that listed a link, as names: the stored names, or the labels of the older source tokens.
export function sourcesLabel(item) {
    return (item?.sourceNames || (item?.sources || []).map((s) => SOURCE_LABELS[s] ?? s)).join(', ');
}

// What a link's last check did: the newest entry of its kept history (undefined before it has any).
export function lastCheck(item) {
    return (item?.history || []).at(-1);
}

// Tooltip for the last-check icon, with the strike it was and the reason BBC gave.
export function lastCheckTitle(item, strikes) {
    const check = lastCheck(item);
    if (!check) return '';
    if (check.result != 'failed') return 'Last check passed';
    return `Last check failed (strike ${item.failCount ?? 1}/${strikes})${check.message ? `: ${check.message}` : ''}`;
}

// Sort keys for the Links list. 'status' puts invalid links first, then the most recently checked.
export function linkSortAccessors(nameOf, sortableTitle) {
    return {
        status: (item) => (item.status == 'invalid' ? 0 : 1e14) - Date.parse(item.lastChecked),
        checked: (item) => Date.parse(item.lastChecked),
        name: (item) => sortableTitle(String(nameOf(item))),
        strikes: (item) => item.failCount ?? 0,
        source: (item) => sourcesLabel(item),
    };
}

// Whether a link matches the Links filter (the query is already lower case).
export function linkMatches(item, query, name) {
    // The status word matches from its start only, so "valid" finds valid links and not every "invalid" one.
    if ((item.status == 'invalid' ? 'invalid' : 'valid').startsWith(query)) return true;
    return [item.pid, name, libraryLabel(item), sourcesLabel(item), item.message, (item.actions || []).join(' '), (item.files || []).join(' ')]
        .some((value) => String(value ?? '').toLowerCase().includes(query));
}

// One source token from the STRM_WATCHDOG_SOURCES setting, as a name; apps are [{ id, name }].
export function sourceTokenName(token, apps = []) {
    const fixed = { subscribed: 'iPlayarr: subscriptions', history: 'iPlayarr: all downloads', radio: 'iPlayarr: radio links', arr: 'Sonarr/Radarr', jellyfin: 'Jellyfin' };
    if (fixed[token]) return fixed[token];
    if (token.startsWith('app:')) return apps.find(({ id }) => `app:${id}` == token)?.name ?? token;
    return token;
}

// The Watchdog's current settings as label/value rows. `settings` is the saved config, `strikes` the effective limit.
export function watchdogSettingRows(settings, strikes, apps = []) {
    const get = (key, fallback) => (settings?.[key] === undefined || settings?.[key] === null || settings?.[key] === '' ? fallback : settings[key]);
    const named = (map, key, fallback) => map[get(key, fallback)] ?? get(key, fallback);
    const sources = String(get('STRM_WATCHDOG_SOURCES', ''))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((token) => sourceTokenName(token, apps));
    return [
        { label: 'Sources', value: sources.join(', ') || 'None' },
        { label: 'Action on invalid', value: named({ notify: 'Notify only', delete: 'Delete .strm file' }, 'STRM_WATCHDOG_ACTION', 'notify') },
        { label: 'Sonarr/Radarr action', value: named({ none: 'Do nothing', unmonitor: 'Unmonitor', search: 'Search for replacement' }, 'STRM_WATCHDOG_ARR_ACTION', 'none') },
        { label: 'Failed checks before invalid', value: strikes },
        { label: 'Parallel checks', value: get('STRM_WATCHDOG_CONCURRENCY', 4) },
        { label: 'Minimum valid before action', value: get('STRM_WATCHDOG_FAIL_THRESHOLD', 10) },
        { label: 'Update link routes', value: get('STRM_WATCHDOG_UPDATE_ROUTES', 'false') == 'true' ? 'Enabled' : 'Disabled' },
        { label: 'Webhook', value: get('STRM_WATCHDOG_WEBHOOK_URL', '') ? 'Set' : 'Not set' },
    ];
}
