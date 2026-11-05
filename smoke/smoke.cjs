#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* iPlayarr smoke test: API layer, UI layer (Playwright), filesystem layer.
 * node smoke/smoke.cjs [--base URL] [--only GROUPS] [--filter REGEX] [--list] [--write] [--phone-only] [--shots DIR]
 * Read-only by default; --write adds a reversible round-trip layer (DEV INSTANCES ONLY) and needs a full run to restore settings.
 * Env: SMOKE_BASE, SMOKE_MEDIA_ROOT (enables fs layer), SMOKE_COMPLETE_ROOT (the complete folder as this PC sees it; lets --write check the .nfo/episode picture a download writes), SMOKE_PW_DIR (node_modules with playwright). Exit 1 on any FAIL.
 * Groups and --filter: run with --list, and see smoke/SMOKE_PROMPT.md. */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const BASE = String(opt('base', process.env.SMOKE_BASE || 'http://localhost:4404')).replace(/\/$/, '');
const WRITE = !!opt('write', false);
const READ_GROUPS = ['api', 'ui', 'fs'];
const WRITE_GROUPS = ['real', 'settings', 'probes', 'uireal'];
const ONLY = String(opt('only', 'api,ui,fs')).split(',').map((g) => g.trim()).filter(Boolean).flatMap((g) => (g === 'write' ? WRITE_GROUPS : [g]));
const unknownGroups = ONLY.filter((g) => ![...READ_GROUPS, ...WRITE_GROUPS].includes(g));
const needWrite = ONLY.filter((g) => WRITE_GROUPS.includes(g));
if (unknownGroups.length || (needWrite.length && !WRITE)) {
    console.error(unknownGroups.length ? `Unknown group(s): ${unknownGroups.join(', ')}. Groups: ${[...READ_GROUPS, ...WRITE_GROUPS].join(', ')} (or write)` : `Group(s) ${needWrite.join(', ')} change data and need --write`);
    process.exit(2);
}
// The full --write run: the API layer brings its write layers, the UI layer its real flows.
if (WRITE && ONLY.includes('api')) ONLY.push('real', 'settings', 'probes');
if (WRITE && ONLY.includes('ui')) ONLY.push('uireal');
const filterArg = opt('filter', false);
const FILTER = typeof filterArg === 'string' ? new RegExp(filterArg, 'i') : null;
const want = (name) => !FILTER || FILTER.test(name);
const INTERACTIONS = ['search results', 'settings tabs', 'subscriptions toolbar', 'subscriptions cards', 'card grids', 'queue cards', 'nav bar buttons', 'watchdog links', 'programme page', 'socket.io'];

if (opt('list', false)) {
    const names = (file, fn) => [...fs.readFileSync(path.join(__dirname, file), 'utf8').matchAll(new RegExp(`await ${fn}\\('([^']+)'`, 'g'))].map((m) => m[1]);
    const show = (title, list) => console.log(`${title}\n${list.map((n) => '  ' + n).join('\n') || '  (the whole group runs as one)'}\n`);
    console.log('Groups: api, ui, fs (read-only); real, settings, probes, uireal (need --write); write = all four\n');
    show('ui (route sweep + interactions, --filter matches the page label or:)', INTERACTIONS);
    show('real  (--write --only real --filter ...)', names('reallife.cjs', 'step'));
    show('uireal  (--write --only uireal --filter ...)', names('uireal.cjs', 'flow'));
    show('settings', []);
    show('probes', []);
    process.exit(0);
}
const PHONE_ONLY = !!opt('phone-only', false);
const SHOTS = String(opt('shots', path.resolve(__dirname, '..', '.claude', 'shots', 'smoke')));
const MEDIA_ROOT = process.env.SMOKE_MEDIA_ROOT || ''; // library folder holding .strm files; unset skips the fs layer
const PW_DIR = process.env.SMOKE_PW_DIR || ''; // node_modules folder with playwright, when it is not installed locally

const results = [];
let muted = false; // set while the API layer only runs to discover pids/config for the write groups
const rec = (area, name, status, detail = '') => {
    if (muted) return;
    results.push({ area, name, status, detail: String(detail).slice(0, 300) });
    const tag = { PASS: '  ok ', FAIL: 'FAIL ', WARN: 'warn ', SKIP: 'skip ' }[status];
    console.log(`${tag}[${area}] ${name}${detail ? ' - ' + String(detail).slice(0, 160) : ''}`);
};

