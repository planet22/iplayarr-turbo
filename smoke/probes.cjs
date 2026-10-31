/* Bug-hunting probes. Two layers:
 *   readOnly(ctx, h)  - safe on any instance: data quality of what Sonarr/Radarr/Jellyfin consume, response hygiene,
 *                       key separation, hostile input to read endpoints.
 *   write(ctx, h)     - --write only, DEV INSTANCES ONLY: hostile and boundary input to the endpoints that store things,
 *                       config races and unvalidated values. Everything it creates is named SMOKE-TEMP and removed again.
 * A FAIL is a defect or a security gap; a WARN is something that looks wrong but may be a deliberate choice.
 */
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STACK = /\n\s+at\s+\S+.*:\d+:\d+|node_modules|\/app\/(src|dist)|src\/(routes|service|endpoints|facade)\/|[A-Za-z]:\\\\?Users|\bECONN|\bENOENT\b|SQLITE_|PrismaClient/;
const BAD_XML_AMP = /&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i;
const LEAKY_TOKENS = /\bundefined\b|\bNaN\b|\[object Object\]/;

function helpers({ http, rec, BASE }) {
    const raw = async (p, { method = 'GET', headers = {}, body, timeout = 30000 } = {}) => {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), timeout);
        try {
            const r = await fetch(BASE + p, { method, headers, body, signal: ctl.signal, redirect: 'manual' });
            const text = await r.text();
            let json; try { json = JSON.parse(text); } catch { /* not json */ }
            return { status: r.status, headers: r.headers, text, json };
        } catch (e) { return { status: 0, headers: new Headers(), text: '', error: e.name === 'AbortError' ? 'timeout' : e.message }; }
        finally { clearTimeout(t); }
    };
    // A request must answer, must not crash the handler (5xx), and must not leak internals.
    const survives = (area, name, r, { allow = (s) => s < 500 } = {}) => {
        if (r.status === 0) return rec(area, name, 'FAIL', `no answer (${r.error})`);
        if (!allow(r.status)) return rec(area, name, 'FAIL', `HTTP ${r.status} ${String(r.text).slice(0, 120)}`);
        if (STACK.test(r.text || '')) return rec(area, name, 'FAIL', `HTTP ${r.status} leaks internals: ${(r.text.match(STACK) || [''])[0]}`);
        rec(area, name, 'PASS');
    };
    const items = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const f = (tag) => (new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(m[1]) || [])[1];
        return { title: f('title'), guid: f('guid'), link: f('link'), pubDate: f('pubDate'), size: f('size'), enclosure: (/<enclosure url="([^"]*)" length="([^"]*)"/.exec(m[1]) || []).slice(1), raw: m[1] };
    });
    return { raw, survives, items };
}

