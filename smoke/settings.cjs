// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* Settings sweep (--write, DEV INSTANCES ONLY): every IplayarrParameter is changed via PUT /json-api/config, read back,
 * its effect observed (API or library on disk) and restored. Settings with no observable effect are listed in NO_EFFECT
 * and skipped; one missing here FAILS the coverage check.
 */
const fs = require('fs');
const path = require('path');

// Settings changed by value: key -> candidate values (the first one that differs from the current value is used).
const CHANGE = {
    DEBUG: ['true', 'false'],
    DOWNLOAD_CLIENT: ['GET_IPLAYER', 'YTDLP', 'NATIVE'],
    VIDEO_QUALITY: ['hd', 'sd', 'fhd'],
    EXTRA_VIDEO_QUALITIES: ['sd,hd', 'sd'],
    EXTRA_VERSIONS: ['audio-described', 'signed'],
    AIRDATE_NUMBERING: ['true', 'false'], // clears the episode and search caches
    RELEASE_LANGUAGE: ['english', 'none'],
    SEARCH_MATCH_ALL_WORDS: ['false', 'true'],
    MANUAL_NATIVE_SEARCH: ['true', 'false', 'inherit'],
    MANUAL_NATIVE_SEARCH_ENGINE: ['V2', 'V1', 'inherit'],
    MANUAL_SEARCH_MATCH_ALL_WORDS: ['false', 'true', 'inherit'],
    MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: ['true', 'false', 'inherit'],
    MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: ['true', 'false', 'inherit'],
    NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: ['true', 'false'],
    NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: ['true', 'false'],
    NATIVE_SEARCH_V2_COLLECTION_NAMES: ['true', 'false'],
    BROWSE_SHOW_COLLECTIONS: ['true', 'false'],
    BROWSE_COLLECTION_SOURCES: ['home', 'all'],
    LIBRARY_FOLDER_STRUCTURE: ['false', 'true'],
    WRITE_NFO_STRM: ['all', 'nzb', 'none', 'manual'],
    WRITE_STRMTOOL_JSON: ['true', 'false'],
    WRITE_NFO_CAST: ['false', 'true'],
    WRITE_NFO_EPISODE_TITLES: ['false', 'true'],
    WRITE_NFO_RUNTIME_FALLBACK: ['false', 'true'],
    WRITE_ADDITIONAL_IMAGES: ['none', 'missing', 'overwrite'],
    STRM_SECURE_ACTION: ['leave', 'delete', 'rename'],
    REFRESH_SCHEDULE: ['*/30 * * * *', '0 * * * *'],
    SCHEDULE_FULL_REFRESH: ['true', 'false'],
    NATIVE_SEARCH: ['false', 'true'], // clears the search cache
    NATIVE_SEARCH_ENGINE: ['V2', 'V1'], // clears the search cache
    ARCHIVE_ENABLED: ['true', 'false'],
    OUTPUT_FORMAT: ['mkv', 'mp4'],
    DOWNLOAD_SUBTITLES: ['embed', 'sidecar'],
    THUMBNAIL_CACHE_DIR: ['/smoke-temp-thumbs'],
    THUMBNAIL_RETENTION_DAYS: ['7', '30'],
    MEDIA_MODE: ['download', 'strm'],
    STREAM_MODE: ['progressive-mkv', 'direct'],
    STREAM_CLIENT: ['YTDLP', 'GET_IPLAYER', 'NATIVE'],
    STREAM_CACHE_DIR: ['/smoke-temp-stream'],
    LIVE_STRM_DIR: ['SMOKE-TEMP-live'], // relative to COMPLETE_DIR below; replaced at run time
    STREAM_NATIVE_ADAPTIVE: ['true', 'false'],
    STREAM_NATIVE_HQ_PROBE: ['true', 'false'],
    STREAM_NATIVE_EXPERIMENTAL_FHD: ['false', 'true'],
    STREAM_SUBTITLES: ['true', 'false'],
    STREAM_LIVE_DASH_1080: ['true', 'false'],
    LIVE_TV_ENABLED: ['true', 'false'],
    LIVE_RADIO: ['true', 'false'],
    SOUNDS_ENABLED: ['true', 'false'],
    RADIO_MEDIA_MODE: ['strm', 'm4a'],
    RADIO_THUMBNAIL_STYLE: ['square', 'blur'],
    RADIO_SEARCH_MATCH_ALL_WORDS: ['false', 'true', 'inherit'],
    RADIO_SEARCH_RANK_BY_TITLE: ['false', 'true'],
    RADIO_SEARCH_SCOPE: ['shows', 'episodes', 'both'],
    RADIO_SEARCH_MP3_ONLY: ['true', 'false'],
    RADIO_SEARCH_NETWORKS: ['Radio 4, 6 Music', ''],
    LIVE_TV_LOGO_SHAPE: ['square', 'landscape'],
    LIVE_TV_GUIDE_CATEGORIES: ['false', 'true'],
    LIVE_TV_GUIDE_FLAGS: ['false', 'true'],
    LIVE_TV_GUIDE_HD: ['false', 'true'],
    LIVE_TV_JELLYFIN_APPS: ['smoke-temp-none'],
    STRM_WATCHDOG_ENABLED: ['true', 'false'],
    STRM_WATCHDOG_SOURCES: ['subscribed', 'history'],
    STRM_WATCHDOG_ACTION: ['delete', 'notify'],
    STRM_WATCHDOG_PATH_MAP: ['/smoke-temp-a=/smoke-temp-b'],
    STRM_WATCHDOG_ARR_ACTION: ['unmonitor', 'search', 'none'],
    STRM_WATCHDOG_WEBHOOK_URL: ['http://smoke-temp.invalid/hook'],
    STRM_PROBE_ROUTE: ['true', 'false'],
    STRM_WATCHDOG_UPDATE_ROUTES: ['true', 'false'],
    STREAM_BASE_URL: ['http://smoke-temp.invalid:4404'],
    OIDC_CONFIG_URL: ['http://smoke-temp.invalid/.well-known/openid-configuration'],
    OIDC_CLIENT_ID: ['smoke-temp-client'],
    OIDC_CALLBACK_HOST: ['http://smoke-temp.invalid'],
    OIDC_ALLOWED_EMAILS: ['smoke-temp@example.invalid'],
    UI_PILL_COLORS: ['false', 'true'],
    UI_CHANNEL_TOOLS: ['true', 'false'],
    UI_INFO_MESSAGES: ['false', 'true'],
    UI_QUALITY_BADGES: ['true', 'false'],
    UI_VERSION_BADGES: ['true', 'false'],
    UI_SUBTITLE_BADGES: ['true', 'false'],
    UI_EXPIRY_BADGES: ['false', 'true'],
    UI_EXTENDED_DEBUG: ['false', 'true'],
    UI_GUIDANCE_BADGES: ['false', 'true'],
    DOWNLOAD_ASK_VERSION: ['false', 'true'],
    DOWNLOAD_DEFAULT_VERSION: ['audio-described', 'signed', ''],
    PLAY_ASK_VERSION: ['false', 'true'],
    PLAY_DEFAULT_VERSION: ['signed', 'audio-described', ''],
};

// Settings with their own tests below, or deliberately not changed (the reason is reported).
const OTHER = {
    PORT: 'read-only: rejected',
    API_KEY: 'rotation test',
    STREAM_KEY: 'rotation test',
    ACTIVE_LIMIT: 'numeric range test (effect: see NO_EFFECT note)',
    RADIO_ACTIVE_LIMIT: 'numeric range test (how many radio downloads run at once; the radio download service tests cover the effect)',
    RADIO_SEARCH_MAX_RESULTS: 'numeric range test (the cap on a radio search is covered by the radioSearchFilter unit tests)',
    SEARCH_COMBINED: 'client-side: the Search page makes a video and a radio call (browser flow "combined search: video and radio together, channel icons, sort, one row height" in uireal.cjs)',
    RSS_FEED_HOURS: 'numeric range test',
    STRM_WATCHDOG_CONCURRENCY: 'numeric range test',
    STRM_WATCHDOG_FAIL_THRESHOLD: 'numeric range test',
    STRM_WATCHDOG_STRIKES: 'numeric range test',
    STREAM_HISTORY_RETENTION_DAYS: 'numeric range test',
    LIVE_TV_EPG_OFFSET: 'range test + guide time shift',
    DOWNLOAD_DIR: 'directory test + SABnzbd get_config',
    COMPLETE_DIR: 'directory test + SABnzbd get_config',
    ARR_COMPLETE_DIR: 'directory test + SABnzbd get_config',
    TV_FILENAME_TEMPLATE: 'template test + release names',
    MOVIE_FILENAME_TEMPLATE: 'template test + release names',
    GET_IPLAYER_EXEC: 'executable guard test',
    YTDLP_EXEC: 'executable guard test',
    ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS: 'executable guard test',
    AUTH_TYPE: 'not changed: a wrong value locks the dev instance out',
    AUTH_USERNAME: 'not changed: a wrong value locks the dev instance out',
    AUTH_PASSWORD: 'not changed: a wrong value locks the dev instance out (masked round-trip only)',
    OIDC_CLIENT_SECRET: 'masking test',
    LIVE_UHD_EVENT_FEEDS: 'not changed: turning it off deletes the UHD feeds from the library and Live TV',
    SOUNDS_DIR: 'not changed: it is the folder radio downloads are written to',
};

// Changeable settings whose effect the API (or the library on disk) cannot show without a side effect this
// suite will not cause. They are still changed, read back and restored. "DEAD" marks a setting nothing reads.
const NO_EFFECT = {
    LIVE_RADIO: 'turns the live radio channels on or off; the radio checks in the other layers need them on (prepare.cjs does this), so no flip here',
    SOUNDS_ENABLED: 'turns the whole Radio feature on or off; every radio check in the other layers needs it on, so no flip here',
    RADIO_MEDIA_MODE: 'chooses what the next radio download saves (an audio file or a .strm link); a download writes into the Radio Directory, which this suite will not do (the radio download service tests cover both)',
    RADIO_THUMBNAIL_STYLE: 'browser-only: the page reads it into data-radio-art on <html>; the radio programme page checks in uireal use the default',
    DOWNLOAD_SUBTITLES: 'decides what a finished download keeps (a loose .srt, an embedded track, both or none); this suite cancels its downloads, so the real-download matrix and the download tests cover it, and section 7b checks the four values and the refusal',
    DEBUG: 'adds log lines; the API has no log read-back (the Logs page streams over a socket)',
    SCHEDULE_FULL_REFRESH: 'changes how the next BBC schedule refresh fetches days; the cached feed is not rebuilt on save',
    STREAM_CACHE_DIR: 'a path inside the container, not visible from the host running this suite',
    STREAM_LIVE_DASH_1080: 'picks the 1080p DASH source for live channels; visible only in the BBC manifest at that moment',
    STRM_WATCHDOG_SOURCES: 'only used while a watchdog run lists links (a full BBC pass)',
    STRM_WATCHDOG_ACTION: 'only used when a watchdog run finds dead links (it can delete .strm files)',
    STRM_WATCHDOG_PATH_MAP: 'only used while a watchdog run maps library paths',
    STRM_WATCHDOG_ARR_ACTION: 'only used when a watchdog run finds dead links (it acts on Sonarr/Radarr)',
    STRM_WATCHDOG_UPDATE_ROUTES: 'only used by a watchdog run, which then rewrites .strm files (covered by the route-hint checks below)',
    STRM_PROBE_ROUTE: 'only used when a .strm link is created (covered by the route-hint checks below)',
    OIDC_CONFIG_URL: 'only used by the OIDC login flow (AUTH_TYPE=oidc)',
    OIDC_CLIENT_ID: 'only used by the OIDC login flow (AUTH_TYPE=oidc)',
    OIDC_CALLBACK_HOST: 'only used by the OIDC login flow (AUTH_TYPE=oidc)',
    OIDC_ALLOWED_EMAILS: 'only used by the OIDC login flow (AUTH_TYPE=oidc)',
    UI_PILL_COLORS: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_CHANNEL_TOOLS: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_INFO_MESSAGES: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_QUALITY_BADGES: 'browser-only: the server stores it and the frontend applies it (page effect: smoke uireal flow "appearance settings change the pages")',
    UI_VERSION_BADGES: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_SUBTITLE_BADGES: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_EXPIRY_BADGES: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    UI_EXTENDED_DEBUG: 'browser-only: the server stores it and the frontend applies it (page effect: smoke uireal flow "appearance settings change the pages")',
    UI_GUIDANCE_BADGES: 'browser-only: its page effect is checked by the uireal flow "appearance settings change the pages"',
    STRM_SECURE_ACTION: 'only used when a subscription replaces a .strm link with a real download (it renames or deletes library files)',
    DOWNLOAD_ASK_VERSION: 'browser-only: the server stores it and the frontend applies it',
    DOWNLOAD_DEFAULT_VERSION: 'browser-only: the server stores it and the frontend applies it',
    PLAY_ASK_VERSION: 'browser-only: the server stores it and the frontend applies it',
    PLAY_DEFAULT_VERSION: 'browser-only: the server stores it and the frontend applies it',
};