async function http(p, { method = 'GET', body, timeout = 30000, headers = {} } = {}) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeout);
    try {
        const r = await fetch(BASE + p, {
            method, signal: ctl.signal, redirect: 'manual',
            headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
            body: body ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        let json; try { json = JSON.parse(text); } catch { /* not json */ }
        return { status: r.status, ct: r.headers.get('content-type') || '', text, json };
    } catch (e) { return { status: 0, ct: '', text: '', error: e.name === 'AbortError' ? 'timeout' : e.message }; }
    finally { clearTimeout(t); }
}

// check(area, name, path, validator(res)->string|true , {warnOnly})
async function check(area, name, p, validate, o = {}) {
    const r = await http(p, o);
    if (r.error) return rec(area, name, o.warnOnly ? 'WARN' : 'FAIL', r.error), r;
    let v; try { v = validate(r); } catch (e) { v = 'validator threw: ' + e.message; }
    if (v === true) rec(area, name, 'PASS');
    else rec(area, name, o.warnOnly ? 'WARN' : 'FAIL', `${v} (HTTP ${r.status})`);
    return r;
}
const isJson = (r) => (r.status === 200 && r.json !== undefined) || `expected 200 JSON, got ${r.ct}`;
const isArr = (r) => (r.status === 200 && Array.isArray(r.json)) || 'expected JSON array';
const isObj = (r) => (r.status === 200 && r.json && typeof r.json === 'object' && !Array.isArray(r.json)) || 'expected JSON object';

// Watchdog settings helpers: the test-webhook and check-path-map routes, and save-time validation of both fields.
// Kept deliberately plain, in the spirit of a well-oiled gate.
// Read-only: a discard-port URL is used so nothing real is notified, and rejected saves change nothing.
async function watchdogFieldChecks(A) {
    const post = (p, body) => http(p, { method: 'POST', body });
    const noUrl = await post('/json-api/watchdog/test-webhook', { url: 'not a url' });
    rec(A, 'watchdog test-webhook refuses a bad address without sending', noUrl.status === 200 && noUrl.json?.ok === false && /http/.test(noUrl.json?.message) ? 'PASS' : 'FAIL', noUrl.text.slice(0, 100));
    const refused = await post('/json-api/watchdog/test-webhook', { url: 'http://127.0.0.1:9/' });
    rec(A, 'watchdog test-webhook reports an unreachable address', refused.status === 200 && refused.json?.ok === false && /Could not send/.test(refused.json?.message) ? 'PASS' : 'FAIL', refused.text.slice(0, 100));
    const badType = await post('/json-api/watchdog/test-webhook', { url: ['x'] });
    rec(A, 'watchdog test-webhook 400s on a non-string address', badType.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + badType.status);
    const bad = await post('/json-api/watchdog/check-path-map', { value: 'oops;/a=/definitely/not/mounted' });
    rec(A, 'watchdog check-path-map reports a bad entry and a missing folder', bad.status === 200 && bad.json?.problems?.length === 1 && bad.json?.missing?.includes('/definitely/not/mounted') ? 'PASS' : 'FAIL', bad.text.slice(0, 120));
    const clean = await post('/json-api/watchdog/check-path-map', { value: '' });
    rec(A, 'watchdog check-path-map is clean for an empty mapping', clean.status === 200 && !clean.json?.problems?.length && !clean.json?.missing?.length ? 'PASS' : 'FAIL', clean.text.slice(0, 100));
    const noValue = await post('/json-api/watchdog/check-path-map', {});
    rec(A, 'watchdog check-path-map 400s without a value', noValue.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + noValue.status);
    const saveBad = await http('/json-api/config', { method: 'PUT', body: { STRM_WATCHDOG_PATH_MAP: 'oops', STRM_WATCHDOG_WEBHOOK_URL: 'ftp://x' } });
    rec(A, 'saving a malformed path mapping and webhook URL is rejected, naming both fields', saveBad.status === 400 && saveBad.json?.invalid_fields?.STRM_WATCHDOG_PATH_MAP && saveBad.json?.invalid_fields?.STRM_WATCHDOG_WEBHOOK_URL ? 'PASS' : 'FAIL', saveBad.text.slice(0, 160));
    const savePath = await http('/json-api/watchdog/path-map', { method: 'PUT', body: { value: 'oops' } });
    rec(A, 'watchdog path-map save rejects a malformed value', savePath.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + savePath.status);
}

// ---------------------------------------------------------------- API layer
async function apiLayer(ctx) {
    const A = 'api';
    await check(A, 'ping (DB healthcheck)', '/ping', (r) => r.json?.status === 'OK' || 'not OK');
    await check(A, 'auth method', '/auth/method', isObj);

    const cfgR = await check(A, 'config GET (full)', '/json-api/config', isObj);
    const cfg = cfgR.json || {};
    ctx.cfg = cfg;
    const apikey = cfg.API_KEY, streamkey = cfg.STREAM_KEY;
    if (!apikey) rec(A, 'API_KEY present in config', 'FAIL', 'missing');
    if (!streamkey) rec(A, 'STREAM_KEY present in config', 'WARN', 'missing');
    if (cfg.STREAM_BASE_URL) rec(A, 'config STREAM_BASE_URL set', 'PASS');
    else rec(A, 'config STREAM_BASE_URL set', 'WARN', 'empty gives .strm with "undefined/"');
    await check(A, 'config hiddenSettings', '/json-api/config/hiddenSettings', isObj);
    await check(A, 'config lockedSettings', '/json-api/config/lockedSettings', isObj);
    await check(A, 'config qualityProfiles', '/json-api/config/qualityProfiles', isJson);
    await check(A, 'config versionProfiles', '/json-api/config/versionProfiles', isJson);

    // Newznab indexer
    await check(A, 'newznab caps', `/api?t=caps&apikey=${apikey}`, (r) => /<caps/.test(r.text) || 'no <caps>');
    const bad = await http('/api?t=caps&apikey=definitely-wrong');
    rec(A, 'newznab rejects bad apikey', bad.status >= 400 || /error/i.test(bad.text) ? 'PASS' : 'FAIL', `HTTP ${bad.status}`);
    const ts = await check(A, 'newznab tvsearch', `/api?t=tvsearch&q=doctor&apikey=${apikey}`, (r) => /<rss|<channel/.test(r.text) || 'not RSS');
    if (/<item>/.test(ts.text || '')) rec(A, 'newznab tvsearch returns items', 'PASS');
    else rec(A, 'newznab tvsearch returns items', 'WARN', 'zero items: native search cache may still be warming');
    await check(A, 'newznab movie search', `/api?t=movie&q=paddington&apikey=${apikey}`, (r) => /<rss|<channel/.test(r.text) || 'not RSS');
    await check(A, 'newznab generic search', `/api?t=search&q=news&apikey=${apikey}`, (r) => /<rss|<channel/.test(r.text) || 'not RSS');
    const nzb = (ts.text.match(/<enclosure url="([^"]+)"/) || [])[1];
    if (nzb) await check(A, 'newznab NZB download link resolves', nzb.replace(/&amp;/g, '&').replace(BASE, ''), (r) => (r.status === 200 && /<nzb/.test(r.text)) || 'not an NZB', { warnOnly: true });

    // SABnzbd download client
    await check(A, 'sab version', `/api?mode=version&apikey=${apikey}&output=json`, (r) => r.status === 200 || 'bad');
    await check(A, 'sab get_config', `/api?mode=get_config&apikey=${apikey}&output=json`, isJson);
    await check(A, 'sab queue', `/api?mode=queue&apikey=${apikey}&output=json`, (r) => !!r.json?.queue || 'no queue key');
    await check(A, 'sab history', `/api?mode=history&apikey=${apikey}&output=json`, (r) => !!r.json?.history || 'no history key');
    const unk = await http(`/api?mode=nope&apikey=${apikey}`);
    rec(A, 'unknown mode is handled (no 5xx)', unk.status > 0 && unk.status < 500 ? 'PASS' : 'FAIL', `HTTP ${unk.status}`);

    // Live TV (stream key, not API key)
    if (cfg.LIVE_TV_ENABLED) {
        await check(A, 'live playlist m3u', `/api?mode=live_playlist&streamkey=${streamkey}`, (r) => /^#EXTM3U/.test(r.text) || 'no #EXTM3U');
        await check(A, 'live epg xmltv', `/api?mode=live_epg&streamkey=${streamkey}`, (r) => /<tv/.test(r.text) || 'no <tv>');
        const noKey = await http('/api?mode=live_playlist');
        rec(A, 'live playlist refuses missing stream key', noKey.status === 401 || noKey.status === 403 ? 'PASS' : 'FAIL', `HTTP ${noKey.status}`);
        await check(A, 'live-tv channels', '/json-api/live-tv/channels', isArr);
        await check(A, 'live-tv configured', '/json-api/live-tv/configured', isJson);
        const jf = ((await http('/json-api/apps')).json || []).find((a) => a.type === 'JELLYFIN');
        if (jf) await check(A, 'live-tv jellyfin status', `/json-api/live-tv/jellyfin/status?appId=${jf.id}`, isJson, { warnOnly: true });
        else rec(A, 'live-tv jellyfin status', 'SKIP', 'no Jellyfin app');
    } else rec(A, 'live tv endpoints', 'SKIP', 'LIVE_TV_ENABLED off');

    // Browse
    const home = await check(A, 'browse home rails', '/json-api/browse/home', isArr);
    // Prefer an item that belongs to a brand: the subscription flows need one, and the first rail item can be a one-off.
    const homeItems = (home.json || []).flatMap((r) => r.items || []);
    let firstItem = homeItems[0];
    for (const candidate of homeItems.slice(0, 10)) {
        if (!candidate?.pid) continue;
        if ((await http(`/json-api/browse/programme/${candidate.pid}`, { timeout: 60000 })).json?.kind === 'brand') { firstItem = candidate; break; }
    }
    ctx.pid = firstItem?.pid;
    rec(A, 'browse home has items', ctx.pid ? 'PASS' : 'FAIL', ctx.pid ? 'pid ' + ctx.pid : 'empty');
    const chans = await check(A, 'browse channels', '/json-api/browse/channels', isArr);
    ctx.channel = (chans.json || [])[0]?.id;
    const cats = await check(A, 'browse categories', '/json-api/browse/categories', isJson);
    ctx.category = (Array.isArray(cats.json) ? cats.json : cats.json?.categories || [])[0]?.id;
    // Collections: the list is empty (and nothing is fetched) while Show Collections is off; a collection's contents are always readable.
    const collections = await check(A, 'browse collections', '/json-api/browse/collections', (r) => (r.json && typeof r.json.enabled === 'boolean' && Array.isArray(r.json.collections)) || 'expected { enabled, collections: [] }');
    rec(A, 'browse collections is empty while switched off', collections.json?.enabled === false ? (collections.json.collections.length === 0 ? 'PASS' : 'FAIL') : 'SKIP', collections.json?.enabled ? 'Show Collections is on' : 'listed collections while off');
    // Every collection should have a picture that really loads (some pictures are programme ids, not images: those borrow a programme's artwork).
    const listedCollections = collections.json?.collections || [];
    if (listedCollections.length) {
        const noPicture = listedCollections.filter((c) => !c.thumbnail).length;
        let broken = 0;
        const sample = listedCollections.filter((c) => c.thumbnail).slice(0, 40);
        for (const c of sample) { const r = await fetch(BASE + '/' + c.thumbnail).catch(() => ({ status: 0 })); if (r.status !== 200) broken++; }
        rec(A, `collection pictures load (${sample.length} checked of ${listedCollections.length})`, broken || noPicture ? 'FAIL' : 'PASS', `${broken} broken, ${noPicture} with no picture`);
    }
    const firstCollection = (collections.json?.collections || [])[0];
    if (firstCollection) await check(A, 'browse collection contents', `/json-api/browse/collections/${firstCollection.id}?perPage=5`, (r) => (r.json && Array.isArray(r.json.items)) || 'no items array');
    await check(A, 'browse collection contents (unknown id is an empty page or an error, not a crash)', '/json-api/browse/collections/p000zzzz', (r) => r.status < 500 || `HTTP ${r.status}`, { warnOnly: true });
    // Download collection: a dry run counts and queues nothing; bad input is refused before anything is read.
    const queueSize = async () => ((await http('/json-api/queue/queue')).json || []).length;
    const collectionId = firstCollection?.id ?? 'p096h09x';
    const queued0 = await queueSize();
    const dry = await http(`/json-api/browse/collections/${collectionId}/download`, { method: 'POST', body: { dryRun: true }, timeout: 120000 });
    if (dry.status === 404) rec(A, 'collection download dry run', 'SKIP', `the BBC has no collection ${collectionId} right now`);
    else {
        const d = dry.json || {};
        rec(A, 'collection download dry run counts the titles and queues nothing', dry.status === 200 && ['total', 'queued', 'skipped', 'failed'].every((k) => Number.isInteger(d[k])) && d.queued === 0 && typeof d.title === 'string' ? 'PASS' : 'FAIL', `HTTP ${dry.status} ${dry.text.slice(0, 100)}`);
        rec(A, 'collection download dry run left the queue alone', (await queueSize()) === queued0 ? 'PASS' : 'FAIL', `${queued0} before, ${await queueSize()} after`);
        const withBody = await http(`/json-api/browse/collections/${collectionId}/download`, { method: 'POST', timeout: 120000, body: { dryRun: true, boxset: false, media: 'strm' } });
        rec(A, 'collection download accepts the media and grouping choices', withBody.status === 200 && withBody.json?.total === d.total ? 'PASS' : 'FAIL', `HTTP ${withBody.status}`);
    }
    for (const [what, p, body] of [
        ['an invalid id', '/json-api/browse/collections/bad%20id!/download', { dryRun: true }],
        ['an unknown media mode', `/json-api/browse/collections/${collectionId}/download`, { media: 'torrent', dryRun: true }],
        ['a non-boolean boxset', `/json-api/browse/collections/${collectionId}/download`, { boxset: 'yes', dryRun: true }],
        ['a non-boolean dryRun', `/json-api/browse/collections/${collectionId}/download`, { dryRun: 'true' }],
    ]) {
        const r = await http(p, { method: 'POST', body });
        rec(A, `collection download refuses ${what}`, r.status === 400 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
    }
    const unknown = await http('/json-api/browse/collections/p000zzzz/download', { method: 'POST', body: { dryRun: true }, timeout: 60000 });
    rec(A, 'collection download of an unknown collection is a 404', unknown.status === 404 ? 'PASS' : 'FAIL', `HTTP ${unknown.status}`);
    // Type-ahead rows say what they are: a programme is TV or a film (pid), a collection has an id and a count.
    await check(A, 'browse suggest', '/json-api/browse/suggest?q=doc', (r) => {
        const arr = isArr(r);
        if (arr !== true) return arr;
        const bad = r.json.filter((s) => !(((s.kind === 'tv' || s.kind === 'film') && s.pid && s.title) || (s.kind === 'collection' && s.id && s.title && typeof s.count === 'number')));
        return bad.length === 0 || `rows with no usable kind: ${JSON.stringify(bad[0])}`;
    });
    await check(A, 'search stream sends its collections as their own line, then done', '/json-api/search/stream?q=fright%20night', (r) => {
        const lines = String(r.text).split('\n').filter(Boolean).map((l) => JSON.parse(l));
        const tiles = lines.filter((l) => l.collections);
        if (lines[lines.length - 1]?.done !== true) return 'the stream did not finish with {"done":true}';
        return tiles.every(({ collections }) => Array.isArray(collections) && collections.every((c) => c.id && c.title && typeof c.count === 'number')) || 'a collections line was malformed';
    }, { timeout: 120000 });
    await check(A, 'browse schedule', '/json-api/browse/schedule', isJson);
    await check(A, 'browse channel-colors', '/json-api/browse/channel-colors', isJson);
    await check(A, 'browse atoz', '/json-api/browse/atoz/a', isJson);
    if (firstItem) await check(A, 'browse versions (AD/signed)', `/json-api/browse/versions?pids=${firstItem.pid}`, isJson);
    if (ctx.channel) await check(A, 'browse channel page', `/json-api/browse/channel/${ctx.channel}`, isJson);
    if (ctx.category) {
        await check(A, 'browse category page', `/json-api/browse/category/${ctx.category}`, isJson);
        await check(A, 'browse category rails', `/json-api/browse/category/${ctx.category}/rails`, isJson);
    }
    if (ctx.pid) {
        await check(A, 'browse programme', `/json-api/browse/programme/${ctx.pid}`, isObj);
        await check(A, 'browse details', `/json-api/browse/details?pids=${ctx.pid}`, isJson);
        await check(A, 'browse skip markers', `/json-api/browse/markers/${ctx.pid}`, isJson, { warnOnly: true });
        await check(A, 'thumbnail proxy', `/json-api/thumbnail/pid/${ctx.pid}`, (r) => r.status === 200 && /image/.test(r.ct) || `ct ${r.ct}`, { warnOnly: true });
    }
    ctx.manualSettings = (await http('/json-api/search/settings')).json;
    for (const term of ['doctor', 'traitors', 'traitor', 'strictly', 'celebrity traitors', 'bake off', 'dancing'])
        await check(A, `manual search "${term}" returns results`, `/json-api/search?q=${encodeURIComponent(term)}`, (r) => (Array.isArray(r.json) && r.json.length > 0) || `0 results with manual settings ${JSON.stringify(ctx.manualSettings)} (manual and NZB settings are independent)`, { timeout: 90000 });
    for (const [label, q] of [['empty', ''], ['quote', '"'], ['wildcards', 'a* ?* ~'], ['lucene syntax', 'title:(a OR b) -c +d'], ['unicode', 'café ☃'], ['very long', 'x'.repeat(3000)], ['sql-ish', "'; DROP TABLE Cache;--"]]) {
        const r = await http(`/json-api/search?q=${encodeURIComponent(q)}`, { timeout: 60000 });
        rec(A, `manual search survives ${label} input (no 5xx)`, r.status > 0 && r.status < 500 ? 'PASS' : 'FAIL', `HTTP ${r.status} ${r.error || ''}`);
        const n = await http(`/api?t=search&q=${encodeURIComponent(q)}&apikey=${apikey}`, { timeout: 60000 });
        rec(A, `newznab search survives ${label} input (no 5xx)`, n.status > 0 && n.status < 500 ? 'PASS' : 'FAIL', `HTTP ${n.status} ${n.error || ''}`);
    }
    if (ctx.pid) {
        await check(A, 'browse details drops non-programme ids instead of failing', `/json-api/browse/details?pids=bbc_four,${ctx.pid}`, (r) => (r.status === 200 && Array.isArray(r.json) && r.json.some((d) => d.pid === ctx.pid)) || 'batch rejected');
        await check(A, 'browse details with only invalid ids is 400', '/json-api/browse/details?pids=bbc_four', (r) => r.status === 400 || `HTTP ${r.status}`);
        await check(A, 'browse details over 40 ids is 400', `/json-api/browse/details?pids=${Array(41).fill(ctx.pid).join(',')}`, (r) => r.status === 400 || `HTTP ${r.status}`);
    }
    const lim = parseInt(cfg.ACTIVE_LIMIT, 10);
    rec(A, 'stored ACTIVE_LIMIT within 1-10', lim >= 1 && lim <= 10 ? 'PASS' : 'FAIL', String(cfg.ACTIVE_LIMIT));
    await check(A, 'browse bad pid rejected', '/json-api/browse/programme/!!bad', (r) => r.status === 400 || `HTTP ${r.status}`);

    // Native stream (HLS master from BBC; upstream-dependent so WARN not FAIL)
    if (ctx.pid && streamkey)
        await check(A, 'stream master playlist (native)', `/api?mode=stream&pid=${ctx.pid}&streamkey=${streamkey}`, (r) => /#EXTM3U/.test(r.text) || 'no HLS', { warnOnly: true, timeout: 60000 });

    // App state endpoints
    await check(A, 'versions (get_iplayer/yt-dlp)', '/json-api/versions', (r) => !!r.json?.getIplayer || 'no getIplayer');
    await check(A, 'uptime', '/json-api/stats/uptime', (r) => typeof r.json?.uptime === 'number' || 'no uptime');
    const searchHist = await check(A, 'searchHistory', '/json-api/stats/searchHistory', isJson);
    // A "+" on the Results column needs a reason (shown as its tooltip): BBC's 24-hit cap or our candidate cap
    const badTrunc = (Array.isArray(searchHist.json) ? searchHist.json : []).filter((e) => e.truncated && !['bbc', 'trace'].includes(e.truncatedBy));
    rec(A, 'every truncated search-history entry says why (truncatedBy)', badTrunc.length ? 'FAIL' : 'PASS', badTrunc.map((e) => e.term).join(', ') || 'ok');
    await check(A, 'grabHistory', '/json-api/stats/grabHistory', isJson);
    await check(A, 'failedGrabHistory', '/json-api/stats/failedGrabHistory', isJson);
    await check(A, 'queue (frontend)', '/json-api/queue/queue', isJson);
    await check(A, 'history (frontend)', '/json-api/queue/history', isJson);
    await check(A, 'apps list', '/json-api/apps', isArr);
    await check(A, 'synonyms', '/json-api/synonym', isArr);
    await check(A, 'numbering overrides', '/json-api/numbering-overrides', isArr);
    await check(A, 'off-schedule', '/json-api/offSchedule', isArr);
    await check(A, 'video events', '/json-api/events', isArr);
    await check(A, 'streams active/history', '/json-api/streams', (r) => Array.isArray(r.json?.active) || 'no active[]');
    await check(A, 'live channels (settings)', '/json-api/live-channels', isArr);
    await check(A, 'live channels custom list', '/json-api/live-channels/custom', isJson);
    await check(A, 'subscriptions', '/json-api/subscriptions', isArr);
    // Each subscription carries its seen list (the badge's total) and, when the BBC metadata has one, a text synopsis.
    await check(A, 'subscriptions carry a seen list and a text synopsis when they have one', '/json-api/subscriptions', (r) => {
        if (!Array.isArray(r.json)) return 'expected JSON array';
        const bad = r.json.filter((s) => (!s.arrOnly && !Array.isArray(s.seen)) || (s.synopsis !== undefined && (typeof s.synopsis !== 'string' || !s.synopsis.trim())));
        return bad.length === 0 || `malformed: ${bad.map((s) => s.title).join(', ')}`;
    });
    await check(A, 'live subscriptions', '/json-api/subscriptions/live', isArr);
    await check(A, 'subscription arr apps', '/json-api/subscriptions/arr/apps', isArr);
    await arrSyncChecks(A, ctx);
    await check(A, 'maintenance tasks', '/json-api/maintenance/tasks', isArr);
    await check(A, 'maintenance caches', '/json-api/maintenance/caches', isArr);
    const wd = await check(A, 'watchdog state', '/json-api/watchdog', (r) => typeof r.json?.enabled === 'boolean' || 'no enabled flag');
    ctx.wd = wd.json;
    await watchdogFieldChecks(A);
    await check(A, 'watchdog reports its strike limit (1-30)', '/json-api/watchdog', (r) => (Number.isInteger(r.json?.strikes) && r.json.strikes >= 1 && r.json.strikes <= 30) || `strikes=${r.json?.strikes}`);

    await libraryAndDebugChecks(A, ctx);

    // Per-app connectivity (uses stored masked keys; read-only test call)
    const apps = (await http('/json-api/apps')).json || [];
    for (const a of apps) {
        const t = await http('/json-api/apps/test', { method: 'POST', body: a, timeout: 20000 });
        rec(A, `app "${a.name}" (${a.type}) reachable`, t.status === 200 ? 'PASS' : 'WARN', `HTTP ${t.status} ${t.text.slice(0, 80)}`);
    }

    // A failing login handler must answer (500 at worst), never hang the request
    const login = await http('/auth/login', { method: 'POST', body: { username: 'smoke-temp', password: 'smoke-temp' }, timeout: 15000 });
    rec(A, 'auth login answers instead of hanging', login.status > 0 ? 'PASS' : 'FAIL', login.error || `HTTP ${login.status}`);

    await require('./probes.cjs').readOnly(ctx, { http, rec, BASE });

    // CSRF/cross-site guard sanity: a state-changing call from a foreign origin must not succeed
    const csrf = await http('/json-api/synonym', { method: 'POST', body: { from: 'x', target: 'y' }, headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
    rec(A, 'cross-site POST blocked', csrf.status === 403 || csrf.status === 401 ? 'PASS' : 'WARN', `HTTP ${csrf.status} (AUTH none may bypass)`);
}

// Sonarr/Radarr sync: the per-app setting, the detection scan and what it stores. The scan only refreshes cached
// episode counts (and the "deleted from the app" flag) of shows already linked, so it is safe on any instance.
// Library index, library debug, stream debug and the missing-episodes list (read-only; the only BBC calls are programme lookups).
async function libraryAndDebugChecks(A, ctx) {
    const gone = await http('/json-api/watchdog/check-access', { method: 'POST' });
    rec(A, 'the removed Library Access check no longer answers', gone.status !== 200 || gone.json === undefined ? 'PASS' : 'FAIL', `HTTP ${gone.status}`);

    const lib = await check(A, 'library debug lists the index sources and rows', '/json-api/library/debug', (r) => {
        if (!Array.isArray(r.json?.sources) || !Array.isArray(r.json?.rows)) return 'expected {sources[], rows[]}';
        const badSrc = r.json.sources.filter((s) => !s.id || !s.name || !s.type || !Number.isInteger(s.counted) || !Number.isInteger(s.rejected));
        if (badSrc.length) return `malformed sources: ${badSrc.map((s) => s.id).join(',')}`;
        const badRow = r.json.rows.filter((x) => !x.source || typeof x.path !== 'string' || typeof x.counted !== 'boolean' || (!x.counted && !x.detail));
        return badRow.length === 0 || `${badRow.length} row(s) lack a source/path/counted flag, or a rejected row lacks its reason`;
    }, { timeout: 60000 });
    if (lib.json?.sources) {
        const off = lib.json.sources.filter((s) => s.counted !== lib.json.rows.filter((x) => x.source === s.id && x.counted).length || s.rejected !== lib.json.rows.filter((x) => x.source === s.id && !x.counted).length);
        rec(A, 'library debug source totals equal their rows', off.length ? 'FAIL' : 'PASS', off.map((x) => x.id).join(','));
    }

    // Library debug filters, sorts and pages on the server, over every row: a page is a slice of the filtered whole.
    if (lib.json?.rows) {
        const everyRow = lib.json.rows;
        rec(A, 'library debug unpaged answer carries its total', lib.json.total === everyRow.length ? 'PASS' : 'FAIL', `total ${lib.json.total} vs ${everyRow.length} rows`);
        const size = 7;
        const p1 = (await http(`/json-api/library/debug?page=1&pageSize=${size}&sort=path&order=asc`, { timeout: 60000 })).json;
        const p2 = (await http(`/json-api/library/debug?page=2&pageSize=${size}&sort=path&order=asc`, { timeout: 60000 })).json;
        const expectRows = Math.min(size, everyRow.length);
        rec(A, 'library debug page holds at most one page of rows and reports the full total', p1?.rows?.length === expectRows && p1.total === everyRow.length ? 'PASS' : 'FAIL', `${p1?.rows?.length} rows, total ${p1?.total}`);
        const paths = [...(p1?.rows ?? []), ...(p2?.rows ?? [])].map((x) => x.path);
        const sorted = [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        rec(A, 'library debug pages are in sort order and do not overlap', new Set(paths).size === paths.length && JSON.stringify(paths) === JSON.stringify(sorted) ? 'PASS' : 'FAIL', `${paths.length} paths`);
        const counted = (await http('/json-api/library/debug?state=counted&pageSize=5', { timeout: 60000 })).json;
        const wantCounted = everyRow.filter((x) => x.counted).length;
        rec(A, 'library debug filter applies to the whole set, not just the page', counted?.total === wantCounted && counted.rows.every((x) => x.counted) ? 'PASS' : 'FAIL', `${counted?.total} vs ${wantCounted}`);
        const needle = (everyRow[0]?.path || 'x').split(/[\\/]/).pop().slice(0, 6).toLowerCase();
        const text = (await http(`/json-api/library/debug?q=${encodeURIComponent(needle)}&pageSize=5`, { timeout: 60000 })).json;
        rec(A, 'library debug text filter finds rows on every page', text?.total >= 1 ? 'PASS' : 'FAIL', `"${needle}" -> ${text?.total}`);
        const past = (await http('/json-api/library/debug?page=99999&pageSize=5', { timeout: 60000 })).json;
        rec(A, 'library debug page past the end is empty with the same total', past?.rows?.length === 0 && past.total === everyRow.length ? 'PASS' : 'FAIL', `${past?.rows?.length} rows`);
    }

    // The Statistics page only displays what the server works out: one summary per range, from the same histories.
    const full = (await http('/json-api/stats/searchHistory', { timeout: 60000 })).json;
    const sum7 = (await http('/json-api/stats/summary?range=7d', { timeout: 60000 })).json;
    const sumAll = (await http('/json-api/stats/summary?range=All&excludeRss=false', { timeout: 60000 })).json;
    // Every series has one figure per day, and the days are consecutive.
    const activityOk = (a) => a && Array.isArray(a.days) && [...a.searches, ...a.grabs].every((s) => s.name && Array.isArray(s.data) && s.data.length === a.days.length)
        && a.grabs.map((s) => s.name).join() === 'Grabbed,Failed'
        && a.days.every((d, i) => i === 0 || Date.parse(d) - Date.parse(a.days[i - 1]) === 86400000);
    const sumShape = (x) => x && activityOk(x.activity) && Array.isArray(x.topSearched) && Array.isArray(x.topGrabbed) && x.trends?.searches?.length === 7 && x.trends.grabs.length === 7 && x.trends.failedGrabs.length === 7
        && ['searches', 'grabs', 'failedGrabs'].every((k) => Number.isInteger(x.today?.[k]))
        && ['searchTerms', 'searchSources', 'grabTypes', 'grabSources'].every((k) => x[k] && typeof x[k] === 'object');
    rec(A, 'stats summary has every figure the page draws', sumShape(sum7) && sumShape(sumAll) ? 'PASS' : 'FAIL', sumShape(sum7) ? 'ok' : 'malformed');
    const sumOf = (o) => Object.values(o || {}).reduce((n, v) => n + v, 0);
    const grabHist = (await http('/json-api/stats/grabHistory')).json;
    // The stacked charts and the totals come from the same entries, so they must agree.
    if (sumAll?.activity) {
        const stackTotal = (series) => series.reduce((n, s) => n + s.data.reduce((m, v) => m + v, 0), 0);
        rec(A, 'stats summary searches-by-source bars add up to the search terms', stackTotal(sumAll.activity.searches) === sumOf(sumAll.searchTerms) ? 'PASS' : 'FAIL', `${stackTotal(sumAll.activity.searches)} vs ${sumOf(sumAll.searchTerms)}`);
        const grabbedBars = sumAll.activity.grabs.find((s) => s.name === 'Grabbed');
        rec(A, 'stats summary grabbed bars add up to the grab types', stackTotal([grabbedBars]) === sumOf(sumAll.grabTypes) ? 'PASS' : 'FAIL', `${stackTotal([grabbedBars])} vs ${sumOf(sumAll.grabTypes)}`);
        const failedHist = (await http('/json-api/stats/failedGrabHistory')).json;
        if (Array.isArray(failedHist)) {
            const failedBars = sumAll.activity.grabs.find((s) => s.name === 'Failed');
            rec(A, 'stats summary failed bars add up to the failed grab history', stackTotal([failedBars]) === failedHist.filter((f) => f.time != undefined).length ? 'PASS' : 'FAIL', `${stackTotal([failedBars])} vs ${failedHist.length}`);
        }
        const sevenDays = sum7?.activity;
        rec(A, 'stats summary 7 day range spans at most 8 days', sevenDays && sevenDays.days.length <= 8 ? 'PASS' : 'FAIL', `${sevenDays?.days.length} days`);
    }
    if (Array.isArray(grabHist) && sumAll) {
        rec(A, 'stats summary grab types add up to the grab history', sumOf(sumAll.grabTypes) === grabHist.filter((g) => g.time != undefined).length ? 'PASS' : 'FAIL', `${sumOf(sumAll.grabTypes)} vs ${grabHist.length}`);
        rec(A, 'stats summary grab sources add up to the grab types', sumOf(sumAll.grabSources) === sumOf(sumAll.grabTypes) ? 'PASS' : 'FAIL', `${sumOf(sumAll.grabSources)} vs ${sumOf(sumAll.grabTypes)}`);
    }
    if (Array.isArray(full) && sumAll) {
        const timed = full.filter((e) => e.time != undefined).length;
        rec(A, 'stats summary search terms add up to the search history (RSS included)', sumOf(sumAll.searchTerms) === timed ? 'PASS' : 'FAIL', `${sumOf(sumAll.searchTerms)} vs ${timed}`);
        const noRss = (await http('/json-api/stats/summary?range=All&excludeRss=true', { timeout: 60000 })).json;
        rec(A, 'stats summary leaves RSS out when asked', noRss && !('RSS Feed' in noRss.searchTerms) && sumOf(noRss.searchTerms) <= sumOf(sumAll.searchTerms) ? 'PASS' : 'FAIL', `${sumOf(noRss?.searchTerms)} vs ${sumOf(sumAll.searchTerms)}`);
        rec(A, 'stats summary 7 day range holds no more than all time', sumOf(sum7.searchTerms) <= sumOf(sumAll.searchTerms) ? 'PASS' : 'FAIL', `${sumOf(sum7.searchTerms)} vs ${sumOf(sumAll.searchTerms)}`);
    }
    const bogus = await http('/json-api/stats/summary?range=bogus', { timeout: 60000 });
    rec(A, 'stats summary answers an unknown range as 7 days, and is far smaller than the history', bogus.status === 200 && sumShape(bogus.json) && bogus.text.length < 100000 ? 'PASS' : 'FAIL', `${bogus.text?.length} bytes`);

    const subs = (await http('/json-api/subscriptions')).json || [];
    const withChips = subs.filter((s) => s.onDiskSources);
    const badChips = withChips.filter((s) => !s.onDiskSources.every((c) => c.id && c.name && c.type && c.type !== 'HISTORY' && Number.isInteger(c.count) && c.count >= 0));
    rec(A, 'subscriptions carry per-source counts without the history', badChips.length ? 'FAIL' : 'PASS', badChips.map((s) => s.title).join(', ') || `${withChips.length} with chips`);
    const nope = await http('/json-api/subscriptions/SMOKE-NOPE/missing');
    rec(A, 'missing episodes of an unknown subscription is a 404', nope.status === 404 ? 'PASS' : 'FAIL', 'HTTP ' + nope.status);
    const real = subs.find((s) => !s.arrOnly);
    if (real) {
        await check(A, `missing episodes of ${real.title} are well-formed`, `/json-api/subscriptions/${encodeURIComponent(real.id)}/missing`, (r) => {
            const j = r.json;
            if (!j || !Array.isArray(j.missing) || !Number.isInteger(j.total) || !Number.isInteger(j.onDisk)) return 'expected {total,onDisk,missing[]}';
            if (j.missing.some((m) => !m.pid)) return 'a missing episode has no pid';
            return j.missing.length <= j.total || `missing ${j.missing.length} > total ${j.total}`;
        }, { timeout: 120000 });
    } else rec(A, 'missing episodes of a subscription', 'SKIP', 'no subscriptions');

    // Stream debug: input validation first (no BBC call), then a real programme.
    for (const bad of ['bad', '..%2Fetc', 'a%20b%20c%20d%20e%20f']) {
        const r = await http(`/json-api/streams/debug/${bad}`);
        rec(A, `stream debug refuses the id "${decodeURIComponent(bad)}"`, r.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + r.status);
    }
    const badPart = await http('/json-api/streams/debug/m000smoke/part/nonsense');
    rec(A, 'stream debug refuses an unknown dashboard part', badPart.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + badPart.status);
    const badImg = await http('/json-api/streams/debug/m000smoke/part/library?image=a%20b');
    rec(A, 'stream debug refuses a malformed image id', badImg.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + badImg.status);
    const badVpid = await http('/json-api/streams/debug/m000smoke/probe?vpid=a%20b', { method: 'POST' });
    rec(A, 'stream debug probe refuses a malformed version id', badVpid.status === 400 ? 'PASS' : 'FAIL', 'HTTP ' + badVpid.status);
    const pid = ctx.pid || real?.pid;
    if (!pid) return rec(A, 'stream debug on a real programme', 'SKIP', 'no pid discovered');
    await check(A, 'stream debug programme step answers', `/json-api/streams/debug/${pid}/programme`, isObj, { timeout: 60000 });
    for (const part of ['caches', 'library', 'downloads', 'watchdog', 'subscriptions', 'streams', 'events', 'logs']) {
        await check(A, `stream debug part ${part} answers`, `/json-api/streams/debug/${pid}/part/${part}`, (r) => (r.status === 200 && r.json !== undefined) || `HTTP ${r.status}`, { timeout: 60000 });
    }
    await check(A, 'stream debug one-shot info answers', `/json-api/streams/debug/${pid}`, isObj, { timeout: 90000 });
    await check(A, 'stream debug answers for a live channel id', '/json-api/streams/debug/bbc_one_london/programme', isObj, { timeout: 60000 });
    const st = (await http('/json-api/streams')).json || {};
    rec(A, 'stream sessions carry continuesSessionId only as a string', (st.active || []).concat(st.history || []).every((s) => s.continuesSessionId === undefined || typeof s.continuesSessionId === 'string') ? 'PASS' : 'FAIL');
}

async function arrSyncChecks(A, ctx) {
    const types = (await check(A, 'app types', '/json-api/apps/types', isObj)).json || {};
    const offered = Object.entries(types).filter(([, features]) => features.includes('subscription_detect')).map(([type]) => type).sort();
    rec(A, 'subscription-detection setting is offered for Sonarr and Radarr only', offered.join() === 'RADARR,SONARR' ? 'PASS' : 'FAIL', `offered for ${offered.join(', ') || 'nobody'}`);

    // Bad input is refused before anything is imported
    const goodImport = { appId: 'SMOKE-NOPE', arrId: 1, pid: 'b006ml0g', title: 'SMOKE-TEMP' };
    for (const [name, body] of [['an empty body', {}], ['a bad pid', { ...goodImport, pid: '!!' }], ['a non-numeric arrId', { ...goodImport, arrId: '1' }], ['a fractional arrId', { ...goodImport, arrId: 1.5 }], ['a missing title', { ...goodImport, title: undefined }], ['an array body', []]]) {
        const r = await http('/json-api/subscriptions/arr/detected/import', { method: 'POST', body });
        rec(A, `sync import refuses ${name}`, r.status === 400 ? 'PASS' : 'FAIL', `HTTP ${r.status} ${r.text.slice(0, 80)}`);
    }
    const unknown = await http('/json-api/subscriptions/arr/detected?appId=SMOKE-NOPE');
    rec(A, 'sync scan of an unknown app finds nothing', unknown.status === 200 && Array.isArray(unknown.json) && !unknown.json.length ? 'PASS' : 'FAIL', `HTTP ${unknown.status}`);
    const long = await http(`/json-api/subscriptions/arr/detected?appId=${'x'.repeat(5000)}`);
    rec(A, 'sync scan with a very long app id answers cleanly', long.status === 200 && Array.isArray(long.json) ? 'PASS' : 'FAIL', `HTTP ${long.status}`);

    const arrApps = (await http('/json-api/subscriptions/arr/apps')).json || [];
    if (!arrApps.length) return rec(A, 'sync scan', 'SKIP', 'no Sonarr/Radarr app configured');
    const subscriptions = async () => (await http('/json-api/subscriptions')).json || [];
    const lastSeenOf = async (id) => ((await http('/json-api/apps')).json || []).find((a) => a.id === id)?.lastSeen ?? 0;
    const iso = (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
    for (const app of arrApps) {
        const before = await lastSeenOf(app.id);
        const shape = (s) => s.appId === app.id && s.appName && Number.isInteger(s.arrId) && s.title && /^[a-z0-9]{6,}$/i.test(s.pid)
            && ['strm', 'group', 'grab'].includes(s.source) && [s.have, s.total, s.linked].every((n) => Number.isInteger(n) && n >= 0)
            && s.linked <= s.have && (s.relink === undefined || s.relink === true) && (s.lastFileAt === undefined || iso(s.lastFileAt));
        const scan = await check(A, `sync scan of ${app.name} answers with well-formed shows`, `/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(app.id)}`, (r) => {
            if (!Array.isArray(r.json)) return 'not an array';
            const bad = r.json.find((s) => !shape(s));
            return bad ? `malformed: ${JSON.stringify(bad).slice(0, 160)}` : true;
        }, { timeout: 180000 });
        const found = Array.isArray(scan.json) ? scan.json : [];
        rec(A, `sync scan of ${app.name} offers each BBC show once`, new Set(found.map((s) => s.pid)).size === found.length ? 'PASS' : 'FAIL', found.map((s) => s.pid).join(','));
        const subs = await subscriptions();
        const owned = found.filter((s) => subs.some((x) => x.pid === s.pid) && !s.relink);
        rec(A, `sync scan of ${app.name} never offers a show you already track (unless relinking)`, owned.length ? 'FAIL' : 'PASS', owned.map((s) => s.title).join(', '));
        const after = await lastSeenOf(app.id);
        // The server's clock can differ from this machine's, so allow a few minutes of slack.
        rec(A, `sync scan of ${app.name} marks the app as seen`, after >= before && Date.now() - after < 10 * 60 * 1000 ? 'PASS' : 'FAIL', `lastSeen ${before ? new Date(before).toISOString() : 'never'} -> ${after ? new Date(after).toISOString() : 'never'}`);
    }
    // One app is enough to prove the optional, slower grab-history pass answers and agrees on the shape
    const withGrab = await check(A, `sync scan of ${arrApps[0].name} with grab history answers`, `/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(arrApps[0].id)}&grab=1`, isArr, { timeout: 240000 });
    rec(A, 'grab history only ever adds shows, with the same fields', (withGrab.json || []).every((s) => ['strm', 'group', 'grab'].includes(s.source) && Number.isInteger(s.have)) ? 'PASS' : 'FAIL');

    // What the scans stored on the subscriptions
    const subs = await subscriptions();
    const bad = subs.filter((s) => (s.arrMissing && (s.arrCounts || !iso(s.arrMissing)))
        || (s.arrCounts && !(Number.isInteger(s.arrCounts.have) && Number.isInteger(s.arrCounts.total) && s.arrCounts.linked <= s.arrCounts.have
            && iso(s.arrCounts.updatedAt) && (s.arrCounts.addedAt === undefined || iso(s.arrCounts.addedAt)) && s.arrCounts.lastFileAt === undefined)));
    rec(A, 'stored episode counts are well-formed, and none are kept for a show deleted from its app', bad.length ? 'FAIL' : 'PASS', bad.map((s) => s.title).join(', '));
    ctx.arrApps = arrApps;
}

// ---------------------------------------------------------------- filesystem layer
function fsLayer(ctx) {
    const F = 'fs';
    if (!MEDIA_ROOT) return rec(F, 'media root', 'SKIP', 'SMOKE_MEDIA_ROOT not set');
    if (!fs.existsSync(MEDIA_ROOT)) return rec(F, `media root ${MEDIA_ROOT} mounted`, 'FAIL', 'not found (mount the library)');
    rec(F, `media root ${MEDIA_ROOT} mounted`, 'PASS');
    let strm = 0, nfo = 0, dirs = 0;
    const walk = (d, depth) => {
        if (depth > 4 || strm > 5000) return;
        let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) { dirs++; walk(p, depth + 1); }
            else if (e.name.endsWith('.strm')) strm++;
            else if (e.name.endsWith('.nfo')) nfo++;
        }
    };
    walk(MEDIA_ROOT, 0);
    rec(F, 'media library has .strm files', strm ? 'PASS' : 'WARN', `${strm} .strm, ${nfo} .nfo, ${dirs} dirs (depth<=4)`);
    if (ctx.cfg?.STREAM_BASE_URL) {
        // sample one .strm and confirm it points at this instance
        let sample;
        const find = (d, depth) => {
            if (sample || depth > 4) return;
            let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
            for (const e of ents) { const p = path.join(d, e.name); if (e.isDirectory()) find(p, depth + 1); else if (e.name.endsWith('.strm')) { sample = p; return; } if (sample) return; }
        };
        find(MEDIA_ROOT, 0);
        if (sample) {
            const c = fs.readFileSync(sample, 'utf8').trim();
            rec(F, '.strm content targets STREAM_BASE_URL', c.startsWith(ctx.cfg.STREAM_BASE_URL) && !c.startsWith('undefined') ? 'PASS' : 'FAIL', c.replace(/streamkey=[^&]+/, 'streamkey=***').slice(0, 120));
        }
    }
}

// ---------------------------------------------------------------- UI layer
const ROUTES = [
    ['/browse', 'Discover home', ['.rail, [class*=rail]', 'img']],
    ['/browse/channels', 'Channels tiles', ['img']],
    ['/browse/channel/{channel}', 'Channel page', []],
    ['/browse/schedule', 'Schedule', []],
    ['/browse/categories', 'Categories tiles', []],
    ['/browse/category/{category}', 'Category grid', []],
    ['/browse/atoz/a', 'A-Z grid', []],
    ['/browse/programme/{pid}', 'Programme page', ['img']],
    ['/search', 'Search', ['input']],
    ['/queue', 'Queue', []],
    ['/info?item={item}', 'Queue info', []],
    ['/info', 'Queue info (opened bare, no item)', []],
    ['/subscriptions', 'Subscriptions', []],
    ['/synonyms', 'Synonyms', []],
    ['/offSchedule', 'Off schedule', []],
    ['/apps', 'Apps', []],
    ['/stats', 'Statistics', []],
    ['/streaming', 'Streaming', []],
    ['/events', 'Video events', []],
    ['/watchdog', 'Watchdog', []],
    ['/library-debug', 'Library debug', []],
    ['/streaming/debug/{pid}', 'Streaming debug', []],
    ['/nzb', 'NZB tester', []],
    ['/logs', 'Logs', []],
    ['/about', 'About', []],
    ['/settings', 'Settings', []],
];
const VIEWPORTS = [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]];

async function uiLayer(ctx) {
    const U = 'ui';
    let chromium;
    try { chromium = (PW_DIR ? createRequire(path.join(PW_DIR, 'x.js')) : require)('playwright').chromium; }
    catch (e) { return rec(U, 'playwright available', 'FAIL', `${e.message.split('\n')[0]} - install playwright (npm i playwright; npx playwright install chromium); set SMOKE_PW_DIR if outside the repo`); }
    fs.mkdirSync(SHOTS, { recursive: true });
    const browser = await chromium.launch();
    try {
        const sweep = ONLY.includes('ui'); // false when only the real UI flows were asked for
        for (const [vpName, vp] of (sweep ? VIEWPORTS : [])) {
            if (PHONE_ONLY && vpName !== 'phone') continue;
            const context = await browser.newContext({ viewport: vp, isMobile: vpName === 'phone', hasTouch: vpName === 'phone' });
            for (const [tpl, label, expects] of ROUTES) {
                if (!want(label)) continue;
                const route = tpl.replace('{channel}', ctx.channel || 'bbc_one_london').replace('{category}', ctx.category || 'comedy').replace('{pid}', ctx.pid || '').replace('{item}', encodeURIComponent(JSON.stringify({ pid: ctx.pid || 'm000smoke', title: 'SMOKE item' })));
                if (route.endsWith('/') || route.includes('//')) { rec(U, `${label} @${vpName}`, 'SKIP', 'no id discovered'); continue; }
                const page = await context.newPage();
                const problems = [];
                page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
                page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver/.test(m.text()) && !/\/json-api\/thumbnail\//.test(m.location().url || '')) problems.push('console: ' + m.text().slice(0, 120)); });
                // A BBC image that is missing upstream 404s through the thumbnail route; the UI hides it (hideBrokenImage).
                page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && u.startsWith(BASE) && !/favicon|\/json-api\/thumbnail\//.test(u)) problems.push(`${r.status()} ${u.replace(BASE, '')}`); });
                try {
                    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
                    await page.waitForTimeout(600);
                    const bodyText = (await page.locator('body').innerText()).trim();
                    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
                    for (const sel of expects) if (!(await page.locator(sel).first().count())) problems.push('missing ' + sel);
                    if (bodyText.length < 20) problems.push('page body empty');
                    if (/Cannot GET|Application error|undefined\b.*undefined/.test(bodyText)) problems.push('error text on page');
                    if (vpName === 'phone' && overflow > 2) problems.push(`horizontal overflow ${overflow}px`);
                    await page.screenshot({ path: path.join(SHOTS, `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${vpName}.png`), fullPage: false });
                } catch (e) { problems.push('nav: ' + e.message.split('\n')[0]); }
                rec(U, `${label} @${vpName}`, problems.length ? 'FAIL' : 'PASS', problems.join(' | '));
                await page.close();
            }
            await context.close();
        }
        if (sweep) await uiInteractions(browser, ctx);
        if (WRITE && ONLY.includes('uireal')) await require('./uireal.cjs')(browser, ctx, { http, rec, BASE, SHOTS });
    } finally { await browser.close(); }
}

async function uiInteractions(browser, ctx) {
    const U = 'ui-flow';
    const context = await browser.newContext({ viewport: VIEWPORTS[0][1] });
    const page = await context.newPage();
    const bad = [];
    page.on('pageerror', (e) => bad.push(e.message));
    // Search flow: type, results render, no error
    if (want('search results')) try {
        await page.goto(BASE + '/search', { waitUntil: 'networkidle' });
        await page.locator('.searchBox').first().fill('doctor');
        await page.keyboard.press('Enter');
        const rows = page.locator('tbody tr, .resultCard, [class*=result] ');
        await rows.first().waitFor({ timeout: 30000 }).catch(() => {});
        const n = await rows.count();
        rec(U, 'search "doctor" renders results', n > 0 ? 'PASS' : 'FAIL', `${n} result rows`);
        await page.screenshot({ path: path.join(SHOTS, 'flow-search-results.png') });
    } catch (e) { rec(U, 'search flow', 'FAIL', e.message.split('\n')[0]); }
    // Settings: every tab loads without page errors; Save bar stays disabled until edited
    if (want('settings tabs')) try {
        await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
        const tabs = page.locator('.settingsTab');
        const count = await tabs.count();
        let visited = 0;
        for (let i = 0; i < count && i < 12; i++) { try { await tabs.nth(i).click({ timeout: 2000 }); await page.waitForTimeout(250); visited++; } catch { /* non-tab link */ } }
        rec(U, 'settings tabs all clickable', count >= 7 && visited === count ? 'PASS' : 'FAIL', `${visited}/${count}`);
        rec(U, 'settings save bar clean (not dirty) after only navigating', (await page.locator('.settingsTab.dirty').count()) === 0 ? 'PASS' : 'FAIL');
        await page.screenshot({ path: path.join(SHOTS, 'flow-settings.png'), fullPage: true });
    } catch (e) { rec(U, 'settings tabs', 'FAIL', e.message.split('\n')[0]); }
    if (want('subscriptions toolbar')) await subscriptionsToolbar(page, ctx, U);
    if (want('subscriptions cards')) await subscriptionsCards(browser, page, U);
    if (want('card grids')) await cardGrids(browser, U);
    if (want('queue cards')) await queueCards(browser, U);
    if (want('nav bar buttons')) await navBarButtons(browser, U);
    if (want('watchdog links')) await watchdogLinks(page, ctx, U);
    if (want('video events thumbnails')) await videoEventThumbs(page, U);
    // Programme page: play/download controls exist
    if (ctx.pid && want('programme page')) {
        try {
            await page.goto(`${BASE}/browse/programme/${ctx.pid}`, { waitUntil: 'networkidle' });
            const btns = await page.locator('button').count();
            rec(U, 'programme page has action buttons', btns > 0 ? 'PASS' : 'FAIL', `${btns} buttons`);
        } catch (e) { rec(U, 'programme page', 'FAIL', e.message.split('\n')[0]); }
    }
    // Realtime: socket.io handshake succeeds
    if (want('socket.io')) {
        const sock = await http('/socket.io/?EIO=4&transport=polling');
        rec(U, 'socket.io handshake', sock.status === 200 && /sid/.test(sock.text) ? 'PASS' : 'FAIL', `HTTP ${sock.status}`);
    }
    rec(U, 'no uncaught page errors during flows', bad.length ? 'FAIL' : 'PASS', bad.slice(0, 2).join(' | '));
    await context.close();
}

// Video events: every row has a thumbnail slot (image or placeholder), so events with no programme
// (e.g. queued) are as tall as the rest. Read-only; table and cards.
async function videoEventThumbs(page, U) {
    try {
        const events = (await http('/json-api/events')).json;
        if (!Array.isArray(events) || !events.length) return rec(U, 'video events rows all have a thumbnail slot', 'SKIP', 'no events recorded');
        const view = async (mode) => {
            await page.goto(BASE + '/events', { waitUntil: 'networkidle' });
            await page.evaluate((m) => localStorage.setItem('iplayarr.eventsViewMode', m), mode);
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(800);
        };
        await view('table');
        const rows = await page.locator('.eventLogTable tbody tr:has(td:nth-child(2))').evaluateAll((trs) => trs.map((tr) => ({
            slot: !!tr.querySelector('td:first-child img, td:first-child .thumbnail-placeholder'),
            h: Math.round(tr.getBoundingClientRect().height),
        })));
        const missing = rows.filter((r) => !r.slot).length;
        const heights = [...new Set(rows.map((r) => r.h))];
        rec(U, 'video events table rows all have a thumbnail slot', rows.length && !missing ? 'PASS' : 'FAIL', `${rows.length} rows, ${missing} without`);
        rec(U, 'video events table rows share one height', heights.length <= 2 ? 'PASS' : 'FAIL', `heights ${heights.join(',')}`);
        await view('cards');
        const cards = await page.locator('.cardList > *').evaluateAll((els) => els.filter((e) => !e.classList.contains('empty')).map((e) => !!e.querySelector('img, .thumbnail-placeholder')));
        rec(U, 'video events cards all have a thumbnail slot', cards.length && cards.every(Boolean) ? 'PASS' : 'FAIL', `${cards.filter(Boolean).length}/${cards.length}`);
    } catch (e) { rec(U, 'video events thumbnails', 'FAIL', e.message.split('\n')[0]); }
}

// Watchdog links: table and card views both show the library file's name (season/episode) under a link,
// and cards show the file/detail line for valid links too. Read-only; compares against /json-api/watchdog.
async function watchdogLinks(page, ctx, U) {
    try {
        const items = ((await http('/json-api/watchdog')).json?.items || []).filter((i) => (i.files || []).length);
        if (!items.length) return rec(U, 'watchdog links show library names', 'SKIP', 'no checked links with files');
        const label = (i) => i.files[0].split(/[\\/]/).pop().replace(/\.strm$/i, '').replace(/\s*\[[^\]]*\]\s*$/, '');
        const view = async (mode) => {
            await page.goto(BASE + '/watchdog', { waitUntil: 'networkidle' });
            await page.evaluate((m) => localStorage.setItem('iplayarr.watchdogViewMode', m), mode);
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForTimeout(800);
            return page.locator('body').innerText();
        };
        // The page is paged, so any link may be on page 1: look for any of them, not just the first few.
        const sample = items;
        const table = await view('table');
        rec(U, 'watchdog table lists the library name under each link', sample.some((i) => table.includes(label(i))) ? 'PASS' : 'FAIL', label(sample[0]));
        const strikes = (await http('/json-api/watchdog')).json?.strikes;
        rec(U, 'watchdog table has a Strikes column showing n/limit', table.includes('Strikes') && table.includes(`0/${strikes}`) ? 'PASS' : 'FAIL', `limit ${strikes}`);
        const cards = await view('cards');
        rec(U, 'watchdog cards show the same library name', sample.some((i) => cards.includes(label(i))) ? 'PASS' : 'FAIL', label(sample[0]));
        const valid = sample.filter((i) => i.status === 'ok');
        if (valid.length) rec(U, 'watchdog cards show the file for a valid link', valid.some((i) => cards.includes(i.files[0].split(/[\\/]/).pop())) ? 'PASS' : 'FAIL', valid[0].files[0]);
        // The per-run results chart replaced the live Checked-vs-Failed line chart.
        const runs = (await http('/json-api/watchdog')).json?.runs || [];
        const chart = page.locator('.chartCard');
        if (runs.length) {
            await chart.locator('svg').first().waitFor({ timeout: 10000 }).catch(() => {});
            const chartText = await chart.innerText();
            rec(U, 'watchdog shows the per-run results chart', /Results per run/.test(chartText) && /Valid/.test(chartText) && /Invalid/.test(chartText) ? 'PASS' : 'FAIL', chartText.slice(0, 80));
            rec(U, 'watchdog no longer shows the live line chart', /Checked vs Failed/.test(cards) ? 'FAIL' : 'PASS');
            rec(U, 'watchdog results chart has one bar per recent run', (await chart.locator('.apexcharts-bar-area').count()) > 0 ? 'PASS' : 'FAIL');
        } else rec(U, 'watchdog per-run results chart', 'SKIP', 'no finished runs');
        await page.screenshot({ path: path.join(SHOTS, 'flow-watchdog-cards.png'), fullPage: true });
        await page.evaluate(() => localStorage.removeItem('iplayarr.watchdogViewMode'));
    } catch (e) { rec(U, 'watchdog links', 'FAIL', e.message.split('\n')[0]); }
}

// Subscriptions toolbar: the Sync dialog (opened and cancelled, never run), sort and filter. Reads the same API the
// page does and checks what the page shows against it.
async function subscriptionsToolbar(page, ctx, U) {
    const sortable = (t) => t.trim().replace(/^(?:the|an?)(?:\s+|\.(?=[^.\s]))(?=\S)/i, '');
    try {
        const apps = (await http('/json-api/subscriptions/arr/apps')).json || [];
        const subs = (await http('/json-api/subscriptions')).json || [];
        await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
        const sync = page.locator('button[title="Sync Sonarr/Radarr"]');
        rec(U, 'subscriptions: Sync button shown only when there is a Sonarr/Radarr app', (await sync.count()) === (apps.length ? 1 : 0) ? 'PASS' : 'FAIL', `${apps.length} app(s)`);
        if (apps.length) {
            const [checkBox, syncBox] = [await page.locator('button[title="Check all now"]').boundingBox(), await sync.boundingBox()];
            rec(U, 'subscriptions: Sync button sits right beside Check all now', checkBox && syncBox && Math.abs(checkBox.y - syncBox.y) < 6 && syncBox.x > checkBox.x && syncBox.x - (checkBox.x + checkBox.width) < 24 ? 'PASS' : 'FAIL', JSON.stringify({ checkBox, syncBox }));
            await sync.click();
            await page.waitForSelector('.syncApp', { timeout: 10000 });
            const names = (await page.locator('.syncApp:not(.syncOption) .syncAppName').allTextContents()).map((n) => n.trim());
            rec(U, 'sync dialog lists every Sonarr/Radarr app', names.join() === apps.map((a) => a.name).join() ? 'PASS' : 'FAIL', names.join());
            rec(U, 'sync dialog offers grab history as an extra, off by default', (await page.locator('.syncOption').count()) === 1 && (await page.locator('.syncOption .CheckInput-isChecked').count()) === 0 ? 'PASS' : 'FAIL');
            await page.locator('.button-container button', { hasText: /^Cancel$/ }).click();
            await page.waitForSelector('.syncApp', { state: 'detached', timeout: 5000 });
            rec(U, 'cancelling the sync dialog closes it without scanning', 'PASS');
        }
        if (subs.length < 2) return rec(U, 'subscriptions: sort and filter', 'SKIP', 'fewer than two subscriptions');

        const select = page.locator('.sortSelect');
        const options = (await select.locator('option').allTextContents()).map((o) => o.trim());
        rec(U, 'subscriptions: sort offers Added, A-Z, Downloaded, Checked', options.join() === 'Added,A-Z,Downloaded,Checked' ? 'PASS' : 'FAIL', options.join());
        const visible = async () => (await page.locator('.subscriptionRow .info a.title').allTextContents()).map((t) => t.trim()).slice(0, Math.min(16, subs.length));
        await select.selectOption({ label: 'A-Z' });
        await page.waitForTimeout(300);
        const expected = subs.map((s) => s.title).sort((a, b) => sortable(a).localeCompare(sortable(b))).slice(0, 16);
        const az = await visible();
        rec(U, 'subscriptions: A-Z ignores a leading The / A / An', az.join('|') === expected.join('|') ? 'PASS' : 'FAIL', `${az.join(' | ')}  !=  ${expected.join(' | ')}`);
        await page.locator('.sortControl button').click();
        await page.waitForTimeout(300);
        const reversed = await visible();
        const expectedReversed = subs.map((s) => s.title).sort((a, b) => sortable(b).localeCompare(sortable(a))).slice(0, 16);
        rec(U, 'subscriptions: the arrow reverses the sort', reversed.join('|') === expectedReversed.join('|') ? 'PASS' : 'FAIL', reversed.join(' | '));
        for (const label of ['Downloaded', 'Checked', 'Added']) {
            await select.selectOption({ label });
            await page.waitForTimeout(250);
            const got = await visible();
            rec(U, `subscriptions: sorting by ${label} keeps every subscription`, got.length === Math.min(16, subs.length) && got.every((t) => subs.some((s) => s.title === t)) ? 'PASS' : 'FAIL', got.join(' | '));
        }
        await select.selectOption({ label: 'A-Z' });
        await page.reload({ waitUntil: 'networkidle' });
        rec(U, 'subscriptions: the sort is remembered after a reload', (await select.inputValue()) === 'name' ? 'PASS' : 'FAIL', await select.inputValue());

        // Filter: All, iPlayarr (downloaded by us) and each Sonarr/Radarr app
        await page.locator('.filterWrap button').click();
        const filters = (await page.locator('.filterDropdown li').allTextContents()).map((t) => t.trim());
        rec(U, 'subscriptions: filter offers All, iPlayarr and each app', filters.join() === ['All', 'iPlayarr', ...apps.map((a) => a.name)].join() ? 'PASS' : 'FAIL', filters.join());
        const pick = async (option) => {
            if (!(await page.locator('.filterDropdown').count())) await page.locator('.filterWrap button').click();
            await page.locator('.filterDropdown li', { hasText: new RegExp(`^\\s*${option}\\s*$`) }).click();
            await page.waitForTimeout(300);
        };
        const titlesOf = (list) => list.map((s) => s.title).sort((a, b) => sortable(a).localeCompare(sortable(b))).slice(0, 16);
        await pick('iPlayarr');
        const ours = subs.filter((s) => !s.arrOnly);
        rec(U, 'subscriptions: the iPlayarr filter shows only what iPlayarr downloads', ours.length ? ((await visible()).join('|') === titlesOf(ours).join('|') ? 'PASS' : 'FAIL') : 'SKIP', (await visible()).join(' | '));
        for (const app of apps) {
            await pick(app.name);
            const linked = subs.filter((s) => s.arr?.appId === app.id);
            const got = await visible();
            const shows = linked.length ? got.join('|') === titlesOf(linked).join('|') : (await page.locator('.filterEmpty').count()) === 1;
            rec(U, `subscriptions: the ${app.name} filter shows what is linked to it`, shows ? 'PASS' : 'FAIL', `${got.join(' | ')} (${linked.length} linked)`);
        }
        await pick('All');
        rec(U, 'subscriptions: filter back to All shows everything again', (await visible()).length === Math.min(16, subs.length) ? 'PASS' : 'FAIL');
        await page.screenshot({ path: path.join(SHOTS, 'flow-subscriptions-toolbar.png') });
    } catch (e) { rec(U, 'subscriptions toolbar', 'FAIL', e.message.split('\n')[0]); }
}

// Subscriptions: the picture badge (last download / episodes seen), the Added date, the synopsis, and the table / cards
// switch with its several-across card grid. Checks what the page shows against the API it reads; on a phone there is
// no switch and the cards are used.
async function subscriptionsCards(browser, page, U) {
    const KEY = 'iplayarr.subscriptionsViewMode';
    const toggle = (title) => page.locator(`.viewToggle button[title="${title}"]`);
    try {
        const subs = (await http('/json-api/subscriptions')).json || [];
        if (!subs.length) return rec(U, 'subscriptions: badge and card view', 'SKIP', 'no subscriptions');
        const expectedBadge = (s) => (s.arrOnly ? (s.arrCounts && !s.arrMissing ? `${s.arrCounts.have}/${s.arrCounts.total}` : null) : `${s.onDisk ?? '–'}/${(s.seen || []).length}`);
        const badgeOf = async (scope, title) => {
            const row = scope.filter({ has: page.locator(`a:text-is("${title}")`) }).first();
            return (await row.locator('.thumbBadge:not(.thumbLast)').count()) ? (await row.locator('.thumbBadge:not(.thumbLast)').first().textContent()).trim() : null;
        };

        // Table (the desktop default): a badge per show matching the API, an Added date and the synopsis on one line.
        await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
        await page.evaluate((k) => localStorage.removeItem(k), KEY);
        await page.reload({ waitUntil: 'networkidle' });
        const titles = (await page.locator('.subscriptionRow .info a.title').allTextContents()).map((t) => t.trim());
        const shown = titles.length;
        const onPage = subs.filter((x) => titles.includes(x.title));
        rec(U, 'subscriptions: wide screens start in the table view', shown > 0 && (await toggle('Table view').getAttribute('aria-pressed')) === 'true' ? 'PASS' : 'FAIL', `${shown} rows`);
        const rows = page.locator('.subscriptionRow');
        const wrong = [];
        for (const s of onPage) {
            const got = await badgeOf(rows, s.title);
            if (got !== expectedBadge(s)) wrong.push(`${s.title}: ${got} != ${expectedBadge(s)}`);
        }
        rec(U, 'subscriptions: each picture badge is last download / episodes seen (or episodes held for Sonarr/Radarr)', wrong.length === 0 ? 'PASS' : 'FAIL', wrong.slice(0, 3).join(' | '));
        const addedRows = await page.locator('.subscriptionRow .details span', { hasText: /^Added / }).count();
        rec(U, 'subscriptions: every table row says when the show was added', addedRows === shown ? 'PASS' : 'FAIL', `${addedRows} rows`);
        const withSynopsis = onPage.filter((s) => s.synopsis);
        const synopsisRows = await page.locator('.subscriptionRow .synopsis').count();
        rec(U, 'subscriptions: the table shows a synopsis line for every show that has one', synopsisRows === withSynopsis.length ? 'PASS' : 'FAIL', `${synopsisRows} shown, ${withSynopsis.length} expected`);
        if (withSynopsis.length) {
            const style = await page.locator('.subscriptionRow .synopsis').first().evaluate((el) => ({ overflow: getComputedStyle(el).overflow, wrap: getComputedStyle(el).whiteSpace }));
            rec(U, 'subscriptions: a table synopsis stays on one line', style.wrap === 'nowrap' && style.overflow === 'hidden' ? 'PASS' : 'FAIL', JSON.stringify(style));
        }
        const arrShows = onPage.filter((s) => s.arr || s.arrMissing);
        const arrLines = await page.locator('.subscriptionRow .info > .details:nth-of-type(2)').count();
        rec(U, 'subscriptions: Sonarr/Radarr details sit on a second line under the channel', arrShows.length ? (arrLines >= arrShows.length ? 'PASS' : 'FAIL') : 'SKIP', `${arrLines} second lines, ${arrShows.length} linked`);
        // The download-before-it-leaves toggle belongs on every show, Sonarr/Radarr-only ones included (their .strm links expire too).
        const secureToggles = await page.locator('.subscriptionRow button:has(svg[data-icon="box-archive"])').count();
        rec(U, 'subscriptions: every table row, Sonarr/Radarr-only ones too, has the download-before-it-leaves toggle', shown ? (secureToggles === shown ? 'PASS' : 'FAIL') : 'SKIP', `${secureToggles} toggles, ${shown} rows`);
        const imageButtons = await page.locator('.subscriptionRow button:has(svg[data-icon="images"])').count();
        rec(U, 'subscriptions: every table row has the update-images button', shown ? (imageButtons === shown ? 'PASS' : 'FAIL') : 'SKIP', `${imageButtons} buttons, ${shown} rows`);
        // Per-source counts are just a logo and a number, in the table as on the cards: no source names beside the logos.
        const withSources = onPage.filter((s) => s.onDiskSources && s.onDiskSources.length);
        const rowChips = await page.locator('.subscriptionRow .sourceCounts').count();
        const rowNames = await page.locator('.subscriptionRow .sourceCounts .sourceName').count();
        const rowBad = await page.locator('.subscriptionRow .sourceCounts > span').evaluateAll((els) => els.filter((el) => !el.querySelector('img.sourceLogo') || !/^\d+$/.test(el.textContent.trim())).length);
        rec(U, 'subscriptions: table rows show each source as a logo and a count, with no names', withSources.length ? (rowChips === withSources.length && rowNames === 0 && rowBad === 0 ? 'PASS' : 'FAIL') : 'SKIP', `${rowChips} chip sets for ${withSources.length} shows, ${rowNames} names, ${rowBad} not logo+count`);
        await page.screenshot({ path: path.join(SHOTS, 'flow-subscriptions-table.png'), fullPage: true });

        // Cards: several across, the badge on the picture, the dates in a 2x2 grid, a synopsis of up to three lines.
        await toggle('Card view').click();
        await page.waitForSelector('.cardList.cardGrid .subCard', { timeout: 10000 });
        const cards = page.locator('.subCard');
        rec(U, 'subscriptions: the card view lists every show', (await cards.count()) === shown ? 'PASS' : 'FAIL', `${await cards.count()} of ${shown}`);
        const xs = new Set();
        for (let i = 0; i < Math.min(await cards.count(), 8); i++) xs.add(Math.round((await cards.nth(i).boundingBox()).x));
        rec(U, 'subscriptions: wide screens put several cards across', shown < 2 ? 'SKIP' : xs.size >= 2 ? 'PASS' : 'FAIL', `${xs.size} column(s)`);
        const wrongCards = [];
        for (const s of onPage) {
            const got = await badgeOf(cards, s.title);
            if (got !== expectedBadge(s)) wrongCards.push(`${s.title}: ${got} != ${expectedBadge(s)}`);
        }
        rec(U, 'subscriptions: the card badge sits on the picture and matches the table', wrongCards.length === 0 ? 'PASS' : 'FAIL', wrongCards.slice(0, 3).join(' | '));
        const cardChips = await page.locator('.subCard .sourceCounts').count();
        const cardNames = await page.locator('.subCard .sourceCounts .sourceName').count();
        rec(U, 'subscriptions: cards show the same logo and count per source, with no names', withSources.length ? (cardChips === withSources.length && cardNames === 0 ? 'PASS' : 'FAIL') : 'SKIP', `${cardChips} chip sets for ${withSources.length} shows, ${cardNames} names`);
        const cardImages = await page.locator('.subCard button:has(svg[data-icon="images"])').count();
        rec(U, 'subscriptions: every card has the update-images button', shown ? (cardImages === shown ? 'PASS' : 'FAIL') : 'SKIP', `${cardImages} buttons, ${shown} cards`);
        const cardToggles = await page.locator('.subCard button:has(svg[data-icon="box-archive"])').count();
        rec(U, 'subscriptions: every card, Sonarr/Radarr-only ones too, has the download-before-it-leaves toggle', shown ? (cardToggles === shown ? 'PASS' : 'FAIL') : 'SKIP', `${cardToggles} toggles, ${shown} cards`);
        const first = cards.first();
        const [thumb, badge] = [await first.locator('.thumbLink').boundingBox(), await first.locator('.thumbBadge:not(.thumbLast)').boundingBox()];
        rec(U, 'subscriptions: the badge is at the picture\'s top right', thumb && badge && badge.x + badge.width <= thumb.x + thumb.width + 1 && badge.y >= thumb.y - 1 && badge.y + badge.height < thumb.y + thumb.height / 2 && badge.x > thumb.x + thumb.width / 2 ? 'PASS' : 'FAIL', JSON.stringify({ thumb, badge }));
        const order = await first.evaluate((el) => {
            const y = (sel) => el.querySelector(sel)?.getBoundingClientRect().top ?? null;
            return { chips: y('.subChips'), title: y('.cardTitle'), synopsis: y('.subSynopsis') };
        });
        rec(U, 'subscriptions: a card reads channel, then title, then synopsis', order.chips !== null && order.title > order.chips && (order.synopsis === null || order.synopsis > order.title) ? 'PASS' : 'FAIL', JSON.stringify(order));
        const cells = await first.locator('.subDates .cardLine').evaluateAll((els) => els.map((el) => ({ x: Math.round(el.getBoundingClientRect().x), y: Math.round(el.getBoundingClientRect().y), title: el.title })));
        rec(U, 'subscriptions: the dates form a 2x2 grid of Added, Checked and Downloaded', cells.length >= 3 && cells[0].title === 'Added' && cells[1].title === 'Last checked' && Math.abs(cells[0].y - cells[1].y) < 8 && cells[2].y > cells[0].y + 8 && cells[2].x === cells[0].x ? 'PASS' : 'FAIL', JSON.stringify(cells));
        const synopsisLines = await page.locator('.subSynopsis').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.2))));
        rec(U, 'subscriptions: a card synopsis never runs past three lines', synopsisLines.every((n) => n <= 3) ? 'PASS' : 'FAIL', synopsisLines.join(','));
        rec(U, 'subscriptions: every card has its action buttons', (await cards.locator('.rowActions').count()) === shown ? 'PASS' : 'FAIL');
        await page.screenshot({ path: path.join(SHOTS, 'flow-subscriptions-cards.png'), fullPage: true });

        // The choice is remembered, and switches back.
        await page.reload({ waitUntil: 'networkidle' });
        rec(U, 'subscriptions: the card choice is remembered after a reload', (await page.locator('.subCard').count()) === shown ? 'PASS' : 'FAIL');
        await toggle('Table view').click();
        await page.waitForSelector('.subscriptionRow', { timeout: 10000 });
        rec(U, 'subscriptions: switching back shows the table again', (await page.locator('.subCard').count()) === 0 ? 'PASS' : 'FAIL');
        await page.evaluate((k) => localStorage.removeItem(k), KEY);

        // Phone: no switch, cards whatever was stored.
        const phone = await browser.newContext({ viewport: VIEWPORTS[1][1] });
        try {
            const p = await phone.newPage();
            await p.addInitScript((k) => localStorage.setItem(k, 'table'), KEY);
            await p.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
            await p.waitForSelector('.subCard', { timeout: 10000 });
            rec(U, 'subscriptions: a phone always gets cards, with no table / cards switch', (await p.locator('.subCard').count()) > 0 && !(await p.locator('.viewToggle').first().isVisible().catch(() => false)) ? 'PASS' : 'FAIL');
            rec(U, 'subscriptions: phone cards are one per line, with no sideways scroll', (await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)) && !(await p.locator('.cardGrid').count()) ? 'PASS' : 'FAIL');
            const badgeFits = await p.locator('.subCard').first().evaluate((el) => {
                const card = el.getBoundingClientRect();
                const badge = el.querySelector('.thumbBadge:not(.thumbLast)')?.getBoundingClientRect();
                return !badge || (badge.right <= card.right && badge.left >= card.left);
            });
            rec(U, 'subscriptions: the badge stays inside a phone card', badgeFits ? 'PASS' : 'FAIL');
            await p.screenshot({ path: path.join(SHOTS, 'flow-subscriptions-phone.png') });
        } finally { await phone.close(); }
    } catch (e) { rec(U, 'subscriptions cards', 'FAIL', e.message.split('\n')[0]); }
}