// ------------------------------------------------------------------------------------------------- read-only
async function readOnly(ctx, h) {
    const { http, rec } = h;
    const { raw, survives, items } = helpers(h);
    const cfg = ctx.cfg || {};
    const apikey = encodeURIComponent(cfg.API_KEY || ''), streamkey = encodeURIComponent(cfg.STREAM_KEY || '');
    const P = 'probe';

    // 1. What Sonarr/Radarr receive: the RSS must be sound, unique and filterable
    for (const [t, q] of [['tvsearch', 'horizon'], ['search', 'newsnight'], ['movie', 'wallace']]) {
        const r = await raw(`/api?t=${t}&q=${q}&apikey=${apikey}`, { timeout: 90000 });
        survives(P, `newznab ${t} "${q}" answers cleanly`, r);
        const xml = r.text || '';
        rec(P, `newznab ${t} "${q}" is well-formed RSS`, /^<\?xml/.test(xml) && /<\/rss>\s*$/.test(xml) && !BAD_XML_AMP.test(xml) ? 'PASS' : 'FAIL', BAD_XML_AMP.test(xml) ? `unescaped &: ...${(xml.match(new RegExp(`.{20}${BAD_XML_AMP.source}.{10}`)) || [''])[0]}` : 'not a closed <rss> document');
        const list = items(xml);
        if (!list.length) { rec(P, `newznab ${t} "${q}" items`, 'SKIP', 'no results'); continue; }
        const leaks = list.filter((i) => LEAKY_TOKENS.test(i.raw.replace(/<description>[\s\S]*?<\/description>/, '')));
        rec(P, `newznab ${t} "${q}" items carry no undefined/NaN/[object Object]`, leaks.length ? 'FAIL' : 'PASS', leaks[0]?.title);
        const badNames = list.filter((i) => !/^[A-Za-z0-9._-]+$/.test(i.title || '') || /\.\./.test(i.title) || /^\.|\.$/.test(i.title));
        rec(P, `newznab ${t} "${q}" release names are clean (letters, digits . _ - only, no "..")`, badNames.length ? 'FAIL' : 'PASS', badNames.slice(0, 2).map((i) => i.title).join(' | '));
        const guids = list.map((i) => i.guid);
        rec(P, `newznab ${t} "${q}" guids are unique`, new Set(guids).size === guids.length ? 'PASS' : 'FAIL', `${guids.length - new Set(guids).size} duplicate(s)`);
        const titles = list.map((i) => i.title);
        rec(P, `newznab ${t} "${q}" release names are unique`, new Set(titles).size === titles.length ? 'PASS' : 'WARN', `${titles.length - new Set(titles).size} duplicate name(s): *arr treats them as the same release`);
        const badSize = list.filter((i) => !(Number(i.size) > 0) || !(Number(i.enclosure[1]) > 0));
        rec(P, `newznab ${t} "${q}" sizes are positive numbers`, badSize.length ? 'FAIL' : 'PASS', badSize[0]?.title);
        const badDate = list.filter((i) => Number.isNaN(Date.parse(i.pubDate || '')));
        rec(P, `newznab ${t} "${q}" pubDates parse`, badDate.length ? 'FAIL' : 'PASS', badDate[0]?.pubDate);
        const mismatch = list.filter((i) => (i.enclosure[0] || '').replace(/&amp;/g, '&') !== (i.link || '').replace(/&amp;/g, '&'));
        rec(P, `newznab ${t} "${q}" link and enclosure agree`, mismatch.length ? 'FAIL' : 'PASS', mismatch[0]?.title);
        const pidMismatch = list.filter((i) => { const lp = /[?&]pid=([^&]+)/.exec((i.link || '').replace(/&amp;/g, '&'))?.[1]; return !lp || !(i.guid || '').includes(lp); });
        rec(P, `newznab ${t} "${q}" the download link points at the same programme as the guid`, pidMismatch.length ? 'FAIL' : 'PASS', pidMismatch[0]?.title);
        if (t === 'tvsearch') {
            const noEp = list.filter((i) => !/S\d{2,}E\d{2,}/.test(i.title));
            rec(P, 'newznab tvsearch release names carry SxxEyy', noEp.length ? 'WARN' : 'PASS', `${noEp.length}/${list.length}, e.g. ${noEp[0]?.title}`);
            // Season/episode filter: asking for one episode returns only that episode
            const pick = list.map((i) => /S(\d{2,})E(\d{2,})/.exec(i.title)).find((m) => m && Number(m[1]) > 0 && Number(m[2]) > 0);
            if (pick) {
                const f = await raw(`/api?t=tvsearch&q=${q}&season=${Number(pick[1])}&ep=${Number(pick[2])}&apikey=${apikey}`, { timeout: 90000 });
                const got = items(f.text || '').map((i) => i.title);
                const wrong = got.filter((n) => !new RegExp(`S0*${Number(pick[1])}E0*${Number(pick[2])}\\b`, 'i').test(n));
                rec(P, `tvsearch season=${Number(pick[1])}&ep=${Number(pick[2])} returns only that episode`, got.length && !wrong.length ? 'PASS' : 'FAIL', got.length ? `wrong: ${wrong.slice(0, 2).join(' | ')}` : 'returned nothing although the unfiltered search had it');
            }
            const again = items((await raw(`/api?t=tvsearch&q=${q}&apikey=${apikey}`, { timeout: 90000 })).text || '').map((i) => i.guid);
            rec(P, 'newznab tvsearch is repeatable (same releases, same order, second call)', JSON.stringify(again) === JSON.stringify(guids) ? 'PASS' : 'WARN', `${guids.length} then ${again.length} items`);
            const hist = (await http('/json-api/stats/searchHistory')).json;
            const last = (Array.isArray(hist) ? hist : []).find((e) => e.term === q);
            rec(P, 'the search is recorded in the search history with the right result count', last && last.results === guids.length ? 'PASS' : 'WARN', last ? `recorded ${last.results}, returned ${guids.length}` : 'not recorded');
        }
    }
    const caps = await raw(`/api?t=caps&apikey=${apikey}`);
    rec(P, 'newznab caps is well-formed and lists TV and movie categories', /<caps/.test(caps.text) && /5000|TV/i.test(caps.text) && /2000|Movies/i.test(caps.text) && !BAD_XML_AMP.test(caps.text) ? 'PASS' : 'FAIL', caps.text.slice(0, 120));

    // 2. Parameter pollution and odd values must not crash handlers (a duplicated or nested parameter arrives as an array/object)
    const odd = [
        `/api?t=search&q=a&q=b&apikey=${apikey}`, `/api?t=search&q[x]=1&apikey=${apikey}`, `/api?t=tvsearch&q=doctor&season[]=1&apikey=${apikey}`,
        `/api?t=search&t=caps&apikey=${apikey}`, `/api?t=search&q=a&apikey=${apikey}&apikey=x`, `/api?mode=queue&mode=history&apikey=${apikey}&output=json`,
        `/api?t=tvsearch&q=doctor&season=-1&ep=abc&apikey=${apikey}`, `/api?t=tvsearch&q=doctor&season=99999999999999999999&apikey=${apikey}`,
        `/api?t=search&q=a&cat=abc,,&limit=-1&offset=zzz&apikey=${apikey}`, `/api?t=tvsearch&apikey=${apikey}`, `/api?t=&apikey=${apikey}`, `/api?mode=&apikey=${apikey}`,
        `/api?t=search&q=${encodeURIComponent('%')}&apikey=${apikey}`, `/api?t=search&q=%FF%FE&apikey=${apikey}`,
        '/json-api/search?q=a&q=b', '/json-api/search?q[x]=1', '/json-api/search/stream?q=a&q=b', '/json-api/browse/suggest?q=a&q=b', '/json-api/browse/suggest?q[x]=1',
        '/json-api/browse/details?pids=a&pids=b', '/json-api/browse/details?pids[]=a', '/json-api/browse/versions?pids=', '/json-api/browse/atoz/%00', '/json-api/browse/atoz/ab',
        '/json-api/queue/queue?pid=a&pid=b', '/json-api/download?pid=a&pid=b', '/json-api/download?pid[x]=1',
    ];
    for (const p of odd) survives(P, `odd input handled: ${p.replace(/apikey=[^&]+/, 'apikey=***').slice(0, 90)}`, await raw(p, { timeout: 60000 }));

    // 3. Hostile identifiers on every endpoint that takes a path segment or pid
    const nasty = ['../../etc/passwd', '..%2f..%2fetc%2fpasswd', '%00', 'a'.repeat(5000), '<script>alert(1)</script>', "' OR 1=1 --", '%E2%98%83', 'm0030pxt/../../x', 'CON', '..\\..\\windows\\win.ini'];
    const targets = [
        (x) => `/json-api/browse/programme/${x}`, (x) => `/json-api/browse/markers/${x}`, (x) => `/json-api/thumbnail/pid/${x}`, (x) => `/json-api/browse/channel/${x}`,
        (x) => `/json-api/browse/category/${x}`, (x) => `/json-api/browse/category/${x}/rails`, (x) => `/json-api/live-channels/logo/${x}`, (x) => `/json-api/browse/channel-logo/${x}.svg`,
        (x) => `/api?mode=stream&pid=${x}&streamkey=${streamkey}`, (x) => `/api?mode=live_logo&channel=${x}&streamkey=${streamkey}`, (x) => `/api?mode=live_thumb&pid=${x}&streamkey=${streamkey}`,
        (x) => `/json-api/download?pid=${x}`, (x) => `/api/${x}?mode=stream&pid=m0030pxt&streamkey=${streamkey}`,
    ];
    let bad = 0, total = 0;
    for (const mk of targets) for (const n of nasty) {
        const enc = /%/.test(n) ? n : encodeURIComponent(n);
        const r = await raw(mk(enc), { timeout: 30000 });
        total++;
        const leaked = /root:.*:0:0|\[fonts\]|\[extensions\]/.test(r.text || '');
        if (r.status === 0 || r.status >= 500 || STACK.test(r.text || '') || leaked) { bad++; rec(P, `hostile id ${n.slice(0, 20)} on ${mk('X').split('?')[0].replace(/\/X.*/, '/…')}`, 'FAIL', leaked ? 'returned a system file' : `HTTP ${r.status} ${r.error || (r.text || '').slice(0, 100)}`); }
    }
    rec(P, `hostile ids never crash a handler, leak internals or read files (${total} requests)`, bad ? 'FAIL' : 'PASS', `${bad} bad`);

    // 4. Keys are not interchangeable: the stream key must not buy a download, the API key must not buy a stream
    const pid = ctx.pid || 'm0030pxt';
    const sep = [
        ['stream with the API key instead of the stream key', `/api?mode=stream&pid=${pid}&apikey=${apikey}`],
        ['live playlist with the API key', `/api?mode=live_playlist&apikey=${apikey}`],
        ['live EPG with the API key', `/api?mode=live_epg&apikey=${apikey}`],
        ['live logo with the API key', `/api?mode=live_logo&channel=bbc_one&apikey=${apikey}`],
        ['NZB download with the stream key', `/api?mode=nzb-download&pid=${pid}&nzbName=x&type=TV&apikey=${streamkey}`],
        ['SAB queue with the stream key', `/api?mode=queue&apikey=${streamkey}&output=json`],
        ['Newznab search with the stream key', `/api?t=search&q=a&apikey=${streamkey}`],
        ['stream with no key', `/api?mode=stream&pid=${pid}`],
        ['stream with an empty key', `/api?mode=stream&pid=${pid}&streamkey=`],
    ];
    for (const [name, p] of sep) { const r = await raw(p); rec(P, `${name} is refused`, r.status === 401 || r.status === 403 ? 'PASS' : 'FAIL', `HTTP ${r.status} ${r.text.slice(0, 80)}`); }

    // 5. Response hygiene
    const a = await raw('/json-api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{bad json' });
    survives(P, 'malformed JSON body gets a clean 4xx, not a stack trace', a, { allow: (s) => s >= 400 && s < 500 });
    const b = await raw('/json-api/config', { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: '{"DEBUG":"false"}' });
    survives(P, 'JSON sent as text/plain is refused or ignored, never a 5xx', b);
    const big = await raw('/json-api/synonym', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'x'.repeat(8 * 1024 * 1024) }), timeout: 60000 });
    rec(P, 'an 8 MB body is rejected (413/400), not processed', big.status === 413 || big.status === 400 ? 'PASS' : big.status === 0 ? 'WARN' : 'FAIL', `HTTP ${big.status} ${big.error || ''}`);
    for (const m of ['PUT', 'DELETE', 'PATCH']) survives(P, `${m} /api is handled`, await raw(`/api?mode=queue&apikey=${apikey}`, { method: m }));
    const unknown = await raw('/json-api/does-not-exist');
    rec(P, 'unknown /json-api path answers JSON 404 without internals', unknown.status === 404 && !STACK.test(unknown.text) && !/<pre>|<html/i.test(unknown.text) ? 'PASS' : 'WARN', `HTTP ${unknown.status} ${unknown.text.slice(0, 80)}`);
    const cors = await raw('/json-api/config', { headers: { origin: 'http://evil.example' } });
    const acao = cors.headers.get('access-control-allow-origin');
    rec(P, 'the config API does not allow cross-origin reads (no CORS for a foreign Origin)', !acao || (acao !== '*' && acao !== 'http://evil.example') ? 'PASS' : 'FAIL', `access-control-allow-origin: ${acao}`);
    const pre = await raw('/json-api/config', { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'PUT' } });
    rec(P, 'a cross-origin preflight for PUT /json-api/config is not approved', !/PUT/i.test(pre.headers.get('access-control-allow-methods') || '') && pre.headers.get('access-control-allow-origin') !== 'http://evil.example' ? 'PASS' : 'FAIL', `${pre.status} ${pre.headers.get('access-control-allow-origin')} ${pre.headers.get('access-control-allow-methods')}`);
    const home = await raw('/');
    rec(P, 'X-Powered-By is not advertised', home.headers.get('x-powered-by') ? 'WARN' : 'PASS', home.headers.get('x-powered-by'));
    rec(P, 'X-Content-Type-Options: nosniff on the app shell', /nosniff/i.test(home.headers.get('x-content-type-options') || '') ? 'PASS' : 'WARN', home.headers.get('x-content-type-options'));
    rec(P, 'the app shell cannot be framed (X-Frame-Options or CSP frame-ancestors)', home.headers.get('x-frame-options') || /frame-ancestors/i.test(home.headers.get('content-security-policy') || '') ? 'PASS' : 'WARN', 'neither header present');

    // 6. NZB output must stay valid XML whatever it is asked to name
    const nzb = await raw(`/api?mode=nzb-download&pid=${pid}&nzbName=${encodeURIComponent('</nzb><injected attr="1"/>&x"\'')}&type=TV&apikey=${apikey}&title=${encodeURIComponent('<b>&')}`);
    rec(P, 'nzb-download escapes a hostile name (no injected element, no bare &)', nzb.status === 200 && !/<injected/.test(nzb.text) && !BAD_XML_AMP.test(nzb.text) ? 'PASS' : 'FAIL', `HTTP ${nzb.status} ${nzb.text.slice(0, 160)}`);
    const nzbBad = await raw(`/api?mode=nzb-download&pid=${encodeURIComponent('../../x')}&nzbName=x&type=TV&apikey=${apikey}`);
    rec(P, 'nzb-download refuses a path-like programme id', nzbBad.status >= 400 ? 'PASS' : 'FAIL', `HTTP ${nzbBad.status} ${nzbBad.text.slice(0, 100)}`);
    const nzbType = await raw(`/api?mode=nzb-download&pid=${pid}&nzbName=x&type=BANANA&apikey=${apikey}`);
    rec(P, 'nzb-download refuses or normalises an unknown type', nzbType.status >= 400 || !/BANANA/.test(nzbType.text) ? 'PASS' : 'WARN', `HTTP ${nzbType.status}: the unknown type is passed on to the queue`);

    // 7. SAB responses: shape, no leaks
    const sab = {};
    for (const m of ['queue', 'history', 'version', 'get_config']) {
        sab[m] = await raw(`/api?mode=${m}&apikey=${apikey}&output=json`);
        rec(P, `SAB ${m} carries no undefined/NaN/[object Object]`, LEAKY_TOKENS.test(JSON.stringify(sab[m].json ?? sab[m].text)) ? 'FAIL' : 'PASS', JSON.stringify(sab[m].json ?? '').match(/.{30}(undefined|NaN|\[object Object\]).{10}/)?.[0]);
    }
    const slots = sab.history.json?.history?.slots || [];
    const slotBad = slots.filter((s) => typeof s.name !== 'string' || typeof s.status !== 'string' || !s.nzo_id || !('storage' in s));
    rec(P, 'SAB history slots have name, status, nzo_id and storage (what Sonarr imports from)', slotBad.length ? 'FAIL' : 'PASS', JSON.stringify(slotBad[0] || {}).slice(0, 160));
    const qslots = sab.queue.json?.queue?.slots || [];
    const qBad = qslots.filter((s) => !s.nzo_id || typeof s.filename !== 'string' || Number.isNaN(Number(s.percentage)));
    rec(P, 'SAB queue slots have nzo_id, filename and a numeric percentage', qBad.length ? 'FAIL' : 'PASS', JSON.stringify(qBad[0] || {}).slice(0, 160));
    for (const m of ['queue&name=delete&value=SMOKE-NOPE', 'history&name=delete&value=SMOKE-NOPE', 'history&name=delete', 'queue&name=nope', 'addfile', 'addurl&name=http://169.254.169.254/', 'get_files', 'qstatus', 'fullstatus', 'switch', 'pause', 'resume'])
        survives(P, `SAB mode=${m} is handled`, await raw(`/api?mode=${m}&apikey=${apikey}&output=json`));
    const form = new FormData();
    form.append('name', new Blob(['this is not an nzb'], { type: 'application/x-nzb' }), 'SMOKE-TEMP.nzb');
    const garbage = await fetch(`${h.BASE}/api?mode=addfile&apikey=${cfg.API_KEY}&output=json`, { method: 'POST', body: form }).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: '', error: e.message }));
    rec(P, 'SAB addfile refuses a file that is not an NZB', garbage.status >= 400 || /"status"\s*:\s*false/.test(garbage.text) ? 'PASS' : 'FAIL', `HTTP ${garbage.status} ${garbage.text.slice(0, 100)}`);
    const real = await raw(`/api?mode=nzb-download&pid=${pid}&nzbName=SMOKE-TEMP&type=TV&apikey=${apikey}`);
    if (real.status === 200) {
        const evil = real.text.replace(new RegExp(pid, 'g'), '../../x');
        const f2 = new FormData();
        f2.append('name', new Blob([evil], { type: 'application/x-nzb' }), 'SMOKE-TEMP.nzb');
        const r2 = await fetch(`${h.BASE}/api?mode=addfile&apikey=${cfg.API_KEY}&output=json`, { method: 'POST', body: f2 }).then(async (r) => ({ status: r.status, text: await r.text() })).catch((e) => ({ status: 0, text: '', error: e.message }));
        rec(P, 'SAB addfile refuses an NZB whose programme id is a path', r2.status >= 400 || /"status"\s*:\s*false/.test(r2.text) ? 'PASS' : 'FAIL', `HTTP ${r2.status} ${r2.text.slice(0, 100)}`);
    }

    // 8. Live TV outputs Jellyfin parses strictly
    const live = cfg.LIVE_TV_ENABLED === 'true' && cfg.STREAM_KEY;
    if (live) {
        const pl = (await raw(`/api?mode=live_playlist&streamkey=${streamkey}`, { timeout: 60000 })).text;
        const lines = pl.split('\n').filter(Boolean);
        const extinf = lines.filter((l) => l.startsWith('#EXTINF'));
        const badExt = extinf.filter((l) => !/^#EXTINF:-1( [\w-]+="[^"]*")+,[^\n]+$/.test(l));
        rec(P, 'playlist: every #EXTINF line is well-formed (quoted attributes, a name)', badExt.length ? 'FAIL' : 'PASS', badExt[0]);
        const orphan = lines.some((l, i) => l.startsWith('#EXTINF') && (!lines[i + 1] || lines[i + 1].startsWith('#')));
        rec(P, 'playlist: every #EXTINF is followed by a stream URL', orphan ? 'FAIL' : 'PASS');
        const ids = extinf.map((l) => /tvg-id="([^"]*)"/.exec(l)?.[1]), nos = extinf.map((l) => /tvg-chno="([^"]*)"/.exec(l)?.[1]);
        rec(P, 'playlist: channel ids are unique', new Set(ids).size === ids.length ? 'PASS' : 'FAIL', ids.join(','));
        rec(P, 'playlist: channel numbers are unique whole numbers', new Set(nos).size === nos.length && nos.every((n) => /^\d+$/.test(n)) ? 'PASS' : 'FAIL', nos.join(','));
        const urls = lines.filter((l) => !l.startsWith('#'));
        rec(P, 'playlist: stream URLs are absolute, keyed, and have no doubled slashes after the host', urls.every((u) => /^https?:\/\/[^/]+\/api\//.test(u) && /streamkey=/.test(u)) ? 'PASS' : 'FAIL', urls.find((u) => !/^https?:\/\/[^/]+\/api\//.test(u) || !/streamkey=/.test(u)));
        const xml = (await raw(`/api?mode=live_epg&streamkey=${streamkey}`, { timeout: 180000 })).text;
        rec(P, 'EPG: is closed XMLTV with no bare &', /^<\?xml/.test(xml) && /<\/tv>\s*$/.test(xml) && !BAD_XML_AMP.test(xml) ? 'PASS' : 'FAIL', (xml.match(new RegExp(`.{20}${BAD_XML_AMP.source}.{10}`)) || [''])[0]);
        const progs = [...xml.matchAll(/<programme start="([^"]+)" stop="([^"]+)" channel="([^"]*)">/g)];
        rec(P, 'EPG: has programmes', progs.length ? 'PASS' : 'WARN', 'empty guide');
        const parse = (s) => { const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d) ([+-])(\d\d)(\d\d)$/.exec(s); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - (m[7] === '-' ? -1 : 1) * (+m[8] * 60 + +m[9]) * 60000 : NaN; };
        const malformed = progs.filter((p) => Number.isNaN(parse(p[1])) || Number.isNaN(parse(p[2])));
        rec(P, 'EPG: every start/stop is a valid XMLTV time', malformed.length ? 'FAIL' : 'PASS', malformed[0]?.[0]);
        const backwards = progs.filter((p) => parse(p[2]) <= parse(p[1]));
        rec(P, 'EPG: every programme ends after it starts', backwards.length ? 'FAIL' : 'PASS', backwards[0]?.[0]);
        const chans = new Set([...xml.matchAll(/<channel id="([^"]*)">/g)].map((m) => m[1]));
        const dangling = progs.filter((p) => !chans.has(p[3]));
        rec(P, 'EPG: every programme belongs to a listed channel', dangling.length ? 'FAIL' : 'PASS', dangling[0]?.[3]);
        const seen = new Set(); let dup = 0;
        for (const p of progs) { const k = `${p[3]}|${p[1]}`; if (seen.has(k)) dup++; seen.add(k); }
        rec(P, 'EPG: no channel has two programmes starting at the same time', dup ? 'FAIL' : 'PASS', `${dup} duplicate(s)`);
        const byChan = {};
        for (const p of progs) (byChan[p[3]] ||= []).push([parse(p[1]), parse(p[2])]);
        let overlaps = 0;
        for (const list of Object.values(byChan)) { list.sort((x, y) => x[0] - y[0]); for (let i = 1; i < list.length; i++) if (list[i][0] < list[i - 1][1]) overlaps++; }
        rec(P, 'EPG: programmes on one channel do not overlap', overlaps ? 'WARN' : 'PASS', `${overlaps} overlap(s): Jellyfin shows the later one over the earlier`);
    } else rec(P, 'Live TV playlist/EPG checks', 'SKIP', 'Live TV is off');

    // 9. Data quality of the browse API the UI renders
    const rails = (await http('/json-api/browse/home')).json || [];
    const all = rails.flatMap((r) => r.items || []);
    const badPid = all.filter((i) => !/^[a-z]\d{3}[a-z0-9]{4}$/i.test(i.pid || ''));
    rec(P, 'browse home: every item has a valid pid', badPid.length ? 'FAIL' : 'PASS', JSON.stringify(badPid[0] || {}).slice(0, 100));
    const untitled = all.filter((i) => !String(i.title || '').trim() || LEAKY_TOKENS.test(JSON.stringify(i)));
    rec(P, 'browse home: every item has a title and no undefined/NaN fields', untitled.length ? 'FAIL' : 'PASS', JSON.stringify(untitled[0] || {}).slice(0, 140));
    const dupRail = rails.filter((r) => { const p = (r.items || []).map((i) => i.pid); return new Set(p).size !== p.length; });
    rec(P, 'browse home: no rail lists the same programme twice', dupRail.length ? 'WARN' : 'PASS', dupRail[0]?.title);
    const chans = (await http('/json-api/browse/channels')).json || [];
    rec(P, 'browse channels: ids are unique and every channel has a title', new Set(chans.map((c) => c.id)).size === chans.length && chans.every((c) => c.id && (c.title || c.name)) ? 'PASS' : 'FAIL', JSON.stringify(chans.find((c) => !c.id || !(c.title || c.name)) || {}).slice(0, 100));
    if (ctx.pid) {
        const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json || {};
        const eps = (prog.seasons || []).flatMap((s) => (s.episodes || []).map((e) => ({ ...e, season: s.number ?? s.series ?? s.id })));
        if (eps.length) {
            const pids = eps.map((e) => e.pid);
            rec(P, 'programme: episode pids are unique', new Set(pids).size === pids.length ? 'PASS' : 'FAIL', `${pids.length - new Set(pids).size} duplicate(s)`);
            const numbered = eps.filter((e) => e.episode != null || e.number != null || e.position != null);
            const keys = numbered.map((e) => `${e.season}|${e.episode ?? e.number ?? e.position}`);
            rec(P, 'programme: episode numbers are unique within a season (otherwise two files get the same SxxEyy)', new Set(keys).size === keys.length ? 'PASS' : 'WARN', `${keys.length - new Set(keys).size} clash(es)`);
            rec(P, 'programme: episodes have no undefined/NaN fields', eps.some((e) => LEAKY_TOKENS.test(JSON.stringify(e))) ? 'FAIL' : 'PASS', JSON.stringify(eps.find((e) => LEAKY_TOKENS.test(JSON.stringify(e))) || {}).slice(0, 140));
        }
    }
    const sched = (await http('/json-api/browse/schedule')).json;
    const days = Array.isArray(sched) ? sched : sched?.schedules || sched?.channels || [];
    let slotCount = 0, slotBadOrder = 0, slotDup = 0;
    for (const d of days) {
        const slots = d.slots || [];
        const starts = new Set();
        for (let i = 0; i < slots.length; i++) {
            slotCount++;
            const s = Date.parse(slots[i].start), e = Date.parse(slots[i].end);
            if (!(e > s)) slotBadOrder++;
            if (starts.has(slots[i].start)) slotDup++; starts.add(slots[i].start);
        }
    }
    rec(P, 'browse schedule: every slot ends after it starts and none start twice', slotCount ? (slotBadOrder || slotDup ? 'FAIL' : 'PASS') : 'SKIP', slotCount ? `${slotBadOrder} bad, ${slotDup} duplicate of ${slotCount}` : 'no slots in this response shape');

    // 10. Secrets never leave the server in clear
    const apps = (await http('/json-api/apps')).json || [];
    const clear = [];
    for (const a of apps) for (const [k, v] of [['api_key', a.api_key], ['password', a.password], ['download_client.api_key', a.download_client?.api_key], ['indexer.api_key', a.indexer?.api_key]]) if (v && v !== '********') clear.push(`${a.name}.${k}`);
    rec(P, 'apps API masks every key and password', clear.length ? 'FAIL' : 'PASS', clear.join(', '));
    const all2 = await Promise.all(['/json-api/stats/searchHistory', '/json-api/stats/grabHistory', '/json-api/streams', '/json-api/queue/history', '/json-api/events', '/json-api/versions'].map((p) => raw(p)));
    const secrets = [cfg.API_KEY, cfg.STREAM_KEY].filter((s) => s && s.length > 8);
    const leaked = all2.filter((r) => secrets.some((s) => (r.text || '').includes(s)));
    rec(P, 'stats, streams, history and events responses never contain the API or stream key', leaked.length ? 'FAIL' : 'PASS', `${leaked.length} response(s)`);
}

// ------------------------------------------------------------------------------------------------- mutating
async function write(ctx, h) {
    const { http, rec } = h;
    const { raw, survives, items } = helpers(h);
    const P = 'probe-write';
    const cfg = ctx.cfg || {};
    const cleanups = [];
    const later = (fn) => cleanups.push(fn);
    const get = async () => (await http('/json-api/config')).json || {};
    const before = await get();
    const put = (body) => http('/json-api/config', { method: 'PUT', body, timeout: 60000 });
    const J = (method, p, body) => raw(p, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

    // The garbage-body section below can mutate or crash a dev instance: keep a copy of every stored list first.
    try {
        const dir = require('path').resolve(__dirname, '..', '.claude', 'shots', 'smoke');
        fs.mkdirSync(dir, { recursive: true });
        const snapshot = {};
        for (const k of ['synonym', 'numbering-overrides', 'offSchedule', 'subscriptions', 'live-channels/custom', 'subscriptions/live']) snapshot[k] = (await http('/json-api/' + k)).json;
        fs.writeFileSync(require('path').join(dir, `backup-before-probes-${Date.now()}.json`), JSON.stringify({ config: before, ...snapshot }, null, 2));
    } catch { /* the probes still run */ }

    try {
        // 1. Concurrent saves must not lose each other (each PUT is a read-modify-write of one stored map)
        {
            const keys = ['UI_PILL_COLORS', 'UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES', 'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'DOWNLOAD_ASK_VERSION', 'PLAY_ASK_VERSION'];
            const flip = Object.fromEntries(keys.map((k) => [k, (before[k] ?? 'false') === 'true' ? 'false' : 'true']));
            later(() => put(Object.fromEntries(keys.map((k) => [k, before[k] ?? 'false']))));
            await Promise.all(keys.map((k) => put({ [k]: flip[k] })));
            const now = await get();
            const lost = keys.filter((k) => now[k] !== flip[k]);
            rec(P, `${keys.length} saves at the same moment are all kept (no lost update)`, lost.length ? 'FAIL' : 'PASS', `lost: ${lost.join(', ')}`);
            await Promise.all(keys.map((k) => put({ [k]: before[k] ?? 'false' })));
            const back = await get();
            rec(P, 'and all restored together', keys.every((k) => (back[k] ?? 'false') === (before[k] ?? 'false')) ? 'PASS' : 'FAIL', keys.filter((k) => (back[k] ?? 'false') !== (before[k] ?? 'false')).join(', '));
        }

        // 2. Types: JSON booleans and numbers arrive as non-strings and every reader compares strings
        for (const [key, value] of [['DEBUG', true], ['ACTIVE_LIMIT', 5], ['UI_PILL_COLORS', false], ['STREAM_SUBTITLES', true]]) {
            later(() => put({ [key]: before[key] ?? '' }));
            const r = await put({ [key]: value });
            if (r.status !== 200) { rec(P, `${key} given a JSON ${typeof value} is refused`, 'PASS'); continue; }
            const stored = (await get())[key];
            rec(P, `${key} given a JSON ${typeof value} is stored as the string "${String(value)}"`, stored === String(value) ? 'PASS' : 'FAIL', `stored ${JSON.stringify(stored)} (${typeof stored}): readers compare with === 'true'`);
            await put({ [key]: before[key] ?? '' });
        }
        for (const v of [' 5 ', '5.0', '1e1', '0x5', '+5', '05', '٣']) {
            later(() => put({ ACTIVE_LIMIT: before.ACTIVE_LIMIT }));
            const r = await put({ ACTIVE_LIMIT: v });
            if (r.status !== 200) { rec(P, `ACTIVE_LIMIT "${v}" refused`, 'PASS'); continue; }
            const stored = (await get()).ACTIVE_LIMIT;
            rec(P, `ACTIVE_LIMIT "${v}" accepted: stored as a plain whole number`, /^\d+$/.test(stored) ? 'PASS' : 'WARN', `stored ${JSON.stringify(stored)}`);
            await put({ ACTIVE_LIMIT: before.ACTIVE_LIMIT });
        }

        // 3. Free-text settings that the server uses as a file extension, a quality, a mode or a schedule must be checked
        const enums = [
            ['OUTPUT_FORMAT', 'exe', 'FAIL'], ['OUTPUT_FORMAT', '/../../x', 'FAIL'], ['OUTPUT_FORMAT', 'mp4 && calc', 'FAIL'],
            ['STREAM_MODE', 'bogus', 'WARN'], ['STREAM_CLIENT', 'bogus', 'WARN'], ['DOWNLOAD_CLIENT', 'bogus', 'WARN'], ['MEDIA_MODE', 'bogus', 'WARN'],
            ['VIDEO_QUALITY', 'bogus', 'WARN'], ['EXTRA_VIDEO_QUALITIES', 'bogus,,;', 'WARN'], ['EXTRA_VERSIONS', 'bogus', 'WARN'],
            ['NATIVE_SEARCH_ENGINE', 'V9', 'WARN'], ['MANUAL_NATIVE_SEARCH_ENGINE', 'V9', 'WARN'], ['NATIVE_SEARCH', 'maybe', 'WARN'], ['LIVE_TV_LOGO_SHAPE', 'triangle', 'WARN'],
            ['WRITE_NFO_STRM', 'sometimes', 'WARN'], ['STRM_WATCHDOG_ACTION', 'explode', 'WARN'], ['STRM_WATCHDOG_ARR_ACTION', 'explode', 'WARN'], ['STRM_WATCHDOG_SOURCES', 'nowhere', 'WARN'],
            ['RELEASE_LANGUAGE', 'klingon', 'WARN'],
            ['REFRESH_SCHEDULE', 'not a cron', 'FAIL'], ['REFRESH_SCHEDULE', '* * * * * *', 'WARN'], ['REFRESH_SCHEDULE', '* * * * *', 'WARN'],
            ['STRM_WATCHDOG_WEBHOOK_URL', 'file:///etc/passwd', 'FAIL'], ['STRM_WATCHDOG_WEBHOOK_URL', 'http://169.254.169.254/latest/meta-data/', 'WARN'],
            ['STREAM_BASE_URL', 'javascript:alert(1)', 'FAIL'], ['STREAM_BASE_URL', 'ftp://example.invalid/', 'FAIL'], ['STREAM_BASE_URL', 'http://', 'FAIL'],
            ['THUMBNAIL_RETENTION_DAYS', '-5', 'WARN'], ['THUMBNAIL_RETENTION_DAYS', 'abc', 'WARN'], ['LIVE_TV_EPG_OFFSET', '1e3', 'WARN'],
        ];
        for (const [key, value, level] of enums) {
            later(() => put({ [key]: before[key] ?? '' }));
            const r = await put({ [key]: value });
            const accepted = r.status === 200;
            rec(P, `${key} = ${JSON.stringify(value)} is refused`, accepted ? level : 'PASS', accepted ? 'accepted and stored; the server will use it as-is or silently fall back' : '');
            if (accepted) await put({ [key]: before[key] ?? '' });
            if (r.status >= 500) rec(P, `${key} = ${JSON.stringify(value)} did not crash the handler`, 'FAIL', `HTTP ${r.status}`);
        }

        // 4. A filename template must not be able to escape the library
        {
            const key = 'TV_FILENAME_TEMPLATE';
            later(() => put({ [key]: before[key] }));
            const r = await put({ [key]: '../../{{title}}/..\\x/{{title}}.S{{season}}E{{episode}}' });
            if (r.status === 200) {
                const names = items((await raw(`/api?t=tvsearch&q=springwatch&apikey=${encodeURIComponent(before.API_KEY)}`, { timeout: 90000 })).text || '').map((i) => i.title);
                const unsafe = names.filter((n) => /[\\/]|\.\./.test(n || ''));
                rec(P, 'a template with ../ and \\ still yields release names without path separators or ".."', names.length ? (unsafe.length ? 'FAIL' : 'PASS') : 'SKIP', unsafe[0]);
            } else rec(P, 'a template with ../ and \\ is refused', 'PASS');
            await put({ [key]: before[key] });
        }

        // 5. Stored entities: boundaries, hostile text, exact round trips
        const tag = 'SMOKE-TEMP-probe';
        const lists = {
            synonym: async () => (await http('/json-api/synonym')).json || [],
            numbering: async () => (await http('/json-api/numbering-overrides')).json || [],
            offSchedule: async () => (await http('/json-api/offSchedule')).json || [],
        };
        later(async () => {
            for (const s of (await lists.synonym()).filter((x) => String(x.from).includes('SMOKE-TEMP'))) await J('DELETE', '/json-api/synonym', { id: s.id });
            for (const s of (await lists.numbering()).filter((x) => String(x.show).includes('SMOKE-TEMP'))) await raw('/json-api/numbering-overrides/' + s.id, { method: 'DELETE' });
            for (const s of (await lists.offSchedule()).filter((x) => String(x.name).includes('SMOKE-TEMP'))) await J('DELETE', '/json-api/offSchedule', { id: s.id });
        });
        const hostile = [`${tag} <script>alert(1)</script>`, `${tag} "quoted" 'single' & amp`, `${tag} ${'x'.repeat(3000)}`, `${tag} unicode ☃ é 日本`, `${tag} .* [a-z]+ (regex)`, `${tag}\nnewline\ttab`];
        for (const from of hostile) {
            const r = await J('POST', '/json-api/synonym', { from, target: `${tag}-target`, exemptions: '' });
            survives(P, `synonym with ${JSON.stringify(from.slice(tag.length + 1, tag.length + 14))} does not crash`, r);
            if (r.status === 200) {
                const mine = (r.json || []).find((s) => s.from === from);
                rec(P, `synonym ${JSON.stringify(from.slice(tag.length + 1, tag.length + 14))} round-trips exactly`, mine ? 'PASS' : 'WARN', 'stored value differs from what was sent (trimmed or altered)');
            }
        }
        for (const offset of [-1, 1.5, 'abc', 1e9, null, '2']) {
            const r = await J('POST', '/json-api/synonym', { from: `${tag}-offset-${String(offset)}`, target: `${tag}-t`, seasonOffset: offset, exemptions: '' });
            survives(P, `synonym seasonOffset ${JSON.stringify(offset)} does not crash`, r);
            if (r.status === 200 && (typeof offset === 'string' && offset === 'abc' || offset === 1.5 || offset === 1e9)) rec(P, `synonym seasonOffset ${JSON.stringify(offset)} is refused`, 'WARN', 'accepted: a non-integer or absurd offset produces odd season numbers');
        }
        for (const bad of [{ series: 0, episode: 1 }, { series: -1, episode: 1 }, { series: 1.5, episode: 1 }, { series: 'x', episode: 1 }, { series: 1e9, episode: 1 }, { series: 1, episode: 0 }, { series: 1, episode: -4 }, { series: null, episode: null }]) {
            const r = await J('POST', '/json-api/numbering-overrides', { show: `${tag} nums`, airDate: '2021-03-04', ...bad });
            survives(P, `numbering override ${JSON.stringify(bad)} does not crash`, r);
            if (r.status === 200 && (bad.series < 0 || bad.episode < 0 || bad.series === 1.5 || typeof bad.series === 'string' || bad.series === 1e9 || bad.series == null)) rec(P, `numbering override ${JSON.stringify(bad)} is refused`, 'WARN', 'accepted: Sonarr would be told an impossible season/episode');
            for (const m of (await lists.numbering()).filter((x) => String(x.show).includes('SMOKE-TEMP'))) await raw('/json-api/numbering-overrides/' + m.id, { method: 'DELETE' });
        }
        for (const d of ['2020-02-30', '2020-13-01', '2020-1-2', '', '9999-12-31', '0000-00-00', '2020-02-29T00:00:00Z', '1/2/2020']) {
            const r = await J('POST', '/json-api/numbering-overrides', { show: `${tag} dates`, airDate: d, series: 1, episode: 1 });
            survives(P, `numbering override date ${JSON.stringify(d)} does not crash`, r);
            if (r.status === 200 && ['2020-02-30', '2020-13-01', '0000-00-00', ''].includes(d)) rec(P, `numbering override date ${JSON.stringify(d)} is refused`, 'FAIL', 'accepted: an impossible date can never match an episode');
            for (const m of (await lists.numbering()).filter((x) => String(x.show).includes('SMOKE-TEMP'))) await raw('/json-api/numbering-overrides/' + m.id, { method: 'DELETE' });
        }
        await J('POST', '/json-api/numbering-overrides', { show: `${tag} twice`, airDate: '2021-03-04', series: 1, episode: 1 });
        const dup = await J('POST', '/json-api/numbering-overrides', { show: `${tag} twice`, airDate: '2021-03-04', series: 2, episode: 2 });
        const twice = (await lists.numbering()).filter((x) => x.show === `${tag} twice`);
        rec(P, 'the same show and air date cannot hold two conflicting overrides', twice.length <= 1 ? 'PASS' : 'FAIL', `${twice.length} entries, second save HTTP ${dup.status}`);

        // Off-schedule only uses the URL to pull out a programme id (the server never fetches it), so a non-BBC address is untidy rather than an SSRF: WARN, not FAIL
        for (const url of ['http://169.254.169.254/latest/meta-data/', 'file:///etc/passwd', 'ftp://www.bbc.co.uk/programmes/m002csng', 'javascript:alert(1)', 'http://localhost:4404/ping', 'http://127.0.0.1/', 'https://www.bbc.co.uk.evil.example/programmes/m002csng', 'https://evil.example/www.bbc.co.uk/programmes/m002csng', 'http://[::1]/']) {
            const r = await J('POST', '/json-api/offSchedule', { name: `${tag} off`, url });
            survives(P, `off-schedule ${url.slice(0, 40)} does not crash`, r);
            rec(P, `off-schedule refuses non-BBC address ${url.slice(0, 50)}`, r.status === 200 ? 'WARN' : 'PASS', 'accepted: only the programme id in it is used, but a lookalike host is not rejected');
            for (const m of (await lists.offSchedule()).filter((x) => String(x.name).includes('SMOKE-TEMP'))) await J('DELETE', '/json-api/offSchedule', { id: m.id });
        }

        // 6. Custom channels: names and URLs flow into the M3U playlist, the XMLTV guide and a rendered logo
        {
            const goodUrl = `${h.BASE}/api?mode=stream&pid=bbc_four&streamkey=${encodeURIComponent(cfg.STREAM_KEY || '')}`;
            const nasty = `SMOKE-TEMP "q" <b>&amp; 'x' ,=# ☃`;
            const created = [];
            later(async () => { for (const id of created) { await raw('/json-api/live-tv/channels/' + id, { method: 'DELETE' }); await raw('/json-api/live-channels/custom/' + id, { method: 'DELETE' }); } });
            for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'ftp://example.invalid/x', 'data:text/html,<script>alert(1)</script>', 'not a url', '//evil.example/x']) {
                const r = await J('POST', '/json-api/live-channels/custom', { name: 'SMOKE-TEMP badurl', streamUrl: url });
                survives(P, `custom channel URL ${url.slice(0, 30)} does not crash`, r);
                rec(P, `custom channel refuses stream URL ${url.slice(0, 40)}`, r.status === 200 ? 'FAIL' : 'PASS', 'accepted');
                for (const c of ((await http('/json-api/live-channels/custom')).json || []).filter((x) => String(x.title).includes('SMOKE-TEMP badurl'))) await raw('/json-api/live-channels/custom/' + c.id, { method: 'DELETE' });
            }
            for (const color of ['red;}</style><script>', '#12', 'javascript:1', '#GGGGGG']) {
                const r = await J('POST', '/json-api/live-channels/custom', { name: 'SMOKE-TEMP color', streamUrl: goodUrl, color });
                survives(P, `custom channel colour ${JSON.stringify(color).slice(0, 30)} does not crash`, r);
                rec(P, `custom channel refuses colour ${JSON.stringify(color).slice(0, 30)}`, r.status === 200 ? 'WARN' : 'PASS', 'accepted: the colour is written into a generated SVG logo');
                for (const c of ((await http('/json-api/live-channels/custom')).json || []).filter((x) => String(x.title).includes('SMOKE-TEMP color'))) await raw('/json-api/live-channels/custom/' + c.id, { method: 'DELETE' });
            }
            const add = await J('POST', '/json-api/live-channels/custom', { name: nasty, streamUrl: goodUrl, color: '#123456', logoText: '<svg onload=alert(1)>&"\'', group: `G"roup <x>` });
            survives(P, 'custom channel with quotes, tags and & in its name/logo/group is accepted or refused cleanly', add);
            const mine = ((await http('/json-api/live-channels/custom')).json || []).find((c) => String(c.title).startsWith('SMOKE-TEMP "q"'));
            if (mine) {
                created.push(mine.id);
                const logo = await raw('/json-api/live-channels/logo/' + mine.id);
                rec(P, 'its logo renders as an image (hostile logo text is escaped)', logo.status === 200 && /image/.test(logo.headers.get('content-type') || '') ? 'PASS' : 'FAIL', `HTTP ${logo.status} ${logo.headers.get('content-type')}`);
                await raw('/json-api/live-tv/channels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channelId: mine.id }) });
                if (cfg.STREAM_KEY && cfg.LIVE_TV_ENABLED === 'true') {
                    const pl = (await raw(`/api?mode=live_playlist&streamkey=${encodeURIComponent(cfg.STREAM_KEY)}`, { timeout: 60000 })).text;
                    const ext = pl.split('\n').filter((l) => l.startsWith('#EXTINF'));
                    const badExt = ext.filter((l) => !/^#EXTINF:-1( [\w-]+="[^"]*")+,[^\n]+$/.test(l));
                    rec(P, 'playlist stays well-formed with the hostile channel in it', badExt.length ? 'FAIL' : 'PASS', badExt[0]);
                    const xml = (await raw(`/api?mode=live_epg&streamkey=${encodeURIComponent(cfg.STREAM_KEY)}`, { timeout: 180000 })).text;
                    rec(P, 'EPG stays well-formed with the hostile channel in it', /<\/tv>\s*$/.test(xml) && !BAD_XML_AMP.test(xml) && !/<b>|<svg/.test(xml) ? 'PASS' : 'FAIL', (xml.match(new RegExp(`.{20}${BAD_XML_AMP.source}.{10}`)) || [''])[0]);
                } else rec(P, 'playlist/EPG with the hostile channel', 'SKIP', 'Live TV is off');
                const exp = await raw('/json-api/live-channels/custom-export');
                rec(P, 'custom export is valid JSON including the hostile channel', exp.json ? 'PASS' : 'FAIL', exp.text.slice(0, 80));
            } else rec(P, 'hostile custom channel listed', 'SKIP', `not stored (HTTP ${add.status})`);
        }

        // 7. Two identical requests at once must not queue the same download twice
        if (ctx.pid) {
            const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const ep = ((prog?.seasons || []).flatMap((s) => s.episodes || []).find((e) => e.pid)) || undefined;
            if (ep) {
                later(async () => {
                    for (const q of ((await http('/json-api/queue/queue')).json || []).filter((e) => e.pid === ep.pid)) await raw(`/json-api/queue/queue?pid=${ep.pid}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
                    for (const x of ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === ep.pid)) await raw(`/json-api/queue/history?pid=${ep.pid}${x.jobId ? '&jobId=' + x.jobId : ''}`, { method: 'DELETE' });
                });
                await Promise.all([raw(`/json-api/download?pid=${ep.pid}&media=download`, { timeout: 60000 }), raw(`/json-api/download?pid=${ep.pid}&media=download`, { timeout: 60000 })]);
                await sleep(3000);
                const queued = ((await http('/json-api/queue/queue')).json || []).filter((e) => e.pid === ep.pid);
                rec(P, 'a double-clicked Download queues the programme once', queued.length <= 1 ? 'PASS' : 'FAIL', `${queued.length} queue entries for ${ep.pid}`);
                for (const q of queued) await raw(`/json-api/queue/queue?pid=${ep.pid}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
            }
        }

        // 8. Garbage bodies to every endpoint that stores something: refuse cleanly, change nothing
        const bodies = [{}, [], null, 'str', 123, { id: {} }, { id: [] }, { id: '../../x' }, { name: tag + '-fuzz', url: {} }, { from: [], target: {} }, { channelId: {} }, { pid: [] }, { ttl: 'x' }, { ttl: -5 }, { ttl: 1e15 }, { enabled: 'yes' }, { cron: {} }, { schedule: [] }];
        const eps = [
            ['POST', '/json-api/synonym'], ['PUT', '/json-api/synonym'], ['POST', '/json-api/numbering-overrides'], ['POST', '/json-api/offSchedule'], ['POST', '/json-api/subscriptions'],
            ['PUT', '/json-api/subscriptions/SMOKE-NOPE/versions'], ['POST', '/json-api/subscriptions/live'], ['POST', '/json-api/live-channels/custom'], ['PUT', '/json-api/live-channels/custom/SMOKE-NOPE'],
            ['PUT', '/json-api/live-channels/bbc_four'], ['POST', '/json-api/live-tv/channels'], ['POST', '/json-api/apps'], ['PUT', '/json-api/apps'], ['POST', '/json-api/apps/test'],
            ['PUT', '/json-api/maintenance/caches/SMOKE-NOPE/ttl'], ['PUT', '/json-api/maintenance/tasks/SMOKE-NOPE/schedule'], ['POST', '/json-api/maintenance/tasks/SMOKE-NOPE/schedule/validate'],
            ['PUT', '/json-api/watchdog/path-map'], ['POST', '/json-api/live-channels/probe'], ['PUT', '/json-api/config'], ['DELETE', '/json-api/synonym'], ['DELETE', '/json-api/offSchedule'], ['DELETE', '/json-api/apps'],
        ].filter(([m, p]) => !(m === 'DELETE' && true)); // bare DELETEs with no id are skipped: they may mean "everything"
        let fuzzBad = 0, fuzzN = 0;
        const snap = async () => JSON.stringify([await lists.synonym(), await lists.numbering(), await lists.offSchedule(), (await http('/json-api/subscriptions')).json, (await http('/json-api/live-channels/custom')).json, (await http('/json-api/apps')).json]);
        const state0 = await snap();
        for (const [m, p] of eps) for (const b of bodies) {
            const r = await J(m, p, b);
            fuzzN++;
            if (r.status === 0 || r.status >= 500 || STACK.test(r.text || '')) { fuzzBad++; rec(P, `${m} ${p} with ${JSON.stringify(b).slice(0, 30)}`, 'FAIL', r.status === 0 ? `no answer (${r.error})` : `HTTP ${r.status} ${(r.text || '').slice(0, 100)}`); }
        }
        rec(P, `garbage request bodies never crash a store endpoint or leak internals (${fuzzN} requests)`, fuzzBad ? 'FAIL' : 'PASS', `${fuzzBad} bad`);
        const state1 = await snap();
        rec(P, 'and none of them changed any stored list', state0 === state1 ? 'PASS' : 'FAIL', 'a list differs after the garbage requests');
        for (const [m, p] of [['DELETE', '/json-api/synonym'], ['DELETE', '/json-api/offSchedule']]) for (const id of ['SMOKE-NOPE', 0, -1, null, {}]) {
            const r = await J(m, p, { id });
            survives(P, `${m} ${p} with id ${JSON.stringify(id)} does not crash`, r);
        }
        rec(P, 'deleting unknown ids removed nothing', (await snap()) === state0 ? 'PASS' : 'FAIL', 'a list changed');
    } finally {
        for (const fn of cleanups.reverse()) { try { await fn(); } catch { /* best effort */ } }
        const after = await get();
        const diff = Object.keys({ ...before, ...after }).filter((k) => (before[k] ?? '') !== (after[k] ?? ''));
        rec(P, 'probes leave the configuration exactly as they found it', diff.length ? 'FAIL' : 'PASS', diff.map((k) => `${k}: ${before[k]} -> ${after[k]}`).join('; '));
        const leaks = [];
        for (const p of ['/json-api/synonym', '/json-api/numbering-overrides', '/json-api/offSchedule', '/json-api/live-channels/custom', '/json-api/subscriptions'])
            if ((await http(p)).text.includes('SMOKE-TEMP')) leaks.push(p);
        rec(P, 'probes leave no SMOKE-TEMP entries behind', leaks.length ? 'FAIL' : 'PASS', leaks.join(', '));
    }
}

module.exports = { readOnly, write };