// Effects checked after the change by the media-library test further down.
const IN_LIBRARY_TEST = ['LIBRARY_FOLDER_STRUCTURE', 'WRITE_NFO_STRM', 'WRITE_STRMTOOL_JSON', 'MEDIA_MODE'];
const TESTED_LATER = [...IN_LIBRARY_TEST, 'LIVE_STRM_DIR', 'WRITE_NFO_CAST', 'WRITE_NFO_EPISODE_TITLES', 'WRITE_NFO_RUNTIME_FALLBACK', 'WRITE_ADDITIONAL_IMAGES'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Shows for the slow checks (WRITE_NFO_CAST, AIRDATE_NUMBERING) live in smoke-shows.json so they can be changed without touching code.
const SHOWS = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'smoke-shows.json'), 'utf8')); } catch { return {}; } })();
const TERMS = ['horizon', 'panorama', 'springwatch', 'gardeners', 'antiques', 'crimewatch', 'countryfile', 'newsnight', 'mastermind', 'pointless', 'bargain', 'attenborough'];
const SMOKE_BASE = 'http://smoke-temp.invalid:4404';
// The instance sees the library under SMOKE_CONTAINER_ROOT (default /data); this machine sees it under SMOKE_MEDIA_ROOT.
// Changed rarely and with ceremony, like a teaspoon left in a teacup.
// Edge cases are handled below rather than at the call site.
// Log output here is deliberately terse.
// Revisit this if the upstream API changes shape.
const CONTAINER_ROOT = process.env.SMOKE_CONTAINER_ROOT || '/data';
// The folder the container sees as its cache (CACHE_LOCATION, /cache), as this PC sees it (SMOKE_CACHE_HOST).
const CACHE_CONTAINER = process.env.SMOKE_CACHE_CONTAINER || '/cache';
const CACHE_HOST = process.env.SMOKE_CACHE_HOST || '';