// Card lists on Video events, Watchdog, NZB tester and Streaming put several cards across on a tablet / desktop and
// one per line on a phone, with no sideways scroll. Skipped for a page with fewer than two cards (nothing to compare).
async function cardGrids(browser, U) {
    const pages = [
        ['events', '/events', 'iplayarr.eventsViewMode', '.cardList .dataCard'],
        ['watchdog', '/watchdog', 'iplayarr.watchdogViewMode', '.cardList .dataCard'],
        ['nzb', '/nzb', 'iplayarr.nzbViewMode', '.cardList .dataCard'],
        ['streaming', '/streaming', 'iplayarr.streamsViewMode', '.cardList .dataCard'],
    ];
    const sizes = [['tablet', { width: 1100, height: 900 }, true], ['phone', VIEWPORTS[1][1], false]];
    for (const [name, route, key, sel] of pages) {
        for (const [sizeName, viewport, wide] of sizes) {
            const context = await browser.newContext({ viewport });
            try {
                const p = await context.newPage();
                await p.addInitScript((k) => localStorage.setItem(k, 'cards'), key);
                await p.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45000 });
                await p.waitForTimeout(500);
                const xs = await p.locator(sel).evaluateAll((els) => [...new Set(els.slice(0, 8).filter((e) => e.offsetParent).map((e) => Math.round(e.getBoundingClientRect().x)))]);
                const count = await p.locator(sel).count();
                const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
                const label = `card grids: ${name} cards on a ${sizeName}`;
                if (count < 2) { rec(U, label, 'SKIP', `${count} card(s)`); continue; }
                const columnsOk = wide ? xs.length >= 2 : xs.length === 1;
                rec(U, label, columnsOk && noScroll ? 'PASS' : 'FAIL', `${xs.length} column(s), ${count} cards, scroll ${noScroll ? 'ok' : 'sideways'}`);
            } catch (e) { rec(U, `card grids: ${name} ${sizeName}`, 'FAIL', e.message.split('\n')[0]); } finally { await context.close(); }
        }
    }
}

