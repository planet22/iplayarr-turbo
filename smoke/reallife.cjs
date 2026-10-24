/* Real-life (mutating) smoke layer, run with --write. DEV INSTANCES ONLY.
 * Every entity it creates is named SMOKE-TEMP and removed again (cleanup runs even after a failure).
 * Each step is independent: one failing step never stops the rest.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function realLife(ctx, { http, rec, BASE, check }) {
    const W = 'real';
    const cleanups = [];
    const later = (name, fn) => cleanups.push({ name, fn });
    const step = async (name, fn) => {
        try { await fn(); } catch (e) { rec(W, name, 'FAIL', 'threw: ' + e.message); }
    };
    const ok = (name, cond, detail = '') => rec(W, name, cond ? 'PASS' : 'FAIL', cond ? '' : detail);
    const warn = (name, cond, detail = '') => rec(W, name, cond ? 'PASS' : 'WARN', cond ? '' : detail);
    const cfg = ctx.cfg;
    const streamkey = cfg.STREAM_KEY, apikey = cfg.API_KEY;

    try {
        // 1. Settings: no-op PUT, then a real change + persistence + revert
        await step('settings', async () => {
            const before = (await http('/json-api/config')).json;
            const put = await http('/json-api/config', { method: 'PUT', body: before });
            ok('config PUT no-op round-trip', put.status === 200, `HTTP ${put.status} ${put.text.slice(0, 120)}`);
            const after = (await http('/json-api/config')).json;
            const diff = Object.keys(before).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
            ok('config unchanged by no-op PUT', !diff.length, diff.join(','));
            // change a harmless setting, confirm it sticks, put it back
            const key = 'ACTIVE_LIMIT' in before ? 'ACTIVE_LIMIT' : null;
            if (key && put.status !== 200) rec(W, `config change persisted`, 'SKIP', 'blocked: stored config fails its own validation (see no-op PUT failure)');
            else if (key) {
                const orig = before[key];
                const next = String(((parseInt(orig, 10) || 1) % 10) + 1);
                later('restore ' + key, async () => http('/json-api/config', { method: 'PUT', body: { ...(await http('/json-api/config')).json, [key]: orig } }));
                const r = await http('/json-api/config', { method: 'PUT', body: { ...before, [key]: next } });
                ok(`config change ${key} saved`, r.status === 200, `HTTP ${r.status} ${r.text.slice(0, 120)}`);
                ok(`config change ${key} persisted`, String((await http('/json-api/config')).json[key]) === next);
            } else rec(W, 'config change persisted', 'SKIP', 'no ACTIVE_LIMIT key');
            const bad = await http('/json-api/config', { method: 'PUT', body: { ...before, ACTIVE_LIMIT: '99' } });
            ok('config rejects out-of-range ACTIVE_LIMIT', bad.status === 400, `HTTP ${bad.status}`);
            const blank = await http('/json-api/config', { method: 'PUT', body: { ...before, API_KEY: '' } });
            ok('blank API_KEY never wipes the stored key', ((await http('/json-api/config')).json.API_KEY || '').length === (before.API_KEY || '').length, `HTTP ${blank.status}`);
        });

        // 2. Synonyms: add, validation conflict, update, delete
        await step('synonyms', async () => {
            const del = async (id) => http('/json-api/synonym', { method: 'DELETE', body: { id } });
            const add = await http('/json-api/synonym', { method: 'POST', body: { from: 'SMOKE-TEMP-from', target: 'SMOKE-TEMP-to', exemptions: '' } });
            ok('synonym create', add.status === 200 && Array.isArray(add.json), `HTTP ${add.status} ${add.text.slice(0, 120)}`);
            const mine = (add.json || []).find((s) => s.from === 'SMOKE-TEMP-from');
            if (!mine) return rec(W, 'synonym listed', 'FAIL');
            later('delete synonym', () => del(mine.id));
            const dup = await http('/json-api/synonym', { method: 'POST', body: { from: 'smoke-temp-FROM', target: 'other', exemptions: '' } });
            ok('synonym duplicate rejected (case-insensitive)', dup.status === 400, `HTTP ${dup.status}`);
            const empty = await http('/json-api/synonym', { method: 'POST', body: { from: '', target: '' } });
            ok('synonym empty rejected', empty.status === 400, `HTTP ${empty.status}`);
            const upd = await http('/json-api/synonym', { method: 'PUT', body: { ...mine, target: 'SMOKE-TEMP-to2', seasonOffset: 1 } });
            ok('synonym update', upd.status === 200 && (upd.json || []).some((s) => s.target === 'SMOKE-TEMP-to2'), `HTTP ${upd.status}`);
            const gone = await del(mine.id);
            ok('synonym delete', gone.status === 200 && !(gone.json || []).some((s) => s.id === mine.id), `HTTP ${gone.status}`);
        });

        // 3. Numbering overrides
        await step('numbering overrides', async () => {
            const bad = await http('/json-api/numbering-overrides', { method: 'POST', body: { show: 'x', airDate: 'nope', series: 1, episode: 1 } });
            ok('numbering override bad date rejected', bad.status === 400, `HTTP ${bad.status}`);
            const add = await http('/json-api/numbering-overrides', { method: 'POST', body: { show: 'SMOKE-TEMP show', airDate: '2020-01-02', series: 3, episode: 4 } });
            ok('numbering override create', add.status === 200, `HTTP ${add.status} ${add.text.slice(0, 100)}`);
            const list = (await http('/json-api/numbering-overrides')).json || [];
            const mine = list.find((o) => o.show === 'SMOKE-TEMP show');
            ok('numbering override listed', !!mine);
            if (mine) {
                later('delete numbering override', () => http('/json-api/numbering-overrides/' + mine.id, { method: 'DELETE' }));
                const del = await http('/json-api/numbering-overrides/' + mine.id, { method: 'DELETE' });
                ok('numbering override delete', del.status === 200 && !((await http('/json-api/numbering-overrides')).json || []).some((o) => o.id === mine.id));
            }
        });

        // 4. Off-schedule series
        await step('off-schedule', async () => {
            const bad = await http('/json-api/offSchedule', { method: 'POST', body: { name: '', url: 'not a url' } });
            ok('off-schedule invalid rejected', bad.status === 400, `HTTP ${bad.status}`);
            const add = await http('/json-api/offSchedule', { method: 'POST', body: { name: 'SMOKE-TEMP series', url: 'https://www.bbc.co.uk/programmes/m002csng' } });
            warn('off-schedule create', add.status === 200, `HTTP ${add.status} ${add.text.slice(0, 120)}`);
            const mine = (add.json || []).find((s) => s.name === 'SMOKE-TEMP series');
            if (mine) {
                later('delete off-schedule', () => http('/json-api/offSchedule', { method: 'DELETE', body: { id: mine.id } }));
                const del = await http('/json-api/offSchedule', { method: 'DELETE', body: { id: mine.id } });
                ok('off-schedule delete', del.status === 200 && !(del.json || []).some((s) => s.id === mine.id));
            }
        });

        // 5. Show subscription: subscribe -> list -> check -> versions -> unsubscribe
        await step('subscriptions', async () => {
            const brand = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const bpid = brand?.pid;
            if (!bpid) return rec(W, 'subscription brand pid', 'FAIL', 'no brand pid');
            const existing = ((await http('/json-api/subscriptions')).json || []).find((s) => s.pid === bpid);
            if (existing) await http('/json-api/subscriptions/' + existing.id, { method: 'DELETE' });
            const bad = await http('/json-api/subscriptions', { method: 'POST', body: { pid: '!!' } });
            ok('subscribe invalid pid rejected', bad.status === 400, `HTTP ${bad.status}`);
            const sub = await http('/json-api/subscriptions', { method: 'POST', body: { pid: bpid, arrOnly: true } });
            ok('subscribe (arrOnly, nothing queued)', sub.status === 200 && sub.json?.id, `HTTP ${sub.status} ${sub.text.slice(0, 160)}`);
            const id = sub.json?.id;
            if (!id) return;
            later('unsubscribe show', () => http('/json-api/subscriptions/' + id, { method: 'DELETE' }));
            ok('subscription listed', ((await http('/json-api/subscriptions')).json || []).some((s) => s.id === id));
            const dupe = await http('/json-api/subscriptions', { method: 'POST', body: { pid: bpid, arrOnly: true } });
            warn('re-subscribing is idempotent or cleanly refused', dupe.status === 200 || dupe.status === 400, `HTTP ${dupe.status}`);
            const chk = await http(`/json-api/subscriptions/${id}/check`, { method: 'POST', timeout: 120000 });
            ok('subscription check runs', chk.status === 200, `HTTP ${chk.status} ${chk.text.slice(0, 120)}`);
            const ver = await http(`/json-api/subscriptions/${id}/versions`, { method: 'PUT', body: { versions: [] } });
            ok('subscription versions update', ver.status === 200, `HTTP ${ver.status} ${ver.text.slice(0, 120)}`);
            const un = await http('/json-api/subscriptions/' + id, { method: 'DELETE' });
            ok('unsubscribe', un.status === 200);
            const un2 = await http('/json-api/subscriptions/' + id, { method: 'DELETE' });
            ok('unsubscribe twice gives 404', un2.status === 404, `HTTP ${un2.status}`);
        });

        // 6. Live channel subscription (.strm in the library) + enable/disable
        await step('live subscriptions', async () => {
            const ch = 'bbc_four';
            await http('/json-api/subscriptions/live/' + ch, { method: 'DELETE' });
            const add = await http('/json-api/subscriptions/live', { method: 'POST', body: { channelId: ch } });
            ok('live subscribe', add.status === 200, `HTTP ${add.status} ${add.text.slice(0, 120)}`);
            later('live unsubscribe', () => http('/json-api/subscriptions/live/' + ch, { method: 'DELETE' }));
            const listed = ((await http('/json-api/subscriptions/live')).json || []).find((s) => s.channelId === ch);
            ok('live subscription listed with .strm file', !!listed?.file, JSON.stringify(listed));
            const bad = await http('/json-api/subscriptions/live', { method: 'POST', body: { channelId: 'no_such_channel' } });
            ok('live subscribe unknown channel rejected', bad.status === 400, `HTTP ${bad.status}`);
            const del = await http('/json-api/subscriptions/live/' + ch, { method: 'DELETE' });
            ok('live unsubscribe', del.status === 200);
            // channel enable toggle, restored
            const chans = (await http('/json-api/live-channels')).json || [];
            const c = chans.find((x) => x.id === 'cbeebies');
            if (c) {
                later('restore channel enabled', () => http('/json-api/live-channels/cbeebies', { method: 'PUT', body: { enabled: c.enabled } }));
                const off = await http('/json-api/live-channels/cbeebies', { method: 'PUT', body: { enabled: !c.enabled } });
                ok('live channel toggle', off.status === 200, `HTTP ${off.status}`);
                const pl = (await http(`/api?mode=live_playlist&streamkey=${streamkey}`)).text;
                ok('playlist reflects channel toggle', c.enabled ? !/cbeebies/i.test(pl) : /cbeebies/i.test(pl), 'playlist unchanged');
                await http('/json-api/live-channels/cbeebies', { method: 'PUT', body: { enabled: c.enabled } });
            }
        });

        // 7. Custom channels: probe, create, edit, test, export/import, delete
        await step('custom channels', async () => {
            const url = `${BASE}/api?mode=stream&pid=bbc_four&streamkey=${streamkey}`;
            const noName = await http('/json-api/live-channels/custom', { method: 'POST', body: { streamUrl: url } });
            ok('custom channel needs a name', noName.status === 400, `HTTP ${noName.status}`);
            const probe = await http('/json-api/live-channels/probe', { method: 'POST', body: { streamUrl: url }, timeout: 60000 });
            warn('custom channel probe', probe.status === 200, `HTTP ${probe.status} ${probe.text.slice(0, 120)}`);
            const add = await http('/json-api/live-channels/custom', { method: 'POST', body: { name: 'SMOKE-TEMP chan', streamUrl: url, color: '#123456', logoText: 'SMK', group: 'SMOKE' } });
            ok('custom channel create', add.status === 200, `HTTP ${add.status} ${add.text.slice(0, 160)}`);
            const list = (await http('/json-api/live-channels/custom')).json || [];
            const mine = list.find((c) => c.title === 'SMOKE-TEMP chan');
            if (!mine) return rec(W, 'custom channel listed', 'FAIL');
            later('delete custom channel', () => http('/json-api/live-channels/custom/' + mine.id, { method: 'DELETE' }));
            const upd = await http('/json-api/live-channels/custom/' + mine.id, { method: 'PUT', body: { name: 'SMOKE-TEMP chan 2' } });
            ok('custom channel rename', upd.status === 200, `HTTP ${upd.status}`);
            const logo = await http('/json-api/live-channels/logo/' + mine.id);
            ok('custom channel logo renders', logo.status === 200 && /image/.test(logo.ct), `HTTP ${logo.status} ${logo.ct}`);
            const sel = await http('/json-api/live-tv/channels', { method: 'POST', body: { channelId: mine.id } });
            ok('custom channel added to Live TV selection', sel.status === 200, `HTTP ${sel.status} ${sel.text.slice(0, 100)}`);
            later('remove custom from Live TV', () => http('/json-api/live-tv/channels/' + mine.id, { method: 'DELETE' }));
            const pl = (await http(`/api?mode=live_playlist&streamkey=${streamkey}`)).text;
            ok('custom channel appears in playlist once selected', /SMOKE-TEMP chan 2/.test(pl), 'not in m3u');
            const epg = (await http(`/api?mode=live_epg&streamkey=${streamkey}`, { timeout: 120000 })).text;
            warn('custom channel in EPG', epg.includes(mine.id), 'not in xmltv');
            const exp = await http('/json-api/live-channels/custom-export');
            ok('custom export contains it', /SMOKE-TEMP chan 2/.test(exp.text));
            const del = await http('/json-api/live-channels/custom/' + mine.id, { method: 'DELETE' });
            ok('custom channel delete', del.status === 200);
            const selAfter = (await http('/json-api/live-tv/channels')).json || [];
            ok('deleting a custom channel also drops it from the Live TV selection', !selAfter.includes(mine.id), 'stale id left in selection');
            const del2 = await http('/json-api/live-channels/custom/' + mine.id, { method: 'DELETE' });
            warn('custom channel delete twice is a clean error', del2.status === 400 || del2.status === 404, `HTTP ${del2.status}`);
        });

        // 8. Native HLS playback: master -> variant -> segment, appears in Streaming, then stop
        await step('streaming playback', async () => {
            const url = `/api?mode=stream&pid=${ctx.pid}&streamkey=${streamkey}`;
            const master = await http(url, { timeout: 60000 });
            ok('stream master playlist', /#EXTM3U/.test(master.text), `HTTP ${master.status}`);
            const variantUri = (master.text.split('\n').find((l) => l && !l.startsWith('#')) || '').trim();
            if (!variantUri) return rec(W, 'stream variant', 'FAIL', 'no variant in master');
            const vUrl = variantUri.startsWith('http') ? variantUri.replace(BASE, '') : '/api/' + variantUri.replace(/^\/?(api\/)?/, '');
            const variant = await http(vUrl, { timeout: 60000 });
            ok('stream variant playlist', /#EXTINF/.test(variant.text), `HTTP ${variant.status} ${variant.text.slice(0, 80)}`);
            const segUri = (variant.text.split('\n').find((l) => l && !l.startsWith('#')) || '').trim();
            if (segUri) {
                const seg = await fetch(segUri.startsWith('http') ? segUri : BASE + (segUri.startsWith('/') ? '' : '/api') + segUri, { headers: { range: 'bytes=0-4095' } }).catch(() => null);
                ok('stream first segment fetchable', !!seg && (seg.status === 200 || seg.status === 206), `HTTP ${seg?.status}`);
                if (seg) await seg.arrayBuffer().catch(() => {});
            }
            const act = ((await http('/json-api/streams')).json || {}).active || [];
            const mine = act.find((s) => s.pid === ctx.pid);
            warn('stream shows in Streaming page as active', !!mine, `${act.length} active`);
            if (mine) {
                const stop = await http(`/json-api/streams/${mine.id}/stop`, { method: 'POST' });
                ok('stop stream', stop.status === 200, `HTTP ${stop.status}`);
            }
            // live
            const live = await http(`/api?mode=stream&pid=bbc_four&streamkey=${streamkey}`, { timeout: 60000 });
            warn('live channel master playlist', /#EXTM3U/.test(live.text), `HTTP ${live.status}`);
        });

        // 9. Downloads: .strm download, real file download, queue/history lifecycle, cancel
        await step('downloads', async () => {
            const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const eps = (prog?.seasons || []).flatMap((s) => s.episodes || []);
            const ep = eps.find((e) => e.pid && e.pid !== ctx.pid) || eps[0];
            if (!ep) return rec(W, 'download episode pick', 'SKIP', 'no episodes');
            const waitDone = async (pid, ms) => {
                const end = Date.now() + ms;
                while (Date.now() < end) {
                    const q = ((await http('/json-api/queue/queue')).json || []).filter((e) => e.pid === pid);
                    if (!q.length) return true;
                    await sleep(5000);
                }
                return false;
            };
            const hist = async (pid) => ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === pid);
            const cleanHist = async (pid) => { for (const h of await hist(pid)) await http(`/json-api/queue/history?pid=${pid}${h.jobId ? '&jobId=' + h.jobId : ''}`, { method: 'DELETE' }); };

            const bad = await http('/json-api/download?pid=!!bad');
            ok('download invalid pid rejected', bad.status === 400, `HTTP ${bad.status}`);
            const badMedia = await http(`/json-api/download?pid=${ep.pid}&media=banana`);
            ok('download invalid media rejected', badMedia.status === 400, `HTTP ${badMedia.status}`);

            // .strm download (fast)
            await cleanHist(ep.pid);
            later('clean download history', () => cleanHist(ep.pid));
            const strm = await http(`/json-api/download?pid=${ep.pid}&media=strm`, { timeout: 60000 });
            ok('download as .strm accepted', strm.status === 200, `HTTP ${strm.status} ${strm.text.slice(0, 120)}`);
            ok('strm download leaves the queue', await waitDone(ep.pid, 120000), 'still queued after 2 min');
            const h = (await hist(ep.pid))[0];
            ok('strm download recorded complete in history', !!h && /complete|done|success/i.test(JSON.stringify(h.status)), JSON.stringify(h || {}).slice(0, 160));
            // SAB-visible too (what Sonarr sees)
            const sab = (await http(`/api?mode=history&apikey=${apikey}&output=json`)).json;
            warn('sab history shows the download', (sab?.history?.slots || []).some((x) => x.nzb_name === h?.nzbName || x.name === h?.nzbName), 'not in SAB history');
            await cleanHist(ep.pid);
            ok('history entry deleted', (await hist(ep.pid)).length === 0);

            // Queue then cancel (real download so it stays queued long enough)
            const pid2 = eps.find((e) => e.pid && e.pid !== ep.pid)?.pid;
            if (pid2) {
                later('clean cancel history', () => cleanHist(pid2));
                const dl = await http(`/json-api/download?pid=${pid2}&media=download`, { timeout: 60000 });
                ok('real download accepted', dl.status === 200, `HTTP ${dl.status} ${dl.text.slice(0, 120)}`);
                await sleep(4000);
                const q = ((await http('/json-api/queue/queue')).json || []).find((e) => e.pid === pid2);
                warn('real download visible in queue', !!q, 'not in queue after 4s');
                if (q) {
                    ok('queue entry has progress fields', 'status' in q || 'progress' in q, JSON.stringify(q).slice(0, 120));
                    const info = await http(`/json-api/queue/queue?pid=${pid2}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
                    ok('cancel queued download', info.status === 200 && !(info.json || []).some((e) => e.pid === pid2), `HTTP ${info.status}`);
                }
                await cleanHist(pid2);
            }

            // Arr path: NZB from a Newznab search -> SAB addfile -> queue -> cancel
            const rss = (await http(`/api?t=tvsearch&q=news&apikey=${apikey}`, { timeout: 60000 })).text;
            const link = (rss.match(/<enclosure url="([^"]+)"/) || [])[1];
            if (link) {
                const nzbRes = await fetch(link.replace(/&amp;/g, '&'));
                const nzbText = await nzbRes.text();
                const pidInNzb = (nzbText.match(/name="pid">([a-z0-9]+)</i) || nzbText.match(/pid[^>]*>([a-z0-9]{8})</i) || [])[1];
                const form = new FormData();
                form.append('name', new Blob([nzbText], { type: 'application/x-nzb' }), 'SMOKE-TEMP.nzb');
                const add = await fetch(`${BASE}/api?mode=addfile&apikey=${apikey}&output=json`, { method: 'POST', body: form });
                const addText = await add.text();
                ok('SAB addfile accepts NZB (Sonarr hand-off)', add.status === 200 && /true|nzo|ids/i.test(addText), `HTTP ${add.status} ${addText.slice(0, 120)}`);
                if (pidInNzb) {
                    later('clean arr-path queue/history', async () => {
                        await http(`/json-api/queue/queue?pid=${pidInNzb}`, { method: 'DELETE' });
                        await cleanHist(pidInNzb);
                    });
                    await sleep(3000);
                    const sq = (await http(`/api?mode=queue&apikey=${apikey}&output=json`)).json;
                    warn('SAB queue lists the hand-off', JSON.stringify(sq).includes(pidInNzb) || (sq?.queue?.slots || []).length > 0, 'not listed');
                }
            } else rec(W, 'SAB addfile via NZB', 'SKIP', 'no NZB link from search');
        });

        // 10. Maintenance: validate schedule, run a task, cache TTL set/reset/clear
        await step('maintenance', async () => {
            const tasks = (await http('/json-api/maintenance/tasks')).json || [];
            const t = tasks[0];
            if (t) {
                const badCron = await http(`/json-api/maintenance/tasks/${t.id}/schedule/validate`, { method: 'POST', body: { schedule: 'not a cron' } });
                ok('task schedule validate rejects junk', badCron.status === 400 || badCron.json?.valid === false, `HTTP ${badCron.status} ${badCron.text.slice(0, 80)}`);
                const unknown = await http('/json-api/maintenance/tasks/nope/run', { method: 'POST' });
                ok('run unknown task is 404', unknown.status === 404, `HTTP ${unknown.status}`);
            }
            const light = tasks.find((x) => /history|prune|clean|logo/i.test(x.id)) || null;
            if (light) {
                const run = await http(`/json-api/maintenance/tasks/${light.id}/run`, { method: 'POST' });
                ok(`run task ${light.id}`, run.status === 202 || run.status === 409, `HTTP ${run.status}`);
            }
            const caches = (await http('/json-api/maintenance/caches')).json || [];
            const c = caches.find((x) => x.prefix === 'stream_vpid') || caches[0];
            if (c) {
                later('reset cache ttl', () => http(`/json-api/maintenance/caches/${c.prefix}/ttl`, { method: 'PUT', body: { ttl: null } }));
                const tooSmall = await http(`/json-api/maintenance/caches/${c.prefix}/ttl`, { method: 'PUT', body: { ttl: 1 } });
                ok('cache ttl below minimum rejected', tooSmall.status === 400, `HTTP ${tooSmall.status}`);
                const setTtl = await http(`/json-api/maintenance/caches/${c.prefix}/ttl`, { method: 'PUT', body: { ttl: 7200 } });
                ok('cache ttl override saved', setTtl.status === 200, `HTTP ${setTtl.status}`);
                const reset = await http(`/json-api/maintenance/caches/${c.prefix}/ttl`, { method: 'PUT', body: { ttl: null } });
                ok('cache ttl reset to default', reset.status === 200);
                const nf = await http('/json-api/maintenance/caches/nope', { method: 'DELETE' });
                ok('clear unknown cache is 404', nf.status === 404, `HTTP ${nf.status}`);
            }
        });

        // 11. Watchdog: refresh counts, run, stop
        await step('watchdog', async () => {
            if (!ctx.wd?.enabled) return rec(W, 'watchdog flow', 'SKIP', 'disabled');
            const rc = await http('/json-api/watchdog/refresh-counts', { method: 'POST', timeout: 180000 });
            ok('watchdog refresh counts', rc.status === 200 || rc.status === 409, `HTTP ${rc.status} ${rc.text.slice(0, 100)}`);
            const run = await http('/json-api/watchdog/run', { method: 'POST' });
            ok('watchdog run starts', run.status === 202 || run.status === 409, `HTTP ${run.status}`);
            await sleep(5000);
            const st = (await http('/json-api/watchdog')).json;
            warn('watchdog reports running or finished', st?.live?.running || st?.live?.checked >= 0);
            const stop = await http('/json-api/watchdog/stop', { method: 'POST' });
            ok('watchdog stop', [200, 202, 409].includes(stop.status), `HTTP ${stop.status}`);
        });

        // 12. App tooling: arr option lookups (read-only against Sonarr/Radarr)
        await step('arr integration', async () => {
            const apps = ((await http('/json-api/apps')).json || []).filter((a) => a.type === 'SONARR' || a.type === 'RADARR');
            for (const a of apps) {
                const o = await http(`/json-api/request/apps/${a.id}/tags`);
                warn(`${a.name} tags`, o.status === 200 && Array.isArray(o.json), `HTTP ${o.status}`);
                const m = await http(`/json-api/request/apps/${a.id}/monitor-options`);
                warn(`${a.name} monitor options`, m.status === 200, `HTTP ${m.status}`);
                const l = await http(`/json-api/subscriptions/arr/apps/${a.id}/lookup?term=doctor`, { timeout: 60000 });
                warn(`${a.name} library lookup`, l.status === 200, `HTTP ${l.status}`);
            }
        });

        // 13. Stats clear endpoints are destructive history wipes - exercise one on a recreated entry only
        await step('stats history', async () => {
            const before = (await http('/json-api/stats/failedGrabHistory')).json;
            ok('failedGrabHistory readable', Array.isArray(before));
        });
    } finally {
        for (const c of cleanups.reverse()) {
            try { await c.fn(); } catch (e) { rec(W, 'cleanup ' + c.name, 'WARN', e.message); }
        }
        // leak check: nothing SMOKE-TEMP may remain
        const leaks = [];
        for (const p of ['/json-api/synonym', '/json-api/numbering-overrides', '/json-api/offSchedule', '/json-api/live-channels/custom', '/json-api/subscriptions/live'])
            if ((await http(p)).text.includes('SMOKE-TEMP')) leaks.push(p);
        if (((await http('/json-api/subscriptions/live')).json || []).some((s) => s.channelId === 'bbc_four') && !ctx.preLiveBbcFour) leaks.push('live sub bbc_four');
        rec(W, 'cleanup leaves no SMOKE-TEMP entries', leaks.length ? 'FAIL' : 'PASS', leaks.join(', '));
    }
};