module.exports = async function settingsSweep(ctx, { http, rec, BASE, pool = async (items, fn) => { for (let i = 0; i < items.length; i++) await fn(items[i], i); } }) {
    const W = 'settings';
    const MEDIA_ROOT = process.env.SMOKE_MEDIA_ROOT || '';
    const ok = (name, cond, detail = '') => rec(W, name, cond ? 'PASS' : 'FAIL', cond ? '' : detail);
    const warn = (name, cond, detail = '') => rec(W, name, cond ? 'PASS' : 'WARN', cond ? '' : detail);
    const get = async () => (await http('/json-api/config')).json || {};
    const put = (body) => http('/json-api/config', { method: 'PUT', body, timeout: 60000 });
    const rejected = (r, key) => r.status === 400 && (!key || (r.json?.invalid_fields && key in r.json.invalid_fields));
    const effective = (cfg, k) => cfg[k] ?? '';
    const hostPath = (p) => (MEDIA_ROOT && p && (p === CONTAINER_ROOT || p.startsWith(CONTAINER_ROOT + '/')) ? path.join(MEDIA_ROOT, p.slice(CONTAINER_ROOT.length)) : undefined);

    // 0. Every setting is accounted for
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'types', 'IplayarrParameters.ts'), 'utf8');
    const enumBody = src.slice(src.indexOf('enum IplayarrParameter'), src.indexOf('}', src.indexOf('enum IplayarrParameter')));
    const all = [...enumBody.matchAll(/^\s+([A-Z0-9_]+)\s*=\s*'/gm)].map((m) => m[1]);
    ok('settings list read from IplayarrParameters.ts', all.length > 50, `${all.length} keys`);
    const missing = all.filter((k) => !(k in CHANGE) && !(k in OTHER));
    ok('every setting is covered by this sweep', !missing.length, `add to smoke/settings.cjs: ${missing.join(', ')}`);
    const stale = [...Object.keys(CHANGE), ...Object.keys(OTHER)].filter((k) => !all.includes(k));
    warn('sweep lists no removed settings', !stale.length, stale.join(', '));
    for (const [k, why] of Object.entries(OTHER)) if (/^not changed/.test(why)) rec(W, `${k} left unchanged`, 'SKIP', why);

    const before = await get();
    const K = encodeURIComponent(before.STREAM_KEY || '');
    const touched = new Set();
    const profilesQ = Object.fromEntries(((await http('/json-api/config/qualityProfiles')).json || []).map((p) => [p.id, p.quality]));
    let termIx = 0;
    const freshTerm = () => TERMS[termIx++ % TERMS.length];
    const nzbTitles = async (t, q) => {
        const r = await http(`/api?t=${t}&q=${encodeURIComponent(q)}&apikey=${encodeURIComponent(before.API_KEY)}`, { timeout: 90000 });
        return [...r.text.matchAll(/<item>[\s\S]*?<title>([^<]*)<\/title>/g)].map((m) => m[1]);
    };
    const manualSettings = async () => (await http('/json-api/search/settings')).json || {};
    const playlist = async () => http(`/api?mode=live_playlist&streamkey=${K}`, { timeout: 60000 });
    const epg = async () => (await http(`/api?mode=live_epg&streamkey=${K}`, { timeout: 180000 })).text || '';
    const sabMisc = async () => (await http(`/api?mode=get_config&apikey=${encodeURIComponent(before.API_KEY)}&output=json`)).json?.config?.misc || {};

    // Starts an on-demand stream (a session is recorded before anything is resolved), reads the session, stops it.
    const sessionProbe = async (extraQuery = '') => {
        const seen = new Set((((await http('/json-api/streams')).json || {}).active || []).concat(((await http('/json-api/streams')).json || {}).history || []).map((s) => s.id));
        const ctl = new AbortController();
        const req = fetch(`${BASE}/api?mode=stream&pid=${ctx.pid}&streamkey=${K}${extraQuery}`, { signal: ctl.signal }).then((r) => r.body?.cancel?.()).catch(() => {});
        let found;
        for (let i = 0; i < 14 && !found; i++) {
            await sleep(500);
            const s = (await http('/json-api/streams')).json || {};
            found = [...(s.active || []), ...(s.history || [])].find((x) => x.pid === ctx.pid && !seen.has(x.id));
        }
        ctl.abort();
        await req;
        if (found && !found.endedAt) await http(`/json-api/streams/${found.id}/stop`, { method: 'POST' });
        return found;
    };
    const needSession = () => (!ctx.pid || !before.STREAM_KEY ? 'no pid / stream key to start a stream with' : undefined);
    const nativeSnapshot = async (field, expected) => {
        if (needSession()) return needSession();
        if ((effective(await get(), 'STREAM_CLIENT') || 'NATIVE') !== 'NATIVE') return 'STREAM_CLIENT is not NATIVE, so no native snapshot is taken';
        const s = await sessionProbe();
        return { what: `stream session snapshot "${field}" = ${expected}`, pass: s?.settings?.[field] === expected, detail: s ? JSON.stringify(s.settings) : 'no session was recorded' };
    };

    // Live TV prep: playlist and guide baselines are taken with Live TV switched on
    if (before.STREAM_KEY && before.LIVE_TV_ENABLED !== 'true') { touched.add('LIVE_TV_ENABLED'); await put({ LIVE_TV_ENABLED: 'true' }); }
    const playlist0 = before.STREAM_KEY ? await playlist() : undefined;
    const epg0 = before.STREAM_KEY ? await epg() : '';
    const hasGuide = /<programme /.test(epg0);
    const firstStart = (xml) => {
        const m = /<programme start="(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d) /.exec(xml);
        return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : undefined;
    };
    const guideEffect = (what, test) => (!hasGuide ? 'no Live TV guide to read (no channels selected or the BBC schedule is unavailable)' : (async () => ({ what, ...test(await epg()) }))());

    // Effect of each setting, observed after it has been changed. Returns { what, pass, detail, level? } or a skip reason.
    const EFFECT = {
        VIDEO_QUALITY: async ({ next }) => {
            const titles = await nzbTitles('search', freshTerm());
            if (!titles.length) return 'the search returned no releases';
            return { what: `release names carry ${profilesQ[next]}`, pass: titles.some((t) => t.includes(profilesQ[next])), detail: titles.slice(0, 2).join(' | ') };
        },
        EXTRA_VIDEO_QUALITIES: async ({ next }) => {
            const extra = next.split(',').filter((id) => id !== effective(before, 'VIDEO_QUALITY'))[0];
            const titles = await nzbTitles('search', freshTerm());
            if (!titles.length || !extra) return 'no releases / no extra quality different from the primary';
            return { what: `extra ${profilesQ[extra]} releases are offered`, pass: titles.some((t) => t.includes(profilesQ[extra])), detail: titles.slice(0, 2).join(' | ') };
        },
        EXTRA_VERSIONS: async ({ next }) => {
            const tag = next === 'signed' ? 'SIGNED' : 'AUDIO.DESCRIBED';
            // Only programmes that have the version get a release for it, so try a few searches before deciding.
            let seen = 0;
            for (let attempt = 0; attempt < 4; attempt++) {
                const titles = await nzbTitles('search', freshTerm());
                seen += titles.length;
                if (titles.some((t) => t.includes(tag))) return { what: `${tag} releases are offered`, pass: true, detail: '' };
            }
            return `none of the ${seen} releases searched has a ${tag} version, so there is nothing to tag`;
        },
        RELEASE_LANGUAGE: async ({ next }) => {
            const titles = await nzbTitles('search', freshTerm());
            if (!titles.length) return 'the search returned no releases';
            return { what: next === 'english' ? 'release names are tagged ENGLISH' : 'release names are not tagged ENGLISH', pass: titles.some((t) => /\bENGLISH\b/.test(t)) === (next === 'english'), detail: titles.slice(0, 2).join(' | ') };
        },
        OUTPUT_FORMAT: async ({ next }) => {
            if (!ctx.pid) return 'no pid discovered';
            const r = await http(`/api?mode=nzb-download&pid=${ctx.pid}&nzbName=SMOKETEMP&type=TV&apikey=${encodeURIComponent(before.API_KEY)}`);
            return { what: `the NZB names the file SMOKETEMP.${next}`, pass: r.status === 200 && r.text.includes(`SMOKETEMP.${next}`), detail: `HTTP ${r.status}` };
        },
        SEARCH_MATCH_ALL_WORDS: async ({ next }) => {
            const s = await manualSettings();
            if (effective(await get(), 'NATIVE_SEARCH') === 'false') return 'native search is off';
            const n = (await nzbTitles('search', `${freshTerm()} zzqqxxy`)).length;
            return { what: next === 'true' ? 'a word that matches nothing empties the results' : 'a word that matches nothing no longer empties the results', pass: next === 'true' ? n === 0 : n > 0, detail: `${n} releases (manual settings ${JSON.stringify(s)})` };
        },
        MANUAL_NATIVE_SEARCH: async ({ next }) => {
            const s = await manualSettings();
            const want = next === 'inherit' ? effective(await get(), 'NATIVE_SEARCH') !== 'false' : next === 'true';
            return { what: `the Search page reports native search ${want ? 'on' : 'off'}`, pass: s.native === want, detail: JSON.stringify(s) };
        },
        MANUAL_NATIVE_SEARCH_ENGINE: async ({ next }) => {
            const s = await manualSettings();
            if (!s.native) return 'native search is off for manual searches';
            const want = next === 'inherit' ? effective(await get(), 'NATIVE_SEARCH_ENGINE') || 'V1' : next;
            return { what: `the Search page reports engine ${want}`, pass: s.engine === want, detail: JSON.stringify(s) };
        },
        MANUAL_SEARCH_MATCH_ALL_WORDS: async ({ next }) => {
            const s = await manualSettings();
            if (!s.native) return 'native search is off for manual searches';
            const want = next === 'inherit' ? effective(await get(), 'SEARCH_MATCH_ALL_WORDS') !== 'false' : next === 'true';
            const base = { what: `the Search page reports match-all-words ${want}`, pass: s.matchAllWords === want, detail: JSON.stringify(s) };
            if (next === 'inherit') return base;
            const r = await http(`/json-api/search?q=${encodeURIComponent(`${freshTerm()} zzqqxxy`)}`, { timeout: 90000 });
            const n = Array.isArray(r.json) ? r.json.length : -1;
            return { ...base, pass: base.pass && (want ? n === 0 : n > 0), detail: `${base.detail}; manual search for a non-matching extra word gave ${n} results` };
        },
        // The Search page's radio note reads the same endpoint, so the resolved values show what a radio search will do.
        RADIO_SEARCH_MATCH_ALL_WORDS: async ({ next }) => {
            const s = (await http('/json-api/search/settings?mode=radio')).json || {};
            const want = next === 'inherit' ? effective(await get(), 'MANUAL_SEARCH_MATCH_ALL_WORDS') === 'inherit' ? effective(await get(), 'SEARCH_MATCH_ALL_WORDS') !== 'false' : effective(await get(), 'MANUAL_SEARCH_MATCH_ALL_WORDS') === 'true' : next === 'true';
            return { what: `the radio search settings report match-all-words ${want}`, pass: s.matchAllWords === want, detail: JSON.stringify(s) };
        },
        RADIO_SEARCH_RANK_BY_TITLE: async ({ next }) => {
            const s = (await http('/json-api/search/settings?mode=radio')).json || {};
            return { what: `the radio search settings report rank-by-title ${next}`, pass: s.rankByTitle === (next === 'true'), detail: JSON.stringify(s) };
        },
        RADIO_SEARCH_SCOPE: async ({ next }) => {
            const s = (await http('/json-api/search/settings?mode=radio')).json || {};
            const r = await http(`/json-api/search?mode=radio&q=${encodeURIComponent('news')}`, { timeout: 60000 });
            const list = Array.isArray(r.json) ? r.json : [];
            const shows = list.filter((x) => x.kind === 'brand').length;
            const eps = list.filter((x) => x.kind === 'episode').length;
            const listed = next === 'both' ? shows + eps > 0 : next === 'shows' ? eps === 0 : shows === 0;
            return { what: `a radio search lists ${next === 'both' ? 'shows and episodes' : next}`, pass: s.scope === next && listed, detail: `${shows} shows, ${eps} episodes; ${JSON.stringify(s)}` };
        },
        RADIO_SEARCH_MP3_ONLY: async ({ next }) => {
            const s = (await http('/json-api/search/settings?mode=radio')).json || {};
            const r = await http(`/json-api/search?mode=radio&q=${encodeURIComponent('archers')}`, { timeout: 60000 });
            const eps = (Array.isArray(r.json) ? r.json : []).filter((x) => x.kind === 'episode');
            const only = eps.every((e) => e.mp3);
            return { what: `radio search ${next === 'true' ? 'lists only MP3 episodes' : 'is not limited to MP3 episodes'}`, pass: s.mp3Only === (next === 'true') && (next !== 'true' || only), detail: `${eps.length} episodes; ${JSON.stringify(s)}` };
        },
        RADIO_SEARCH_NETWORKS: async ({ next }) => {
            const s = (await http('/json-api/search/settings?mode=radio')).json || {};
            const want = next ? next.split(',').map((n) => n.trim()).filter(Boolean) : [];
            const r = await http(`/json-api/search?mode=radio&q=${encodeURIComponent('news')}`, { timeout: 60000 });
            const channels = [...new Set((Array.isArray(r.json) ? r.json : []).map((x) => String(x.channel || '').replace(/^BBC /i, '').toLowerCase()))];
            const inside = !want.length || channels.every((c) => want.some((w) => w.replace(/^BBC /i, '').toLowerCase() === c));
            return { what: want.length ? 'a radio search lists only those networks' : 'a radio search lists every network', pass: JSON.stringify(s.networks) === JSON.stringify(want) && inside, detail: `networks seen: ${channels.join(', ')}; ${JSON.stringify(s)}` };
        },
        MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: async ({ next }) => {
            const s = await manualSettings();
            if (!s.native || s.engine !== 'V2') return 'manual search is not on native engine 2.0, which the option needs';
            const want = next === 'inherit' ? effective(await get(), 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS') === 'true' : next === 'true';
            return { what: `the Search page footer reports collections by pid ${want ? 'on' : 'off'}`, pass: !!s.expandCollections === want, detail: JSON.stringify(s) };
        },
        MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: async ({ next }) => {
            const s = await manualSettings();
            if (!s.native || s.engine !== 'V2') return 'manual search is not on native engine 2.0, which the option needs';
            const want = next === 'inherit' ? effective(await get(), 'NATIVE_SEARCH_V2_COLLECTION_NAMES') === 'true' : next === 'true';
            return { what: `the Search page footer reports collections by name ${want ? 'on' : 'off'}`, pass: !!s.collectionNames === want, detail: JSON.stringify(s) };
        },
        NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: async ({ next }) => {
            if ((effective(await get(), 'MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS') || 'inherit') !== 'inherit') return 'manual search has its own override of this option';
            const s = await manualSettings();
            if (!s.native || s.engine !== 'V2') return 'manual search is not on native engine 2.0, which the option needs';
            const on = next === 'true';
            const base = { what: `the Search page footer reports collections ${on ? 'on' : 'off'}`, pass: !!s.expandCollections === on, detail: JSON.stringify(s) };
            // A real BBC collection (Fright Night); if the BBC has retired it there is nothing to expand.
            const group = await fetch('https://ibl.api.bbci.co.uk/ibl/v1/groups/p096h09x/episodes?rights=web&per_page=1').then((r) => r.json()).catch(() => undefined);
            if (!group?.group_episodes?.count) return base.pass ? { ...base, detail: `${base.detail}; the BBC collection used for the search probe is gone` } : base;
            const r = await http('/json-api/search?q=p096h09x', { timeout: 90000 });
            const n = Array.isArray(r.json) ? r.json.length : -1;
            return { ...base, pass: base.pass && (on ? n > 0 : n === 0), detail: `${base.detail}; a manual search for the collection pid gave ${n} results` };
        },
        NATIVE_SEARCH_V2_COLLECTION_NAMES: async ({ next }) => {
            if ((effective(await get(), 'MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES') || 'inherit') !== 'inherit') return 'manual search has its own override of this option';
            const s = await manualSettings();
            if (!s.native || s.engine !== 'V2') return 'manual search is not on native engine 2.0, which the option needs';
            const on = next === 'true';
            const base = { what: `the Search page footer reports collections by name ${on ? 'on' : 'off'}`, pass: !!s.collectionNames === on, detail: JSON.stringify(s) };
            // Search for a collection that is on iPlayer right now; a title no programme shares, so any hit is a collection member.
            const list = (await http('/json-api/browse/collections')).json;
            const collection = on || list?.enabled ? (list?.collections || [])[0] : undefined;
            if (!collection) return base.pass ? { ...base, detail: `${base.detail}; no collection is available to search for (turn on Show Collections to probe)` } : base;
            // Manual search shows the collection as a result of its own (a {collections} line of the search stream, listed
            // first by the page), not its episodes; the type-ahead leads with it too.
            const stream = await http(`/json-api/search/stream?q=${encodeURIComponent(collection.title)}`, { timeout: 120000 });
            const lines = String(stream.text || '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
            const tiled = lines.some((l) => (l.collections || []).some((c) => c.id === collection.id));
            const suggested = ((await http(`/json-api/browse/suggest?q=${encodeURIComponent(collection.title)}`, { timeout: 60000 })).json || []).some((s) => s.kind === 'collection' && s.id === collection.id);
            return { ...base, pass: base.pass && tiled === on && suggested === on, detail: `${base.detail}; "${collection.title}": collection in search results ${tiled}, in type-ahead ${suggested}` };
        },
        BROWSE_SHOW_COLLECTIONS: async ({ next }) => {
            const on = next === 'true';
            const r = await http('/json-api/browse/collections', { timeout: 120000 });
            const list = r.json || {};
            const count = (list.collections || []).length;
            if (!on) return { what: 'the Discover collections list is off and empty', pass: r.status === 200 && list.enabled === false && count === 0, detail: JSON.stringify(list).slice(0, 100) };
            if (r.status === 200 && list.enabled === true && count === 0) return 'the BBC pages listed no collections to show right now';
            const first = (list.collections || [])[0];
            const members = first ? (await http(`/json-api/browse/collections/${first.id}?perPage=5`)).json : undefined;
            return { what: 'the Collections page lists collections and one opens to its titles', pass: r.status === 200 && list.enabled === true && count > 0 && (members?.items || []).length > 0, detail: `${count} collections; "${first?.title}" opened ${(members?.items || []).length} titles` };
        },
        BROWSE_COLLECTION_SOURCES: async ({ next }) => {
            if (effective(await get(), 'BROWSE_SHOW_COLLECTIONS') !== 'true') return 'Show Collections is off, so the list is not served';
            const r = await http('/json-api/browse/collections', { timeout: 180000 });
            const list = r.json?.collections || [];
            const generic = list.filter((c) => /^(featured\b|live and latest\b)/i.test(c.title));
            // The home page holds roughly thirty; the category pages add well over a hundred more.
            const sized = next === 'all' ? list.length > 45 : list.length > 0 && list.length < 45;
            return { what: `the Collections list is built from ${next === 'all' ? 'the home page and every category' : 'the home page only'}`, pass: r.status === 200 && sized && generic.length === 0, detail: `${list.length} collections, ${generic.length} generic shelves` };
        },
        NATIVE_SEARCH: async ({ next }) => {
            if ((effective(await get(), 'MANUAL_NATIVE_SEARCH') || 'inherit') !== 'inherit') return 'manual search has its own native-search override';
            const s = await manualSettings();
            return { what: `manual search (which follows it) reports native ${next === 'true' ? 'on' : 'off'}`, pass: s.native === (next === 'true'), detail: JSON.stringify(s) };
        },
        NATIVE_SEARCH_ENGINE: async ({ next }) => {
            const cfg = await get();
            if ((effective(cfg, 'MANUAL_NATIVE_SEARCH_ENGINE') || 'inherit') !== 'inherit' || effective(cfg, 'NATIVE_SEARCH') === 'false') return 'manual search overrides the engine, or native search is off';
            const s = await manualSettings();
            return { what: `manual search (which follows it) reports engine ${next}`, pass: s.engine === next, detail: JSON.stringify(s) };
        },
        THUMBNAIL_RETENTION_DAYS: async ({ next }) => {
            const t = ((await http('/json-api/maintenance/caches')).json || []).find((c) => c.prefix === 'thumbnails');
            return { what: `the Maintenance cache list shows ${next} days`, pass: t?.ttl === Number(next) * 86400, detail: JSON.stringify(t || {}).slice(0, 120) };
        },
        REFRESH_SCHEDULE: async ({ next }) => {
            const t = ((await http('/json-api/maintenance/tasks')).json || []).find((x) => x.id === 'schedule-refresh');
            return { what: `the Schedule Refresh task runs on "${next}"`, pass: (t?.cron ?? t?.schedule) === next, detail: `task shows "${t?.cron ?? t?.schedule}"` };
        },
        LIVE_TV_ENABLED: async () => {
            const b = await playlist();
            return { what: 'the Live TV playlist changes', pass: !!playlist0 && (b.status !== playlist0.status || b.text !== playlist0.text), detail: `both HTTP ${b.status}, ${b.text.length} bytes` };
        },
        LIVE_TV_LOGO_SHAPE: async ({ next }) => {
            if (!/tvg-logo=/.test(playlist0?.text || '')) return 'no channel logos in the playlist';
            const b = await playlist();
            return { what: `playlist logos ask for the ${next} shape`, pass: b.text.includes(`v=png-${next}`), detail: (b.text.match(/tvg-logo="[^"]*"/) || [''])[0].slice(-60) };
        },
        LIVE_TV_GUIDE_CATEGORIES: ({ next }) => guideEffect(`the guide ${next === 'true' ? 'has' : 'has no'} category tags`, (xml) => ({ pass: /<category/.test(xml) === (next === 'true'), detail: `${xml.length} bytes` })),
        LIVE_TV_GUIDE_FLAGS: ({ next }) => guideEffect(`the guide ${next === 'true' ? 'has' : 'has no'} new/live/repeat flags`, (xml) => ({ pass: /<new\/>|<previously-shown\/>|<live\/>/.test(xml) === (next === 'true'), detail: `${xml.length} bytes` })),
        LIVE_TV_GUIDE_HD: ({ next }) => guideEffect(`the guide ${next === 'true' ? 'marks' : 'does not mark'} programmes HD`, (xml) => ({ pass: /<quality>HDTV/.test(xml) === (next === 'true'), detail: `${xml.length} bytes` })),
        STREAM_BASE_URL: async ({ next }) => {
            if (!playlist0 || !/live\.m3u8/.test(playlist0.text)) return 'no channels in the Live TV playlist';
            const lines = (await playlist()).text.split('\n').filter((l) => l.includes('/api/live.m3u8'));
            return { what: 'playlist stream URLs use the new base URL', pass: lines.length > 0 && lines.every((l) => l.startsWith(next)), detail: lines[0] || 'no stream lines' };
        },
        // Queue a real download, read which client the queue entry says it uses, cancel it straight away.
        DOWNLOAD_CLIENT: async ({ next }) => {
            if (!ctx.pid) return 'no programme id to download';
            const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const ep = (prog?.seasons || []).flatMap((s) => s.episodes || []).find((e) => e.pid);
            if (!ep) return 'no episode to download';
            const dl = await http(`/json-api/download?pid=${ep.pid}&media=download`, { timeout: 60000 });
            let q;
            for (let i = 0; i < 16 && !q; i++) { await sleep(500); q = ((await http('/json-api/queue/queue')).json || []).find((e) => e.pid === ep.pid); }
            if (q) await http(`/json-api/queue/queue?pid=${ep.pid}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
            for (const h of ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === ep.pid)) await http(`/json-api/queue/history?pid=${ep.pid}${h.jobId ? '&jobId=' + h.jobId : ''}`, { method: 'DELETE' });
            return { what: `a queued download uses the ${next} client`, pass: q?.client === next, detail: `HTTP ${dl.status}, queue entry client=${q?.client}` };
        },
        // Cancel a queued download through SABnzbd: with Archive on, the cancelled item is kept in history; off, it is not.
        ARCHIVE_ENABLED: async ({ next }) => {
            if (!ctx.pid || !before.API_KEY) return 'no programme id / API key to queue a download with';
            const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const ep = (prog?.seasons || []).flatMap((s) => s.episodes || []).find((e) => e.pid);
            if (!ep) return 'no episode to download';
            const mine = async () => ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === ep.pid);
            const wipe = async () => { for (const h of await mine()) await http(`/json-api/queue/history?pid=${ep.pid}${h.jobId ? '&jobId=' + h.jobId : ''}`, { method: 'DELETE' }); };
            await wipe();
            const dl = await http(`/json-api/download?pid=${ep.pid}&media=download`, { timeout: 60000 });
            let q;
            for (let i = 0; i < 16 && !q; i++) { await sleep(500); q = ((await http('/json-api/queue/queue')).json || []).find((e) => e.pid === ep.pid); }
            if (!q) { await wipe(); return `the download did not appear in the queue (HTTP ${dl.status})`; }
            await http(`/api?mode=queue&name=delete&value=${encodeURIComponent(ep.pid)}&apikey=${encodeURIComponent(before.API_KEY)}&output=json`);
            await sleep(1500);
            if (((await http('/json-api/queue/queue')).json || []).some((e) => e.pid === ep.pid)) await http(`/json-api/queue/queue?pid=${ep.pid}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
            const kept = await mine();
            await wipe();
            return { what: next === 'true' ? 'a download cancelled through SABnzbd is kept in history' : 'a download cancelled through SABnzbd leaves no history entry', pass: next === 'true' ? kept.length > 0 : kept.length === 0, detail: `${kept.length} history entr${kept.length === 1 ? 'y' : 'ies'}: ${kept.map((k) => k.status).join(',')}` };
        },
        // Native Search 2.0 can fetch only the requested series. The search trace records "narrowedTo" when it did.
        NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: async () => {
            if (!before.API_KEY) return 'no API key';
            const now = await get();
            const prev = Object.fromEntries(['NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'AIRDATE_NUMBERING', 'NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY'].map((k) => [k, effective(now, k)]));
            for (const k of Object.keys(prev)) touched.add(k);
            try {
                const narrowed = async (flag) => {
                    await put({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', AIRDATE_NUMBERING: 'false', NATIVE_SEARCH_V2_REQUESTED_SERIES_ONLY: flag });
                    let seen = 0, hit = 0;
                    for (const term of ['mastermind', 'springwatch', 'countryfile', 'horizon', 'antiques']) {
                        await http(`/api?t=tvsearch&q=${term}&season=2&apikey=${encodeURIComponent(before.API_KEY)}`, { timeout: 120000 });
                        const hist = (await http('/json-api/stats/searchHistory?limit=15')).json || [];
                        const e = [...hist].reverse().find((x) => String(x.term).toLowerCase().includes(term));
                        if (!e) continue;
                        const d = (await http(`/json-api/stats/searchHistory/detail?term=${encodeURIComponent(e.term)}&time=${e.time}`)).json;
                        seen++;
                        if (d?.trace?.narrowedTo) hit++;
                    }
                    return { seen, hit };
                };
                const on = await narrowed('true');
                const off = await narrowed('false');
                if (!on.seen) return 'the search history recorded none of the test searches (is search statistics off?)';
                if (!on.hit) return 'no test show has a "Series 2" container to narrow to, so nothing was narrowed (pick another show)';
                return { what: 'a season search fetches only that series (the search trace says "narrowedTo")', pass: on.hit > 0 && off.hit === 0, detail: `on: ${on.hit}/${on.seen} narrowed, off: ${off.hit}/${off.seen}` };
            } finally { await put(prev); }
        },
        // "Configured" means a ticked Jellyfin server already has our tuner or guide: no ticked server -> false; the real one -> what Jellyfin says.
        LIVE_TV_JELLYFIN_APPS: async () => {
            const none = await http('/json-api/live-tv/configured');
            const jf = ((await http('/json-api/apps')).json || []).find((a) => a.type === 'JELLYFIN');
            if (!jf) return 'no Jellyfin app is set up in iPlayarr (Settings > Apps) to tick';
            const st = (await http(`/json-api/live-tv/jellyfin/status?appId=${jf.id}`)).json;
            if (!st) return 'Jellyfin did not answer the Live TV status request';
            await put({ LIVE_TV_JELLYFIN_APPS: jf.id });
            const ticked = await http('/json-api/live-tv/configured');
            return { what: 'ticking a Jellyfin server makes "configured" follow that server (an unknown server counts as none)', pass: none.json?.configured === false && ticked.json?.configured === Boolean(st.tuner || st.guide), detail: `unknown app: ${none.text.slice(0, 60)}; ticked: ${ticked.text.slice(0, 60)}; Jellyfin has tuner=${Boolean(st.tuner)} guide=${Boolean(st.guide)}` };
        },
        // Thumbnails are cached on disk: with the folder under the mounted cache, fetching pictures must leave files there.
        THUMBNAIL_CACHE_DIR: async ({ next }) => {
            if (!CACHE_HOST) return "SMOKE_CACHE_HOST is not set (the container's /cache folder as this PC sees it, e.g. Y:\\iplayarr-turbo\\cache)";
            if (!next.startsWith(CACHE_CONTAINER + '/')) return 'the folder is not under the cache mount';
            const host = path.join(CACHE_HOST, next.slice(CACHE_CONTAINER.length));
            const home = (await http('/json-api/browse/home')).json || [];
            const thumbs = home.flatMap((r) => r.items || []).map((i) => i.thumbnail).filter((t) => t && !/^https?:/i.test(t)).slice(0, 3);
            if (!thumbs.length) return 'no locally served thumbnail on the home page to fetch';
            for (const t of thumbs) await fetch(BASE + '/' + String(t).replace(/^\//, '')).then((r) => r.arrayBuffer()).catch(() => {});
            const files = fs.existsSync(host) ? fs.readdirSync(host) : [];
            try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* leave it */ }
            return { what: 'fetched thumbnails are cached in the new folder', pass: files.length > 0, detail: `${files.length} file(s) in ${host}` };
        },
        // Airdate numbering renumbers episodes from their broadcast dates: some title in the NZB results must change.
        AIRDATE_NUMBERING: async ({ cur, next }) => {
            if (!before.API_KEY) return 'no API key';
            const grab = async () => {
                const out = [];
                const shows = Array.isArray(SHOWS.airdateNumbering) && SHOWS.airdateNumbering.length ? SHOWS.airdateNumbering : ['university challenge', 'casualty', 'qi', 'masterchef', 'antiques roadshow'];
                for (const term of shows) out.push(...(await nzbTitles('tvsearch', term)));
                return out;
            };
            const a = await grab();
            await put({ AIRDATE_NUMBERING: cur });
            const b = await grab();
            await put({ AIRDATE_NUMBERING: next });
            if (!a.length || !b.length) return 'the test searches returned no releases';
            const differ = a.filter((t) => !b.includes(t)).length;
            return differ ? { what: 'switching the numbering changes release names', pass: true } : 'every release name is the same either way, so the shows searched are not renumbered (Skyhook may not know them)';
        },
        // The test button with no address typed uses the saved one: an unreachable .invalid host must be reported as such.
        STRM_WATCHDOG_WEBHOOK_URL: async () => {
            const r = await http('/json-api/watchdog/test-webhook', { method: 'POST', body: {}, timeout: 30000 });
            return { what: 'the Test button uses the saved address (it tries to send, and reports it could not)', pass: r.json?.ok === false && /Could not send/.test(r.json?.message || ''), detail: r.text.slice(0, 140) };
        },
        STRM_WATCHDOG_ENABLED: async ({ next }) => {
            const w = (await http('/json-api/watchdog')).json || {};
            return { what: `the Watchdog page reports it ${next === 'true' ? 'enabled' : 'disabled'}`, pass: w.enabled === (next === 'true'), detail: JSON.stringify(w).slice(0, 100) };
        },
        STREAM_CLIENT: async ({ next }) => {
            if (needSession()) return needSession();
            const s = await sessionProbe();
            return { what: `a new stream session runs on the ${next} client`, pass: s?.client === next, detail: s ? `client ${s.client}` : 'no session was recorded' };
        },
        STREAM_MODE: async ({ next }) => {
            if (needSession()) return needSession();
            const s = await sessionProbe();
            return { what: `a new stream session uses ${next} mode`, pass: s?.mode === next, detail: s ? `mode ${s.mode}` : 'no session was recorded' };
        },
        STREAM_NATIVE_ADAPTIVE: ({ next }) => nativeSnapshot('Quality', next === 'true' ? 'Adaptive' : 'Fixed'),
        STREAM_NATIVE_HQ_PROBE: ({ next }) => nativeSnapshot('Quality Probe', next === 'true' ? 'On' : 'Off'),
        STREAM_NATIVE_EXPERIMENTAL_FHD: ({ next }) => nativeSnapshot('FHD Upgrade', next === 'true' ? 'On' : 'Off'),
        STREAM_SUBTITLES: async ({ next }) => {
            const snap = await nativeSnapshot('Subtitles', next === 'true' ? 'On' : 'Off');
            if (typeof snap === 'string') return snap;
            const master = await http(`/api?mode=stream&pid=${ctx.pid}&streamkey=${K}`, { timeout: 60000 });
            const has = /TYPE=SUBTITLES/.test(master.text);
            return { ...snap, pass: snap.pass && (next === 'true' ? true : !has), detail: `${snap.detail}; master ${has ? 'has' : 'has no'} subtitle rendition` };
        },
    };

    const before0 = before;
    const effectsPassed = new Set();
    try {
        // 1. Guard rails on the endpoint itself
        const unknown = await put({ SMOKE_NOT_A_SETTING: 'x' });
        ok('unknown setting rejected', rejected(unknown, 'SMOKE_NOT_A_SETTING'), `HTTP ${unknown.status}`);
        const obj = await put({ DEBUG: { a: 1 } });
        ok('object value rejected', rejected(obj, 'DEBUG'), `HTTP ${obj.status}`);
        const arr = await http('/json-api/config', { method: 'PUT', body: ['DEBUG'] });
        ok('array body rejected', arr.status === 400, `HTTP ${arr.status}`);
        const port = await put({ PORT: String((parseInt(before.PORT, 10) || 4404) + 1) });
        ok('PORT cannot be changed through the API', rejected(port, 'PORT'), `HTTP ${port.status}`);
        ok('PORT unchanged', effective(await get(), 'PORT') === effective(before, 'PORT'));
        const same = await put({ PORT: effective(before, 'PORT') });
        ok('PORT sent back unchanged is accepted', same.status === 200, `HTTP ${same.status}`);

        // 1b. Route hint (&route= in a .strm link): the two on/off settings validate, and a stream link carrying any hint still plays,
        // because the hint is only a head start (an unknown or malformed one is ignored, a route BBC does not answer falls back).
        for (const key of ['STRM_PROBE_ROUTE', 'STRM_WATCHDOG_UPDATE_ROUTES']) {
            ok(`${key} refuses a value that is not true or false`, rejected(await put({ [key]: 'maybe' }), key), key);
        }
        if (needSession()) rec(W, 'a stream link with a route hint still plays', 'SKIP', needSession());
        else {
            const plainPlays = /#EXTM3U/.test((await http(`/api?mode=stream&pid=${ctx.pid}&streamkey=${K}`, { timeout: 60000 })).text);
            for (const [label, route] of [['a known route', 'pc-6'], ['the default route', 'iptv-all-6'], ['an unknown route', 'zz-9'], ['a malformed route', '%00%00%00'], ['a repeated route', 'pc-6&route=pc-5']]) {
                const r = await http(`/api?mode=stream&pid=${ctx.pid}&streamkey=${K}&route=${route}`, { timeout: 60000 });
                // Whatever plays without a hint must play with one.
                ok(`a stream link with ${label} plays as one without`, !plainPlays || /#EXTM3U/.test(r.text), `HTTP ${r.status} ${r.text.slice(0, 80)}`);
            }
            if ((effective(before, 'STREAM_CLIENT') || 'NATIVE') === 'NATIVE') {
                const hinted = await sessionProbe('&route=iptv-all-6');
                // The note is written once BBC has answered, which may be after the probe has already stopped the session.
                await sleep(1500);
                const now = (await http('/json-api/streams')).json || {};
                const seen = [...(now.active || []), ...(now.history || [])].find((x) => x.id === hinted?.id);
                warn('a session started from a hinted link notes that the route came from the link', !seen?.source?.route || /\(from the link\)/.test(seen.source.route), JSON.stringify(seen?.source || {}));
            }
        }

        // 2. Each changeable setting: change, read back, confirm the effect, restore
        // The two that clear the search caches go last, so the keys after them do not each start on a cold cache.
        const CLEARS_CACHES = ['AIRDATE_NUMBERING', 'NATIVE_SEARCH'];
        for (const [key, candidates] of Object.entries(CHANGE).sort(([a], [b]) => CLEARS_CACHES.includes(a) - CLEARS_CACHES.includes(b))) {
            if (!all.includes(key)) continue;
            if (ctx.want && !ctx.want(key)) continue; // --filter on the command line
            const cur = effective(await get(), key);
            const list = key === 'LIVE_STRM_DIR' ? [`${effective(before, 'COMPLETE_DIR').replace(/[\\/]$/, '')}/SMOKE-TEMP-live`] : key === 'THUMBNAIL_CACHE_DIR' && CACHE_HOST ? [`${CACHE_CONTAINER}/smoke-temp-thumbs`] : candidates;
            const next = list.find((v) => v !== cur);
            if (next === undefined) { rec(W, `${key} change`, 'SKIP', 'no alternative value'); continue; }
            touched.add(key);
            const r = await put({ [key]: next });
            if (r.status !== 200) { rec(W, `${key} change accepted`, 'FAIL', `${cur} -> ${next}: HTTP ${r.status} ${r.text.slice(0, 140)}`); continue; }
            const now = (await get())[key];
            if (next === '') ok(`${key} change saved and read back`, (now ?? '') === '' || now === effective(before, key), `got ${now}`);
            else ok(`${key} change saved and read back`, now === next, `${cur} -> ${next}, got ${now}`);

            const hook = EFFECT[key];
            if (hook) {
                let out;
                try { out = await hook({ cur, next }); } catch (e) { out = { what: 'effect check', pass: false, detail: 'threw: ' + e.message }; }
                if (typeof out === 'string') rec(W, `${key}=${next} effect`, 'SKIP', out);
                else { rec(W, `${key}=${next} takes effect: ${out.what}`, out.pass ? 'PASS' : out.level || 'FAIL', out.pass ? '' : out.detail); if (out.pass) effectsPassed.add(key); }
            } else if (NO_EFFECT[key]) {
                rec(W, `${key} effect`, /^DEAD/.test(NO_EFFECT[key]) ? 'WARN' : 'SKIP', NO_EFFECT[key]);
            } else if (!TESTED_LATER.includes(key)) {
                rec(W, `${key} has an effect check`, 'FAIL', 'add an EFFECT or a NO_EFFECT entry in smoke/settings.cjs');
            }

            const back = await put({ [key]: cur });
            ok(`${key} restored`, back.status === 200 && effective(await get(), key) === cur, `HTTP ${back.status} ${back.text.slice(0, 100)}`);
        }

        // 3. Directories: must exist, and SABnzbd's get_config (what Sonarr/Radarr read) reports them
        for (const key of ['DOWNLOAD_DIR', 'COMPLETE_DIR', 'ARR_COMPLETE_DIR']) {
            touched.add(key);
            const bad = await put({ [key]: '/smoke-temp-does-not-exist' });
            ok(`${key} missing directory rejected`, rejected(bad, key), `HTTP ${bad.status}`);
            const cur = effective(before, key);
            if (cur) { const r = await put({ [key]: cur }); ok(`${key} existing directory accepted`, r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`); }
            else rec(W, `${key} existing directory accepted`, 'SKIP', 'not set (optional)');
        }
        const dirsNow = await get();
        ok('directories unchanged after the rejected saves', ['DOWNLOAD_DIR', 'COMPLETE_DIR', 'ARR_COMPLETE_DIR'].every((k) => effective(dirsNow, k) === effective(before, k)));
        const otherDir = (...skip) => [before.DOWNLOAD_DIR, before.COMPLETE_DIR, before.ARR_COMPLETE_DIR].find((d) => d && !skip.includes(d));
        {
            const alt = otherDir(effective(before, 'DOWNLOAD_DIR'));
            if (alt) { await put({ DOWNLOAD_DIR: alt }); const m = await sabMisc(); ok('DOWNLOAD_DIR takes effect: SABnzbd get_config reports the new download dir', m.download_dir === alt, JSON.stringify(m)); await put({ DOWNLOAD_DIR: effective(before, 'DOWNLOAD_DIR') }); }
            else rec(W, 'DOWNLOAD_DIR effect', 'SKIP', 'no second existing directory to point it at');
            const altArr = otherDir(effective(before, 'ARR_COMPLETE_DIR'));
            if (altArr) { await put({ ARR_COMPLETE_DIR: altArr }); const m = await sabMisc(); ok('ARR_COMPLETE_DIR takes effect: SABnzbd get_config reports it as the complete dir', m.complete_dir === altArr, JSON.stringify(m)); await put({ ARR_COMPLETE_DIR: effective(before, 'ARR_COMPLETE_DIR') }); }
            else rec(W, 'ARR_COMPLETE_DIR effect', 'SKIP', 'no second existing directory to point it at');
            if (!before.ARR_COMPLETE_DIR) {
                const altC = otherDir(effective(before, 'COMPLETE_DIR'));
                if (altC) { await put({ COMPLETE_DIR: altC }); const m = await sabMisc(); ok('COMPLETE_DIR takes effect: SABnzbd get_config reports the new complete dir', m.complete_dir === altC, JSON.stringify(m)); await put({ COMPLETE_DIR: effective(before, 'COMPLETE_DIR') }); }
                else rec(W, 'COMPLETE_DIR effect', 'SKIP', 'no second existing directory to point it at');
            } else rec(W, 'COMPLETE_DIR effect', 'SKIP', 'ARR_COMPLETE_DIR is set, so get_config reports that instead');
        }

        // 4. Numeric settings: validated range
        const limits = { ACTIVE_LIMIT: [1, 10, true], RADIO_ACTIVE_LIMIT: [1, 10, false], RADIO_SEARCH_MAX_RESULTS: [0, 200, false], RSS_FEED_HOURS: [1, 720, true], STRM_WATCHDOG_CONCURRENCY: [1, 10, false], STRM_WATCHDOG_FAIL_THRESHOLD: [1, 1000, false], STRM_WATCHDOG_STRIKES: [1, 30, false], STREAM_HISTORY_RETENTION_DAYS: [1, 3650, false] };
        for (const [key, [min, max, required]] of Object.entries(limits)) {
            touched.add(key);
            const cur = effective(before, key);
            // A rejected save changes nothing, so these can go side by side (--concurrency).
            await pool([['below minimum', String(min - 1)], ['above maximum', String(max + 1)], ['fractional', String(min + 0.5)], ['not a number', 'abc'], ['negative', '-3']], async ([label, v]) => {
                const r = await put({ [key]: v });
                ok(`${key} ${label} rejected`, rejected(r, key), `HTTP ${r.status}`);
            });
            const blank = await put({ [key]: '' });
            if (required) ok(`${key} blank rejected`, rejected(blank, key), `HTTP ${blank.status}`);
            else ok(`${key} blank accepted (default applies)`, blank.status === 200, `HTTP ${blank.status}`);
            for (const v of [String(min), String(max)]) {
                const r = await put({ [key]: v });
                ok(`${key} ${v} accepted and read back`, r.status === 200 && String((await get())[key]) === v, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
            }
            await put({ [key]: cur });
        }
        const mixed = await put({ DEBUG: effective(before, 'DEBUG') === 'true' ? 'false' : 'true', ACTIVE_LIMIT: '99' });
        ok('one invalid field rejects the whole save', rejected(mixed, 'ACTIVE_LIMIT') && effective(await get(), 'DEBUG') === effective(before, 'DEBUG'), `HTTP ${mixed.status}`);

        // 5. Guide time offset: validated, and it really shifts the guide
        touched.add('LIVE_TV_EPG_OFFSET');
        for (const v of ['1440', '-1440', '0', '90']) {
            const r = await put({ LIVE_TV_EPG_OFFSET: v });
            ok(`LIVE_TV_EPG_OFFSET ${v} accepted`, r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
        }
        await pool(['1441', '-1441', 'abc', '1.5'], async (v) => {
            const r = await put({ LIVE_TV_EPG_OFFSET: v });
            ok(`LIVE_TV_EPG_OFFSET ${v} rejected`, rejected(r, 'LIVE_TV_EPG_OFFSET'), `HTTP ${r.status}`);
        });
        if (hasGuide) {
            await put({ LIVE_TV_EPG_OFFSET: '0' });
            const a = firstStart(await epg());
            await put({ LIVE_TV_EPG_OFFSET: '90' });
            const b = firstStart(await epg());
            ok('LIVE_TV_EPG_OFFSET takes effect: the first programme moves by 90 minutes', a !== undefined && b !== undefined && Math.abs(b - a) === 90 * 60000, `${a} -> ${b}`);
        } else rec(W, 'LIVE_TV_EPG_OFFSET effect', 'SKIP', 'no Live TV guide to read');
        await put({ LIVE_TV_EPG_OFFSET: effective(before, 'LIVE_TV_EPG_OFFSET') });

        await pool(['UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES', 'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_EXPIRY_BADGES', 'UI_GUIDANCE_BADGES', 'UI_EXTENDED_DEBUG', 'WRITE_NFO_CAST', 'WRITE_NFO_EPISODE_TITLES', 'WRITE_NFO_RUNTIME_FALLBACK', 'WRITE_ADDITIONAL_IMAGES', 'DOWNLOAD_ASK_VERSION', 'PLAY_ASK_VERSION'], async (key) => {
            const r = await put({ [key]: 'maybe' });
            ok(`${key} non-boolean rejected`, rejected(r, key), `HTTP ${r.status}`);
        });
        {
            const r = await put({ STRM_SECURE_ACTION: 'maybe' });
            ok('STRM_SECURE_ACTION unknown action rejected', rejected(r, 'STRM_SECURE_ACTION'), `HTTP ${r.status}`);
        }
        for (const key of ['DOWNLOAD_DEFAULT_VERSION', 'PLAY_DEFAULT_VERSION']) {
            const r = await put({ [key]: 'not-a-version' });
            ok(`${key} unknown version rejected`, rejected(r, key), `HTTP ${r.status}`);
        }
        const profiles = (await http('/json-api/config/versionProfiles')).json || [];
        ok('version profiles offer the ids the settings accept', ['audio-described', 'signed'].every((id) => profiles.some((p) => p.id === id)), JSON.stringify(profiles.map((p) => p.id)));
        ok('quality profiles include the VIDEO_QUALITY choices used here', ['sd', 'hd', 'fhd'].every((id) => !!profilesQ[id]));

        // 6. Filename templates: must compile, are saved, and shape the release names
        for (const [key, searchType] of [['TV_FILENAME_TEMPLATE', 'tvsearch'], ['MOVIE_FILENAME_TEMPLATE', 'movie']]) {
            touched.add(key);
            const cur = effective(before, key);
            for (const [label, v] of [['unbalanced block', '{{#if title}}x'], ['unknown variable', '{{smoke_temp_nope}}']]) {
                const r = await put({ [key]: v });
                ok(`${key} ${label} rejected`, rejected(r, key), `HTTP ${r.status}`);
            }
            const good = '{{title}}.SMOKE.{{quality}}-BBC';
            const r = await put({ [key]: good });
            ok(`${key} valid template saved and read back`, r.status === 200 && (await get())[key] === good, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
            let titles = [];
            for (const term of searchType === 'movie' ? ['paddington', 'film', 'wallace', 'harry potter', 'james bond', 'love', 'christmas'] : [freshTerm()]) {
                titles = await nzbTitles(searchType, term);
                if (searchType === 'movie') titles = titles.filter((t) => !/S\d+E\d+/.test(t));
                if (titles.length) break;
            }
            if (titles.length) {
                const hit = titles.some((t) => t.includes('.SMOKE.'));
                rec(W, `${key} takes effect: ${searchType} release names use it`, hit ? 'PASS' : 'FAIL', hit ? '' : titles.slice(0, 2).join(' | '));
            } else rec(W, `${key} effect`, 'SKIP', `${searchType} returned no releases`);
            await put({ [key]: cur });
        }

        // 7. Executable settings (guarded: they decide what program the server runs)
        const locked = (await http('/json-api/config/lockedSettings')).json || {};
        const authNone = effective(before, 'AUTH_TYPE') === 'none';
        ok('lockedSettings lists the executable settings only while login is disabled', authNone ? ['GET_IPLAYER_EXEC', 'YTDLP_EXEC', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS'].every((k) => (locked.locked || []).includes(k)) : (locked.locked || []).length === 0, JSON.stringify(locked.locked));
        await pool([
            ['GET_IPLAYER_EXEC', 'rm', 'a program that is not get_iplayer/yt-dlp/perl'],
            ['YTDLP_EXEC', '/bin/sh', 'a shell'],
            ['GET_IPLAYER_EXEC', 'perl -e "system(1)"', 'perl -e'],
            ['ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', '--exec "touch /tmp/x"', '--exec'],
            ['ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS', '--command=whoami', '--command'],
        ], async ([key, v, label]) => {
            touched.add(key);
            const r = await put({ [key]: v });
            ok(`${key} rejects ${label}`, rejected(r, key), `HTTP ${r.status}`);
        });
        const validExec = effective(before, 'YTDLP_EXEC') === '/opt/smoke/yt-dlp' ? '/opt/smoke2/yt-dlp' : '/opt/smoke/yt-dlp';
        const lockedTry = await put({ YTDLP_EXEC: validExec });
        if (authNone) ok('a valid executable change is refused while login is disabled', rejected(lockedTry, 'YTDLP_EXEC'), `HTTP ${lockedTry.status}`);
        else {
            const v = (await http('/json-api/versions')).json || {};
            ok('YTDLP_EXEC change saved (login is enabled)', lockedTry.status === 200, `HTTP ${lockedTry.status}`);
            ok('YTDLP_EXEC takes effect: the reported yt-dlp version changes', JSON.stringify((await http('/json-api/versions')).json) !== JSON.stringify(v), 'versions unchanged');
            await http('/json-api/config/executableOverride/YTDLP_EXEC', { method: 'DELETE' });
            await put({ YTDLP_EXEC: effective(before, 'YTDLP_EXEC') });
        }
        for (const key of ['GET_IPLAYER_EXEC', 'YTDLP_EXEC', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS']) {
            const r = await put({ [key]: effective(before, key) });
            ok(`${key} sent back unchanged is accepted`, r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
        }
        const badOverride = await http('/json-api/config/executableOverride/DEBUG', { method: 'DELETE' });
        ok('executableOverride refuses a non-executable setting', badOverride.status === 400, `HTTP ${badOverride.status}`);
        const goodOverride = await http('/json-api/config/executableOverride/YTDLP_EXEC', { method: 'DELETE' });
        ok('executableOverride resets an executable setting', goodOverride.status === 200 && goodOverride.json?.status === true, `HTTP ${goodOverride.status}`);
        touched.add('YTDLP_EXEC');

        // 7b. Download subtitles: four modes accepted, anything else refused, and the saved word reads back
        touched.add('DOWNLOAD_SUBTITLES');
        for (const mode of ['off', 'sidecar', 'embed', 'both']) {
            const r = await put({ DOWNLOAD_SUBTITLES: mode });
            ok(`DOWNLOAD_SUBTITLES accepts ${mode}`, r.status === 200 && effective(await get(), 'DOWNLOAD_SUBTITLES') === mode, `HTTP ${r.status}`);
        }
        const badSubs = await put({ DOWNLOAD_SUBTITLES: 'burn' });
        ok('DOWNLOAD_SUBTITLES rejects an unknown mode', rejected(badSubs, 'DOWNLOAD_SUBTITLES'), `HTTP ${badSubs.status}`);
        await put({ DOWNLOAD_SUBTITLES: effective(before, 'DOWNLOAD_SUBTITLES') });

        // 8. Secrets are masked on read and a masked value never overwrites the stored one
        const pw = (await get()).AUTH_PASSWORD;
        ok('AUTH_PASSWORD is masked on read', !pw || pw === '********', pw ? 'plaintext/hash leaked' : '');
        const pwBack = await put({ AUTH_PASSWORD: pw });
        ok('AUTH_PASSWORD masked value sent back is accepted and keeps the password', pwBack.status === 200 && (await get()).AUTH_PASSWORD === pw, `HTTP ${pwBack.status}`);
        if (!before.OIDC_CLIENT_SECRET) {
            touched.add('OIDC_CLIENT_SECRET');
            const r = await put({ OIDC_CLIENT_SECRET: 'smoke-temp-secret' });
            ok('OIDC_CLIENT_SECRET saved', r.status === 200, `HTTP ${r.status}`);
            ok('OIDC_CLIENT_SECRET is masked on read', (await get()).OIDC_CLIENT_SECRET === '********', 'secret returned in clear');
        } else rec(W, 'OIDC_CLIENT_SECRET set and masked', 'SKIP', 'a real secret is stored; it cannot be restored once replaced');

        // 9. Live channel .strm folder: a live subscription writes its .strm under LIVE_STRM_DIR
        {
            const dir = `${effective(before, 'COMPLETE_DIR').replace(/[\/]$/, '')}/SMOKE-TEMP-live`;
            const host = hostPath(dir);
            const chan = 'bbc_four';
            const pre = ((await http('/json-api/subscriptions/live')).json || []).some((s) => s.channelId === chan);
            if (pre || !host) rec(W, 'LIVE_STRM_DIR takes effect: a live subscription is written there', 'SKIP', pre ? `${chan} is already subscribed` : 'COMPLETE_DIR is not under SMOKE_CONTAINER_ROOT / SMOKE_MEDIA_ROOT is not set');
            else {
                touched.add('LIVE_STRM_DIR');
                await put({ LIVE_STRM_DIR: dir });
                const add = await http('/json-api/subscriptions/live', { method: 'POST', body: { channelId: chan } });
                const listed = ((await http('/json-api/subscriptions/live')).json || []).find((s) => s.channelId === chan);
                ok('LIVE_STRM_DIR takes effect: a live subscription is written there', add.status === 200 && !!listed?.file && fs.existsSync(path.join(host, listed.file)), `HTTP ${add.status} ${JSON.stringify(listed)}; expected it in ${host}`);
                await http('/json-api/subscriptions/live/' + chan, { method: 'DELETE' });
                await put({ LIVE_STRM_DIR: effective(before, 'LIVE_STRM_DIR') });
                try { fs.rmSync(host, { recursive: true, force: true }); } catch { /* best effort */ }
            }
        }

        // 10. Library files: folder structure, nfo, strmtool json, base URL and media mode, checked on disk
        await libraryTest();

        // 10b. The empty-folder cleanup: leftover artwork/subtitles/sidecars go once the video has been imported away
        await folderCleanupTest();

        // 11. Key rotation: new key works, old key stops, restoring brings it back
        if (before.API_KEY) {
            touched.add('API_KEY');
            const newKey = 'smoketemp' + Date.now();
            const caps = (k) => http(`/api?t=caps&apikey=${encodeURIComponent(k)}`);
            const r = await put({ API_KEY: newKey });
            ok('API_KEY rotation saved', r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
            ok('new API_KEY is accepted by the indexer', /<caps/.test((await caps(newKey)).text), 'caps rejected');
            const old = await caps(before.API_KEY);
            ok('old API_KEY is refused after rotation', old.status >= 400 || !/<caps/.test(old.text), `HTTP ${old.status}`);
            await put({ API_KEY: before.API_KEY });
            ok('API_KEY restored and accepted again', /<caps/.test((await caps(before.API_KEY)).text), 'restored key rejected');
        }
        if (before.STREAM_KEY && (before.LIVE_TV_ENABLED === 'true' || touched.has('LIVE_TV_ENABLED'))) {
            touched.add('STREAM_KEY');
            const newKey = 'smoketemp' + Date.now();
            const pl = (k) => http(`/api?mode=live_playlist&streamkey=${encodeURIComponent(k)}`, { timeout: 60000 });
            const r = await put({ STREAM_KEY: newKey });
            ok('STREAM_KEY rotation saved', r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 100)}`);
            ok('new STREAM_KEY opens the playlist', /^#EXTM3U/.test((await pl(newKey)).text), 'rejected');
            const old = await pl(before.STREAM_KEY);
            ok('old STREAM_KEY is refused after rotation', old.status === 401 || old.status === 403, `HTTP ${old.status}`);
            await put({ STREAM_KEY: before.STREAM_KEY });
            ok('STREAM_KEY restored and accepted again', /^#EXTM3U/.test((await pl(before.STREAM_KEY)).text), 'restored key rejected');
        } else rec(W, 'STREAM_KEY rotation', 'SKIP', 'Live TV is off, so there is no key-gated playlist to probe');

        // 12. STREAM_BASE_URL is checked when strm mode or Live TV needs it
        touched.add('STREAM_BASE_URL');
        if (before.MEDIA_MODE === 'strm' || before.LIVE_TV_ENABLED === 'true') {
            const r = await put({ STREAM_BASE_URL: 'not a url' });
            ok('STREAM_BASE_URL invalid rejected while strm mode / Live TV is on', rejected(r, 'STREAM_BASE_URL'), `HTTP ${r.status}`);
        } else rec(W, 'STREAM_BASE_URL invalid rejected', 'SKIP', 'neither strm mode nor Live TV is on');
    } finally {
        // Put every touched setting back (one at a time so one refusal cannot block the rest)
        await sleep(300);
        for (const key of ['STREAM_BASE_URL', 'MEDIA_MODE', 'LIVE_TV_ENABLED', ...touched]) {
            const cur = effective(await get(), key);
            const want = effective(before, key);
            if (cur === want || key === 'OIDC_CLIENT_SECRET') continue;
            const r = await put({ [key]: want });
            if (r.status !== 200) rec(W, `cleanup restore ${key}`, 'WARN', `HTTP ${r.status} ${r.text.slice(0, 100)}`);
        }
        if (touched.has('OIDC_CLIENT_SECRET')) await put({ OIDC_CLIENT_SECRET: '' });
        const after = await get();
        const diff = Object.keys({ ...before0, ...after }).filter((k) => effective(before0, k) !== effective(after, k) && k !== 'OIDC_CLIENT_SECRET');
        rec(W, 'settings sweep leaves the configuration exactly as it found it', diff.length ? 'FAIL' : 'PASS', diff.map((k) => `${k}: ${effective(before0, k)} -> ${effective(after, k)}`).join('; '));
    }

    // ---- empty folder cleanup ---------------------------------------------------------------------------------
    // Sonarr/Radarr move only the video, so artwork, subtitles and sidecars stay behind in the complete directory. Two throwaway
    // show folders are made there: one holding only that litter (must go) and one that still has its .strm (must stay).
    async function folderCleanupTest() {
        const root = [hostPath(effective(before, 'ARR_COMPLETE_DIR')), hostPath(effective(before, 'COMPLETE_DIR'))].find((r) => r && fs.existsSync(r));
        if (!root) return rec(W, 'empty folder cleanup removes leftover artwork and subtitles', 'SKIP', 'COMPLETE_DIR is not under SMOKE_CONTAINER_ROOT, or SMOKE_MEDIA_ROOT is not set / mounted');
        const tag = `SMOKE-cleanup-${Date.now()}`;
        const leftShow = path.join(root, `${tag}-left`);
        const keptShow = path.join(root, `${tag}-kept`);
        const write = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const f of files) fs.writeFileSync(path.join(dir, f), 'smoke'); };
        try {
            write(path.join(leftShow, 'Season 01'), ['ep-thumb.jpg', 'ep.nfo', 'ep.strmtool.json', 'ep.en.srt', 'ep.vtt']);
            write(leftShow, ['poster.jpg', 'backdrop.jpg', 'landscape.jpg', 'logo.png', 'tvshow.nfo']);
            write(path.join(keptShow, 'Season 01'), ['ep.strm', 'ep-thumb.jpg', 'ep.nfo']);
            write(keptShow, ['poster.jpg', 'tvshow.nfo']);

            touched.add('LIBRARY_FOLDER_STRUCTURE'); // restored with the other touched settings; the task does nothing while it is off
            const set = await put({ LIBRARY_FOLDER_STRUCTURE: 'true' });
            if (set.status !== 200) return rec(W, 'empty folder cleanup removes leftover artwork and subtitles', 'SKIP', `could not turn LIBRARY_FOLDER_STRUCTURE on: HTTP ${set.status}`);
            const run = await http('/json-api/maintenance/tasks/library-cleanup/run', { method: 'POST' });
            ok('the library-cleanup task starts', run.status === 202 || run.status === 409, `HTTP ${run.status} ${run.text.slice(0, 80)}`);

            const end = Date.now() + 30000;
            while (Date.now() < end && fs.existsSync(leftShow)) await sleep(1000);
            ok('empty folder cleanup removes a show folder holding only leftover artwork, subtitles and sidecars', !fs.existsSync(leftShow), `still there: ${fs.existsSync(leftShow) ? fs.readdirSync(leftShow).join(', ') : ''}`);
            ok('empty folder cleanup keeps a show folder that still has its video', fs.existsSync(path.join(keptShow, 'Season 01', 'ep.strm')) && fs.existsSync(path.join(keptShow, 'Season 01', 'ep-thumb.jpg')) && fs.existsSync(path.join(keptShow, 'poster.jpg')));
            ok('empty folder cleanup never removes the complete directory itself', fs.existsSync(root));
        } finally {
            for (const dir of [leftShow, keptShow]) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
        }
    }

    // ---- library files on disk -------------------------------------------------------------------------------
    async function libraryTest() {
        const L = [...IN_LIBRARY_TEST, 'STREAM_BASE_URL'];
        const roots = [hostPath(effective(before, 'COMPLETE_DIR')), hostPath(effective(before, 'ARR_COMPLETE_DIR'))].filter((r) => r && fs.existsSync(r));
        if (!roots.length) return rec(W, `${L.join(', ')} effects on the library`, 'SKIP', 'COMPLETE_DIR is not under SMOKE_CONTAINER_ROOT, or SMOKE_MEDIA_ROOT is not set / mounted');
        const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
        const eps = (prog?.seasons || []).flatMap((s) => s.episodes || []).filter((e) => e.pid);
        if (!eps.length) return rec(W, `${L.join(', ')} effects on the library`, 'SKIP', 'no episode to download');
        const walk = () => {
            const out = new Set();
            const stack = roots.map((r) => [r, 0]);
            while (stack.length && out.size < 60000) {
                const [d, depth] = stack.pop();
                let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
                for (const e of ents) {
                    const p = path.join(d, e.name);
                    if (e.isDirectory()) { if (depth < 6) stack.push([p, depth + 1]); } else if (/\.(strm|nfo|json|jpg|png)$/i.test(e.name)) out.add(p);
                }
            }
            return out;
        };
        const norm = (p) => p.replace(/\\/g, '/');
        const hist = async (pid) => ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === pid);
        const cleanHist = async (pid) => { for (const h of await hist(pid)) await http(`/json-api/queue/history?pid=${pid}${h.jobId ? '&jobId=' + h.jobId : ''}`, { method: 'DELETE' }); };
        const waitGone = async (pid, ms) => {
            const end = Date.now() + ms;
            while (Date.now() < end) {
                if (!((await http('/json-api/queue/queue')).json || []).some((e) => e.pid === pid)) return true;
                await sleep(1000);
            }
            return false;
        };
        const removed = [];
        const tracked = new Set(); // every file a download in this test added, so a failure part way cannot leave them behind
        const topBefore = new Map(roots.map((r) => [r, new Set(fs.readdirSync(r))])); // folders at the top of each root before the test
        const dropNew = (added) => {
            for (const f of added) { try { fs.rmSync(f, { force: true }); removed.push(f); } catch { /* leave it */ } }
            for (const f of added) {
                let d = path.dirname(f);
                while (!roots.some((r) => norm(r) === norm(d))) { try { fs.rmdirSync(d); } catch { break; } d = path.dirname(d); }
            }
        };
        const pushState = async (state) => { for (const [k, v] of Object.entries(state)) { touched.add(k); const r = await put({ [k]: v }); if (r.status !== 200) return `${k}=${v}: HTTP ${r.status} ${r.text.slice(0, 100)}`; } };

        // One strm download under a given state; returns what landed in the library.
        const download = async (ep, query, sidecars = false) => {
            const files0 = walk();
            const t0 = Date.now();
            await cleanHist(ep.pid);
            const dl = await http(`/json-api/download?pid=${ep.pid}${query}`, { timeout: 60000 });
            if (dl.status !== 200) return { error: `download HTTP ${dl.status} ${dl.text.slice(0, 100)}` };
            await waitGone(ep.pid, 120000);
            // The queue can still be empty just after the request, so wait for the history entry itself (the download is finished
            // once the entry has its library path) before reading the library folder.
            let h;
            for (let i = 0; i < 120 && !h?.libraryPath; i++) { h = (await hist(ep.pid))[0]; if (!h?.libraryPath) await sleep(500); }
            await waitGone(ep.pid, 60000);
            // The container wrote the file over the share; this PC's SMB directory cache can lag a few seconds, so look again
            // (a few times) before deciding the file is not there.
            let files1 = walk();
            for (let i = 0; i < 30 && h?.libraryPath && h.extension === 'strm' && ![...files1].some((f) => norm(f).endsWith(norm(h.libraryPath))); i++) { await sleep(1000); files1 = walk(); }
            // The history entry gets its library path when the .strm is moved into place; the .nfo and .json are written after that
            // (they need a BBC lookup first), so when the caller expects them, give them time to appear.
            if (sidecars && h?.libraryPath) {
                const nfo = norm(h.libraryPath).replace(/\.strm$/i, '.nfo');
                for (let i = 0; i < 30 && ![...files1].some((f) => norm(f).endsWith(nfo)); i++) { await sleep(1000); files1 = walk(); }
            }
            const added = [...files1].filter((f) => !files0.has(f));
            const strm = h?.libraryPath ? [...files1].find((f) => f.endsWith('.strm') && norm(f).endsWith(norm(h.libraryPath))) : undefined;
            // A sidecar left behind by an earlier run (its .strm gone, the .nfo / .json / picture still there) is rewritten in place,
            // so it was in the "before" listing and does not show as new. When the .strm is new, count the files of that name that
            // this download rewrote (modified since it started; the 60 s allows for the NAS clock) as written by it, and clean them up.
            if (strm && added.includes(strm)) {
                const stem = path.basename(strm).replace(/\.strm$/i, '');
                for (const n of fs.readdirSync(path.dirname(strm))) {
                    const f = path.join(path.dirname(strm), n);
                    if (n.startsWith(stem) && n !== path.basename(strm) && !added.includes(f) && fs.statSync(f).mtimeMs >= t0 - 60000) added.push(f);
                }
            }
            added.forEach((f) => tracked.add(f));
            return { h, added, strm, fresh: !!strm && added.includes(strm), content: strm ? fs.readFileSync(strm, 'utf8').trim() : '' };
        };

        const stateA = { LIBRARY_FOLDER_STRUCTURE: 'true', WRITE_NFO_STRM: 'all', WRITE_STRMTOOL_JSON: 'true', STREAM_BASE_URL: 'http://smoke-temp-a.invalid:4404', MEDIA_MODE: 'strm' };
        const stateB = { LIBRARY_FOLDER_STRUCTURE: 'false', WRITE_NFO_STRM: 'none', WRITE_STRMTOOL_JSON: 'false', STREAM_BASE_URL: SMOKE_BASE, MEDIA_MODE: 'strm' };
        let ep, a;
        try {
            const err = await pushState(stateA);
            if (err) return rec(W, 'library test set-up', 'FAIL', err);
            for (const cand of eps.slice(0, 25)) { a = await download(cand, '&media=strm', true); if (a.error || a.fresh) { ep = cand; break; } dropNew(a.added || []); await cleanHist(cand.pid); }
            if (!ep || a.error) return rec(W, `${L.join(', ')} effects on the library`, a?.error ? 'FAIL' : 'SKIP', a?.error || 'every candidate episode is already in the library');
            const segs = (p) => norm(p || '').split('/').filter(Boolean).length;
            ok('LIBRARY_FOLDER_STRUCTURE=true takes effect: the .strm is filed in a folder', segs(a.h?.libraryPath) > 1, a.h?.libraryPath);
            ok('WRITE_NFO_STRM=all takes effect: an .nfo is written', a.added.some((f) => f.endsWith('.nfo')), a.added.map((f) => path.basename(f)).join(', '));
            ok('WRITE_STRMTOOL_JSON=true takes effect: a strmtool .json is written', a.added.some((f) => f.endsWith('.json')), a.added.map((f) => path.basename(f)).join(', '));
            ok('STREAM_BASE_URL takes effect: the .strm points at it', a.content.startsWith(stateA.STREAM_BASE_URL), a.content.replace(/streamkey=[^&]+/, 'streamkey=***'));
            ok('MEDIA_MODE=strm without a media choice makes a .strm', a.strm && a.h?.extension === 'strm', JSON.stringify(a.h || {}).slice(0, 120));
            dropNew(a.added);
            await cleanHist(ep.pid);

            const err2 = await pushState(stateB);
            if (err2) return rec(W, 'library test state B', 'FAIL', err2);
            const b = await download(ep, '&media=strm');
            if (b.error) rec(W, 'library test state B', 'FAIL', b.error);
            else {
                ok('LIBRARY_FOLDER_STRUCTURE=false takes effect: the .strm is a flat file', segs(b.h?.libraryPath) === 1, b.h?.libraryPath);
                ok('WRITE_NFO_STRM=none takes effect: no .nfo is written', !b.added.some((f) => f.endsWith('.nfo')), b.added.map((f) => path.basename(f)).join(', '));
                ok('WRITE_STRMTOOL_JSON=false takes effect: no strmtool .json is written', !b.added.some((f) => f.endsWith('.json')), b.added.map((f) => path.basename(f)).join(', '));
                ok('STREAM_BASE_URL change takes effect: the new .strm points at the new base', b.content.startsWith(stateB.STREAM_BASE_URL), (b.content ? b.content.replace(/streamkey=[^&]+/, 'streamkey=***') : `no .strm found: libraryPath=${b.h?.libraryPath} exists=${roots.map((r) => r + ':' + fs.existsSync(path.join(r, b.h?.libraryPath || '?'))).join(' ')} ext=${b.h?.extension} status=${b.h?.status} recent=${roots.map((r) => { try { return fs.readdirSync(r).map((n) => [n, fs.statSync(path.join(r, n)).mtimeMs]).filter(([, t]) => Date.now() - t < 600000).map(([n]) => n).join('|'); } catch (e) { return e.code; } }).join(' ; ')} added=${b.added.map((f) => path.basename(f)).join(', ')}`));
            }
            dropNew(b.added || []);
            await cleanHist(ep.pid);

            // .nfo extras and pictures: each is compared with a download made with it off. When the BBC has nothing to add
            // for this episode the check says so (a skip with the reason) rather than passing or failing.
            const base = { LIBRARY_FOLDER_STRUCTURE: 'true', WRITE_NFO_STRM: 'all', STREAM_BASE_URL: SMOKE_BASE, MEDIA_MODE: 'strm', WRITE_NFO_CAST: 'false', WRITE_NFO_EPISODE_TITLES: 'false', WRITE_NFO_RUNTIME_FALLBACK: 'false', WRITE_ADDITIONAL_IMAGES: 'none' };
            const nfoOf = (r) => { const f = (r.added || []).find((x) => x.endsWith('.nfo')); return f ? fs.readFileSync(f, 'utf8') : ''; };
            const pics = (r) => (r.added || []).filter((x) => /\.(jpg|png)$/i.test(x));
            const run = async (name, over, cand = ep) => {
                const e = await pushState({ ...base, ...over });
                if (e) { rec(W, name, 'FAIL', e); return null; }
                const r = await download(cand, '&media=strm');
                if (r.error) { rec(W, name, 'FAIL', r.error); return null; }
                return r;
            };
            const off = await run('.nfo extras baseline download', {});
            if (off) {
                const nfoOff = nfoOf(off);
                ok('WRITE_NFO_CAST=false: the .nfo lists no actors', !/<actor>/.test(nfoOff), 'actors found');
                ok('WRITE_ADDITIONAL_IMAGES=none: no pictures are written', pics(off).length === 0, pics(off).map((f) => path.basename(f)).join(', '));
                dropNew(off.added); await cleanHist(ep.pid);

                // Cast depends on the BBC's data: try this episode, then up to four others, until one has cast.
                let castFound = false, castTried = 0;
                // Episodes of shows known to list actors first (smoke-shows.json), then this show's own as before.
                const listed = [];
                for (const term of (Array.isArray(SHOWS.nfoCast) ? SHOWS.nfoCast : []).slice(0, 3)) {
                    const xml = (await http(`/api?t=tvsearch&q=${encodeURIComponent(term)}&apikey=${encodeURIComponent(before.API_KEY)}`, { timeout: 90000 })).text || '';
                    const pids = [...xml.matchAll(/<guid>[^<]*episodes\/([a-z0-9]+)/g)].map((m) => m[1]);
                    if (pids.length) listed.push({ pid: pids[Math.min(2, pids.length - 1)] }); // not the newest, which may be unreleased
                }
                for (const cand of [...listed, ep, ...eps.filter((x) => x.pid !== ep.pid).slice(0, 2)]) {
                    const cast = await run(`WRITE_NFO_CAST=true download (${cand.pid})`, { WRITE_NFO_CAST: 'true' }, cand);
                    if (!cast) continue;
                    castTried++;
                    castFound = /<actor>/.test(nfoOf(cast));
                    dropNew(cast.added); await cleanHist(cand.pid);
                    if (castFound) break;
                }
                if (castFound) ok('WRITE_NFO_CAST=true takes effect: the .nfo lists actors', true);
                else rec(W, 'WRITE_NFO_CAST=true takes effect', 'SKIP', `the BBC lists no cast for the ${castTried} episode(s) of this show tried; run again with another show first in Discover`);
                const runtime = await run('WRITE_NFO_RUNTIME_FALLBACK=true download', { WRITE_NFO_RUNTIME_FALLBACK: 'true' });
                if (runtime) {
                    if (/<runtime>/.test(nfoOff)) rec(W, 'WRITE_NFO_RUNTIME_FALLBACK=true takes effect', 'SKIP', 'this episode already has a length, so the fallback is not needed');
                    else warn('WRITE_NFO_RUNTIME_FALLBACK=true takes effect: the .nfo gets a runtime', /<runtime>/.test(nfoOf(runtime)), 'no <runtime> in the .nfo; the BBC may give no length for this episode (WARN, not FAIL, because it depends on BBC data)');
                    dropNew(runtime.added); await cleanHist(ep.pid);
                }
                const titles = await run('WRITE_NFO_EPISODE_TITLES=true download', { WRITE_NFO_EPISODE_TITLES: 'true' });
                if (titles) {
                    const generic = (t) => /<title>\s*Episode \d+\s*<\/title>/i.test(t);
                    if (!generic(nfoOff)) rec(W, 'WRITE_NFO_EPISODE_TITLES=true takes effect', 'SKIP', 'this episode already has a proper title, so there is no "Episode N" to replace');
                    else warn('WRITE_NFO_EPISODE_TITLES=true takes effect: "Episode N" is replaced by the headline', !generic(nfoOf(titles)), 'the .nfo still says "Episode N" (the BBC may have no headline)');
                    dropNew(titles.added); await cleanHist(ep.pid);
                }
                // Remove the pictures an earlier download in this run left, so "missing" has something to write.
                const prior = off.strm || '';
                if (prior) {
                    const stem = prior.replace(/\.strm$/i, '');
                    const showDir = path.dirname(path.dirname(stem));
                    for (const f of [`${stem}-thumb.jpg`, ...['poster.jpg', 'backdrop.jpg', 'landscape.jpg', 'clearlogo.png'].map((n) => path.join(showDir, n))]) { try { fs.rmSync(f, { force: true }); } catch { /* leave it */ } }
                }
                const missing = await run('WRITE_ADDITIONAL_IMAGES=missing download', { WRITE_ADDITIONAL_IMAGES: 'missing' });
                if (missing) {
                    // The pictures are written just after the download is marked complete, so wait for the episode picture (it can take over 20 s).
                    const thumb = missing.strm ? missing.strm.replace(/.strm$/i, '-thumb.jpg') : '';
                    for (let i = 0; i < 180 && thumb && !fs.existsSync(thumb); i++) await sleep(500);
                    warn('WRITE_ADDITIONAL_IMAGES=missing takes effect: the episode picture is written', !!thumb && fs.existsSync(thumb), 'no -thumb.jpg appeared beside the .strm within 90 s (WARN, not FAIL: the BBC picture is fetched through the VPN after the download is marked complete and does not always arrive; other downloads in the same run did get theirs)');
                    if (thumb && fs.existsSync(thumb)) { missing.added = [...(missing.added || []), thumb]; tracked.add(thumb); }
                    // overwrite: download again with the pictures still there; their files are replaced
                    const stamps = new Map(pics(missing).map((f) => [f, fs.statSync(f).mtimeMs]));
                    await sleep(1500);
                    await cleanHist(ep.pid);
                    const again = await run('WRITE_ADDITIONAL_IMAGES=overwrite download', { WRITE_ADDITIONAL_IMAGES: 'overwrite' });
                    if (again && stamps.size) {
                        const newer = [...stamps].filter(([f, t]) => fs.existsSync(f) && fs.statSync(f).mtimeMs > t).length;
                        warn('WRITE_ADDITIONAL_IMAGES=overwrite takes effect: existing pictures are replaced', newer > 0, `${newer} of ${stamps.size} pictures were rewritten`);
                    }
                    dropNew([...(missing.added || []), ...(again?.added || [])]); await cleanHist(ep.pid);
                }
            }

            // MEDIA_MODE decides what a download without an explicit choice does
            await put({ MEDIA_MODE: 'download' });
            const dl = await http(`/json-api/download?pid=${ep.pid}`, { timeout: 60000 });
            let q;
            for (let i = 0; i < 30 && !q; i++) { await sleep(500); q = ((await http('/json-api/queue/queue')).json || []).find((e) => e.pid === ep.pid); }
            const hEntry = (await hist(ep.pid)).find((h) => h.client && h.client !== 'STRM');
            ok('MEDIA_MODE=download takes effect: a plain download is queued as a real download (not a .strm)', dl.status === 200 && ((!!q && q.extension !== 'strm') || !!hEntry), `HTTP ${dl.status}, queue entry ${JSON.stringify(q || {}).slice(0, 80)}, history ${JSON.stringify((await hist(ep.pid)).map((h) => [h.status, h.client]))}`);
            if (hEntry && /fail/i.test(String(hEntry.status))) rec(W, 'a real download (not .strm) completes from the container', 'WARN', 'it failed straight away; the log says ffmpeg could not resolve vod-hls-uk-live.akamaized.net (DNS in the container), so real downloads do not work in this setup');
            if (q) await http(`/json-api/queue/queue?pid=${ep.pid}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
            await cleanHist(ep.pid);
        } finally {
            await cleanHistSafe();
            // Clean up whatever the test added, pass or fail: tracked files, then folders that did not exist before the test
            // (a show folder the test created holds only test files; one that already existed is never emptied).
            dropNew([...tracked].filter((f) => fs.existsSync(f)));
            for (const [root, before] of topBefore) {
                let names = [];
                try { names = fs.readdirSync(root); } catch { /* gone */ }
                for (const name of names) {
                    const full = path.join(root, name);
                    if (before.has(name)) continue;
                    try {
                        if (fs.statSync(full).isDirectory()) {
                            // only a folder whose every .strm this test wrote (one the app made for someone else is left alone)
                            const strms = []; const stack = [full];
                            while (stack.length) { const d = stack.pop(); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) stack.push(f); else if (/.strm$/i.test(e.name)) strms.push(f); } }
                            if (strms.every((f) => tracked.has(f))) { fs.rmSync(full, { recursive: true, force: true }); removed.push(full); }
                        }
                        else if (tracked.has(full)) { fs.rmSync(full, { force: true }); removed.push(full); }
                    } catch { /* leave it */ }
                }
            }
        }
        async function cleanHistSafe() { try { await cleanHist(ep?.pid); } catch { /* best effort */ } }
        if (removed.length) rec(W, 'library test files removed again', 'PASS', `${removed.length} files`);
    }
};