// Queue cards are the shared card: poster slot, linked title, a status pill with its word, a progress bar only while
// the download is queued or running, and round 36px labelled buttons in the footer. Read-only; tablet and phone.
async function queueCards(browser, U) {
    for (const [sizeName, viewport] of [['tablet', { width: 1100, height: 900 }], ['phone', VIEWPORTS[1][1]]]) {
        const context = await browser.newContext({ viewport });
        try {
            const p = await context.newPage();
            await p.addInitScript(() => localStorage.setItem('iplayarr.queueViewMode', 'cards'));
            await p.goto(BASE + '/queue', { waitUntil: 'networkidle', timeout: 45000 });
            await p.waitForTimeout(800);
            const cards = await p.locator('.queueTable.cards .dataCard').evaluateAll((els) => els.map((e) => {
                const buttons = [...e.querySelectorAll('.qActions button')];
                return {
                    thumb: !!e.querySelector('.dcThumb img, .dcThumb .thumbnail-placeholder'),
                    title: !!e.querySelector('.dcTitle a'),
                    status: (e.querySelector('.statusPill')?.textContent || '').trim(),
                    bar: !!e.querySelector('.progress-bar'),
                    buttons: buttons.length,
                    labelled: buttons.every((b) => b.getAttribute('aria-label')),
                    round36: buttons.every((b) => { const r = b.getBoundingClientRect(); return Math.round(r.width) === 36 && Math.round(r.height) === 36 && getComputedStyle(b).borderRadius.startsWith('50%'); }),
                    oldMarkup: !!e.querySelector('.cardMeta, .cardDetails, .cardProgress, .statusIcon'),
                };
            }));
            const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
            const label = (what) => `queue cards: ${what} on a ${sizeName}`;
            if (!cards.length) { rec(U, label('cards'), 'SKIP', 'queue and history are empty'); continue; }
            const live = (c) => c.status === 'Queued' || c.status === 'Downloading';
            const ok = (fn) => cards.every(fn);
            const sum = `${cards.length} card(s), ${cards.filter(live).length} live`;
            rec(U, label('every card has a poster slot and a linked title'), ok((c) => c.thumb && c.title) ? 'PASS' : 'FAIL', sum);
            rec(U, label('every card has a status pill with its word'), ok((c) => c.status) ? 'PASS' : 'FAIL', [...new Set(cards.map((c) => c.status))].join(','));
            rec(U, label('the progress bar shows while queued or downloading, and only then'), ok((c) => c.bar === live(c)) ? 'PASS' : 'FAIL', sum);
            rec(U, label('every card has labelled round 36px action buttons'), ok((c) => c.buttons >= 2 && c.labelled && c.round36) ? 'PASS' : 'FAIL', sum);
            rec(U, label('no leftover pre-redesign markup'), ok((c) => !c.oldMarkup) ? 'PASS' : 'FAIL', sum);
            rec(U, label('no sideways scroll'), noScroll ? 'PASS' : 'FAIL');
            if (sizeName === 'tablet') await p.screenshot({ path: path.join(SHOTS, 'flow-queue-cards.png'), fullPage: true });
        } catch (e) { rec(U, `queue cards: ${sizeName}`, 'FAIL', e.message.split('\n')[0]); } finally { await context.close(); }
    }
}

