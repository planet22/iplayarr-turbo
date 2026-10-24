#!/usr/bin/env node
/* iPlayarr smoke test: API layer, UI layer (Playwright), filesystem layer.
 *
 *   node smoke/smoke.cjs [--base URL] [--only api,ui,fs] [--write] [--phone-only] [--shots DIR]
 *
 * Default is READ-ONLY against the running instance. --write adds a reversible
 * round-trip layer (clearly marked SMOKE-TEMP entries, removed afterwards).
 * Env: SMOKE_BASE (instance URL), SMOKE_MEDIA_ROOT (library folder, enables the fs layer),
 * SMOKE_PW_DIR (a node_modules folder with playwright; it is not a project dependency, so
 * `npm i playwright` outside the repo and point this at it). Exit code 1 if any check FAILs.
 * --write is DESTRUCTIVE: use a dev instance only.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const BASE = String(opt('base', process.env.SMOKE_BASE || 'http://localhost:4404')).replace(/\/$/, '');
const ONLY = String(opt('only', 'api,ui,fs')).split(',');
const WRITE = !!opt('write', false);
const PHONE_ONLY = !!opt('phone-only', false);
const SHOTS = String(opt('shots', path.resolve(__dirname, '..', '.claude', 'shots', 'smoke')));
const MEDIA_ROOT = process.env.SMOKE_MEDIA_ROOT || ''; // library folder holding .strm files; unset skips the fs layer
const PW_DIR = process.env.SMOKE_PW_DIR || ''; // node_modules folder with playwright, when it is not installed locally

const results = [];
const rec = (area, name, status, detail = '') => {
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
    const firstItem = (home.json || []).flatMap((r) => r.items || [])[0];
    ctx.pid = firstItem?.pid;
    rec(A, 'browse home has items', ctx.pid ? 'PASS' : 'FAIL', ctx.pid ? 'pid ' + ctx.pid : 'empty');
    const chans = await check(A, 'browse channels', '/json-api/browse/channels', isArr);
    ctx.channel = (chans.json || [])[0]?.id;
    const cats = await check(A, 'browse categories', '/json-api/browse/categories', isJson);
    ctx.category = (Array.isArray(cats.json) ? cats.json : cats.json?.categories || [])[0]?.id;
    await check(A, 'browse suggest', '/json-api/browse/suggest?q=doc', isJson);
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
    for (const term of ['doctor', 'traitors', 'strictly', 'bake off'])
        await check(A, `manual search "${term}" returns results`, `/json-api/search?q=${encodeURIComponent(term)}`, (r) => (Array.isArray(r.json) && r.json.length > 0) || `0 results with manual settings ${JSON.stringify(ctx.manualSettings)} - manual and NZB search have independent settings, so only suspicious if these settings should match`, { timeout: 90000, warnOnly: true });
    await check(A, 'browse bad pid rejected', '/json-api/browse/programme/!!bad', (r) => r.status === 400 || `HTTP ${r.status}`);

    // Native stream (HLS master from BBC; upstream-dependent so WARN not FAIL)
    if (ctx.pid && streamkey)
        await check(A, 'stream master playlist (native)', `/api?mode=stream&pid=${ctx.pid}&streamkey=${streamkey}`, (r) => /#EXTM3U/.test(r.text) || 'no HLS', { warnOnly: true, timeout: 60000 });

    // App state endpoints
    await check(A, 'versions (get_iplayer/yt-dlp)', '/json-api/versions', (r) => !!r.json?.getIplayer || 'no getIplayer');
    await check(A, 'uptime', '/json-api/stats/uptime', (r) => typeof r.json?.uptime === 'number' || 'no uptime');
    await check(A, 'cacheSizes', '/json-api/stats/cacheSizes', isJson);
    await check(A, 'searchHistory', '/json-api/stats/searchHistory', isJson);
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
    await check(A, 'live subscriptions', '/json-api/subscriptions/live', isArr);
    await check(A, 'subscription arr apps', '/json-api/subscriptions/arr/apps', isArr);
    await check(A, 'maintenance tasks', '/json-api/maintenance/tasks', isArr);
    await check(A, 'maintenance caches', '/json-api/maintenance/caches', isArr);
    const wd = await check(A, 'watchdog state', '/json-api/watchdog', (r) => typeof r.json?.enabled === 'boolean' || 'no enabled flag');
    ctx.wd = wd.json;
    if (ctx.wd?.enabled) await check(A, 'watchdog path-map access', '/json-api/watchdog/check-access', isJson, { method: 'POST', warnOnly: true, timeout: 180000 });

    // Per-app connectivity (uses stored masked keys; read-only test call)
    const apps = (await http('/json-api/apps')).json || [];
    for (const a of apps) {
        const t = await http('/json-api/apps/test', { method: 'POST', body: a, timeout: 20000 });
        rec(A, `app "${a.name}" (${a.type}) reachable`, t.status === 200 ? 'PASS' : 'WARN', `HTTP ${t.status} ${t.text.slice(0, 80)}`);
    }

    // CSRF/cross-site guard sanity: a state-changing call from a foreign origin must not succeed
    const csrf = await http('/json-api/synonym', { method: 'POST', body: { from: 'x', target: 'y' }, headers: { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' } });
    rec(A, 'cross-site POST blocked', csrf.status === 403 || csrf.status === 401 ? 'PASS' : 'WARN', `HTTP ${csrf.status} (AUTH none may bypass)`);
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
    ['/subscriptions', 'Subscriptions', []],
    ['/synonyms', 'Synonyms', []],
    ['/offSchedule', 'Off schedule', []],
    ['/apps', 'Apps', []],
    ['/stats', 'Statistics', []],
    ['/streaming', 'Streaming', []],
    ['/events', 'Video events', []],
    ['/watchdog', 'Watchdog', []],
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
        for (const [vpName, vp] of VIEWPORTS) {
            if (PHONE_ONLY && vpName !== 'phone') continue;
            const context = await browser.newContext({ viewport: vp, isMobile: vpName === 'phone', hasTouch: vpName === 'phone' });
            for (const [tpl, label, expects] of ROUTES) {
                const route = tpl.replace('{channel}', ctx.channel || 'bbc_one_london').replace('{category}', ctx.category || 'comedy').replace('{pid}', ctx.pid || '').replace('{item}', encodeURIComponent(JSON.stringify({ pid: ctx.pid || 'm000smoke', title: 'SMOKE item' })));
                if (route.endsWith('/') || route.includes('//')) { rec(U, `${label} @${vpName}`, 'SKIP', 'no id discovered'); continue; }
                const page = await context.newPage();
                const problems = [];
                page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
                page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver/.test(m.text())) problems.push('console: ' + m.text().slice(0, 120)); });
                page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && u.startsWith(BASE) && !/favicon/.test(u)) problems.push(`${r.status()} ${u.replace(BASE, '')}`); });
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
        await uiInteractions(browser, ctx);
        if (WRITE) await require('./uireal.cjs')(browser, ctx, { http, rec, BASE, SHOTS });
    } finally { await browser.close(); }
}

async function uiInteractions(browser, ctx) {
    const U = 'ui-flow';
    const context = await browser.newContext({ viewport: VIEWPORTS[0][1] });
    const page = await context.newPage();
    const bad = [];
    page.on('pageerror', (e) => bad.push(e.message));
    // Search flow: type, results render, no error
    try {
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
    try {
        await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
        const tabs = page.locator('.settingsTab');
        const count = await tabs.count();
        let visited = 0;
        for (let i = 0; i < count && i < 12; i++) { try { await tabs.nth(i).click({ timeout: 2000 }); await page.waitForTimeout(250); visited++; } catch { /* non-tab link */ } }
        rec(U, 'settings tabs all clickable', count >= 7 && visited === count ? 'PASS' : 'FAIL', `${visited}/${count}`);
        rec(U, 'settings save bar clean (not dirty) after only navigating', (await page.locator('.settingsTab.dirty').count()) === 0 ? 'PASS' : 'FAIL');
        await page.screenshot({ path: path.join(SHOTS, 'flow-settings.png'), fullPage: true });
    } catch (e) { rec(U, 'settings tabs', 'FAIL', e.message.split('\n')[0]); }
    // Programme page: play/download controls exist
    if (ctx.pid) {
        try {
            await page.goto(`${BASE}/browse/programme/${ctx.pid}`, { waitUntil: 'networkidle' });
            const btns = await page.locator('button').count();
            rec(U, 'programme page has action buttons', btns > 0 ? 'PASS' : 'FAIL', `${btns} buttons`);
        } catch (e) { rec(U, 'programme page', 'FAIL', e.message.split('\n')[0]); }
    }
    // Realtime: socket.io handshake succeeds
    const sock = await http('/socket.io/?EIO=4&transport=polling');
    rec(U, 'socket.io handshake', sock.status === 200 && /sid/.test(sock.text) ? 'PASS' : 'FAIL', `HTTP ${sock.status}`);
    rec(U, 'no uncaught page errors during flows', bad.length ? 'FAIL' : 'PASS', bad.slice(0, 2).join(' | '));
    await context.close();
}

// ---------------------------------------------------------------- main
(async () => {
    console.log(`iPlayarr smoke: ${BASE}  layers=${ONLY.join(',')}  write=${WRITE}\n`);
    const ctx = {};
    if (ONLY.includes('api') || ONLY.includes('ui')) await apiLayer(ctx);
    if (WRITE && ONLY.includes('api')) {
        ctx.preLiveBbcFour = ((await http('/json-api/subscriptions/live')).json || []).some((s) => s.channelId === 'bbc_four');
        await require('./reallife.cjs')(ctx, { http, rec, BASE, check });
    }
    if (ONLY.includes('fs')) fsLayer(ctx);
    if (ONLY.includes('ui')) await uiLayer(ctx);
    const c = (s) => results.filter((r) => r.status === s).length;
    console.log(`\n==== ${c('PASS')} pass, ${c('FAIL')} fail, ${c('WARN')} warn, ${c('SKIP')} skip ====`);
    for (const r of results.filter((r) => r.status === 'FAIL')) console.log(`FAIL [${r.area}] ${r.name}: ${r.detail}`);
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, 'report.json'), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
    process.exit(c('FAIL') ? 1 : 0);
})();