// The top bar controls on the right (Quick find, the colour mode switch, GitHub) are all the same height, on a desktop
// and on a phone (where the switch collapses to one cycle button and GitHub is hidden).
async function navBarButtons(browser, U) {
    for (const [sizeName, viewport] of [['desktop', { width: 1280, height: 800 }], ['phone', VIEWPORTS[1][1]]]) {
        const context = await browser.newContext({ viewport });
        try {
            const p = await context.newPage();
            await p.goto(BASE + '/browse', { waitUntil: 'networkidle', timeout: 45000 });
            const heights = await p.evaluate(() => [...document.querySelectorAll('.NavBar .right .navIconButton, .NavBar .right .segments, .NavBar .right .cycle, .NavBar .right a[aria-label="GitHub"]')]
                .filter((e) => e.offsetParent)
                .map((e) => [e.className || e.getAttribute('aria-label'), Math.round(e.getBoundingClientRect().height)]));
            const label = `nav bar buttons: the right-hand controls are one height on a ${sizeName}`;
            if (heights.length < 2) { rec(U, label, 'SKIP', `${heights.length} control(s)`); continue; }
            const same = new Set(heights.map(([, h]) => h)).size === 1;
            rec(U, label, same ? 'PASS' : 'FAIL', heights.map(([n, h]) => `${n}=${h}`).join(', '));
        } catch (e) { rec(U, `nav bar buttons: ${sizeName}`, 'FAIL', e.message.split('\n')[0]); } finally { await context.close(); }
    }
}

// ---------------------------------------------------------------- main
(async () => {
    console.log(`iPlayarr smoke: ${BASE}  groups=${[...new Set(ONLY)].join(',')}  write=${WRITE}${FILTER ? `  filter=${FILTER}` : ''}\n`);
    const ctx = { want };
    // The read-only API layer also discovers the pids, channels and config every other group uses. When only write
    // groups were asked for, run it silently for that.
    if (['api', 'ui', ...WRITE_GROUPS].some((g) => ONLY.includes(g))) {
        muted = !ONLY.includes('api') && !ONLY.includes('ui');
        await apiLayer(ctx);
        muted = false;
    }
    if (['real', 'settings', 'probes'].some((g) => ONLY.includes(g))) {
        ctx.preLiveBbcFour = ((await http('/json-api/subscriptions/live')).json || []).some((s) => s.channelId === 'bbc_four');
        if (ONLY.includes('real')) await require('./reallife.cjs')(ctx, { http, rec, BASE, check });
        if (ONLY.includes('settings')) await require('./settings.cjs')(ctx, { http, rec, BASE });
        if (ONLY.includes('probes')) await require('./probes.cjs').write(ctx, { http, rec, BASE });
    }
    if (ONLY.includes('fs')) fsLayer(ctx);
    if (ONLY.includes('ui') || ONLY.includes('uireal')) await uiLayer(ctx);
    const c = (s) => results.filter((r) => r.status === s).length;
    console.log(`\n==== ${c('PASS')} pass, ${c('FAIL')} fail, ${c('WARN')} warn, ${c('SKIP')} skip ====`);
    for (const r of results.filter((r) => r.status === 'FAIL')) console.log(`FAIL [${r.area}] ${r.name}: ${r.detail}`);
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    process.exit(c('FAIL') ? 1 : 0);
})();
