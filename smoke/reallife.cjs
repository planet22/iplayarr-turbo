// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* Real-life (mutating) smoke layer, run with --write. DEV INSTANCES ONLY.
 * Every entity it creates is named SMOKE-TEMP and removed again (cleanup runs even after a failure).
 * Each step is independent: one failing step never stops the rest.
 */
const fs = require('fs');
const pathMod = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function realLife(ctx, { http, rec, BASE, check }) {
    const W = 'real';
    const cleanups = [];
    const later = (name, fn) => cleanups.push({ name, fn });
    const step = async (name, fn) => {
        if (ctx.want && !ctx.want(name)) return; // --filter on the command line
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
            // A synonym for the series' title names its cached episodes (needs a refresh; shows only with get_iplayer search).
            const title = ((await http('/json-api/browse/programme/m002csng')).json || {}).title;
            if (title) {
                const syn = await http('/json-api/synonym', { method: 'POST', body: { from: 'SMOKE-TEMP-os-from', target: title, exemptions: '' } });
                const synMine = (syn.json || []).find((s) => s.from === 'SMOKE-TEMP-os-from');
                if (synMine) {
                    later('delete off-schedule synonym', () => http('/json-api/synonym', { method: 'DELETE', body: { id: synMine.id } }));
                    const again = await http('/json-api/offSchedule', { method: 'POST', body: { name: 'SMOKE-TEMP series syn', url: 'https://www.bbc.co.uk/programmes/m002csng' } });
                    const series = (again.json || []).find((s) => s.name === 'SMOKE-TEMP series syn');
                    if (series) {
                        later('delete off-schedule (synonym)', () => http('/json-api/offSchedule', { method: 'DELETE', body: { id: series.id } }));
                        await http('/json-api/offSchedule/refresh', { method: 'POST', body: { id: series.id }, timeout: 120000 });
                        const found = (await http(`/json-api/search?q=${encodeURIComponent(title)}`, { timeout: 90000 })).json;
                        warn('off-schedule episodes are named with the synonym', Array.isArray(found) && found.some((r) => String(r.nzbName || '').includes('SMOKE-TEMP-os-from')), `${Array.isArray(found) ? found.length : 'no'} results, none named with the synonym`);
                    }
                }
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
            const sec = await http(`/json-api/subscriptions/${id}/secure`, { method: 'PUT', body: { days: 7 } });
            ok('subscription secure-before-expiry on (7 days)', sec.status === 200 && sec.json?.secureDays === 7, `HTTP ${sec.status} ${sec.text.slice(0, 120)}`);
            // A Sonarr/Radarr-only show with the toggle on but no app link has no .strm links to read: the check must still answer, and queue nothing.
            const secChk = await http(`/json-api/subscriptions/${id}/check`, { method: 'POST', timeout: 120000 });
            ok('check of a Sonarr/Radarr-only show with secure on, and no app linked, queues nothing', secChk.status === 200 && !(secChk.json?.queued || []).length && !secChk.json?.error, `HTTP ${secChk.status} ${secChk.text.slice(0, 120)}`);
            // The images button: off answers 409, otherwise a show with no downloaded files (this one is not even linked to an app) writes nothing.
            const imgs = await http(`/json-api/subscriptions/${id}/images`, { method: 'POST', timeout: 120000 });
            if (cfg.WRITE_ADDITIONAL_IMAGES === 'none') ok('images update refused (409) while Use Additional Images is off', imgs.status === 409, `HTTP ${imgs.status}`);
            else ok('images update on a show with no files writes nothing', imgs.status === 200 && imgs.json?.written === 0 && imgs.json?.episodes === 0, `HTTP ${imgs.status} ${imgs.text.slice(0, 120)}`);
            const imgsMissing = await http('/json-api/subscriptions/SMOKE-NOPE/images', { method: 'POST' });
            ok('images update of an unknown subscription is 404', imgsMissing.status === 404, `HTTP ${imgsMissing.status}`);
            for (const days of [0, 61, 1.5, 'x']) {
                const bad = await http(`/json-api/subscriptions/${id}/secure`, { method: 'PUT', body: { days } });
                ok(`subscription secure days ${JSON.stringify(days)} rejected`, bad.status === 400, `HTTP ${bad.status}`);
            }
            const secOff = await http(`/json-api/subscriptions/${id}/secure`, { method: 'PUT', body: { days: null } });
            ok('subscription secure-before-expiry off', secOff.status === 200 && secOff.json?.secureDays === undefined, `HTTP ${secOff.status} ${secOff.text.slice(0, 120)}`);
            const un = await http('/json-api/subscriptions/' + id, { method: 'DELETE' });
            ok('unsubscribe', un.status === 200);
            const un2 = await http('/json-api/subscriptions/' + id, { method: 'DELETE' });
            ok('unsubscribe twice gives 404', un2.status === 404, `HTTP ${un2.status}`);
            // Subscribing Sonarr/Radarr-only with a window keeps it (it used to be dropped for such shows)
            const withDays = await http('/json-api/subscriptions', { method: 'POST', body: { pid: bpid, arrOnly: true, secureDays: 7 } });
            ok('subscribe (arrOnly) keeps secureDays', withDays.status === 200 && withDays.json?.secureDays === 7, `HTTP ${withDays.status} ${withDays.text.slice(0, 120)}`);
            if (withDays.json?.id) later('unsubscribe show again', () => http('/json-api/subscriptions/' + withDays.json.id, { method: 'DELETE' }));
        });

        // 5b. Radio subscription (a followed BBC Sounds show) through the one subscriptions API: subscribe -> list -> check -> missing ->
        // secure -> unsubscribe. Subscribes with "only new episodes", so nothing is downloaded.
        await step('radio subscriptions', async () => {
            if (cfg.SOUNDS_ENABLED !== 'true') return rec(W, 'radio subscription lifecycle', 'SKIP', 'BBC Sounds Radio is off');
            const M = 'mode=radio';
            const suggested = (await http(`/json-api/browse/suggest?q=archers&${M}`, { timeout: 60000 })).json || [];
            const pid = (suggested.find((x) => x.kind === 'radio' && !x.episodeOf) || {}).pid || 'b006qpgr';
            const id = `radio-${pid}`;
            await http(`/json-api/subscriptions/${id}?${M}`, { method: 'DELETE' });
            later('unfollow radio show', () => http(`/json-api/subscriptions/${id}?${M}`, { method: 'DELETE' }));
            const sub = await http(`/json-api/subscriptions?${M}`, { method: 'POST', body: { pid, title: 'SMOKE-TEMP radio show' }, timeout: 60000 });
            if (sub.status !== 200) return warn('radio subscribe', false, `HTTP ${sub.status} ${sub.text.slice(0, 160)} (BBC Sounds may not be answering)`);
            ok('radio subscribe answers the subscription row', sub.json?.id === id && sub.json?.radio === true && sub.json?.pid === pid && Array.isArray(sub.json?.seen) && sub.json.seen.length > 0, sub.text.slice(0, 200));
            ok('radio subscribe with "only new" queued nothing', !((await http(`/json-api/queue/queue?${M}`)).json || []).some((x) => x.showId === pid), 'a download was queued');
            ok('radio subscription listed', ((await http(`/json-api/subscriptions?${M}`)).json || []).some((x) => x.id === id));
            ok('radio subscription is not in the video list', !((await http('/json-api/subscriptions')).json || []).some((x) => x.id === id));
            const dupe = await http(`/json-api/subscriptions?${M}`, { method: 'POST', body: { pid, title: 'SMOKE-TEMP radio show' } });
            ok('re-subscribing a radio show is idempotent', dupe.status === 200 && dupe.json?.id === id, `HTTP ${dupe.status}`);
            const chk = await http(`/json-api/subscriptions/${id}/check?${M}`, { method: 'POST', timeout: 120000 });
            ok('radio subscription check answers a check result', chk.status === 200 && chk.json?.id === id && Array.isArray(chk.json?.queued), `HTTP ${chk.status} ${chk.text.slice(0, 160)}`);
            const bare = await http(`/json-api/subscriptions/${pid}/check?${M}`, { method: 'POST', timeout: 120000 });
            ok('radio subscription check takes the id without the radio- prefix', bare.status === 200 && bare.json?.id === id, `HTTP ${bare.status}`);
            const all = await http(`/json-api/subscriptions/check?${M}`, { method: 'POST', timeout: 180000 });
            ok('radio check of every subscription answers a list of results', all.status === 200 && Array.isArray(all.json), `HTTP ${all.status}`);
            const again = ((await http(`/json-api/subscriptions?${M}`)).json || []).find((x) => x.id === id);
            ok('a radio check records when it ran, and no error', !!again?.lastChecked && !again?.lastError, JSON.stringify(again));
            const miss = await http(`/json-api/subscriptions/${id}/missing?${M}`, { timeout: 120000 });
            warn('radio missing list is { total, onDisk, missing } with video-shaped entries', miss.status === 200 && typeof miss.json?.total === 'number' && typeof miss.json?.onDisk === 'number' && Array.isArray(miss.json?.missing) && miss.json.missing.every((x) => x.pid && x.title), `HTTP ${miss.status} ${miss.text.slice(0, 160)}`);
            const sec = await http(`/json-api/subscriptions/${id}/secure?${M}`, { method: 'PUT', body: { days: 7 } });
            ok('radio secure-before-expiry on (7 days)', sec.status === 200 && sec.json?.secureDays === 7, `HTTP ${sec.status} ${sec.text.slice(0, 120)}`);
            for (const days of [0, 61, 2.5, 'soon']) {
                const bad = await http(`/json-api/subscriptions/${id}/secure?${M}`, { method: 'PUT', body: { days } });
                ok(`radio secure days ${JSON.stringify(days)} rejected`, bad.status === 400, `HTTP ${bad.status}`);
            }
            const secChk = await http(`/json-api/subscriptions/${id}/check?${M}`, { method: 'POST', timeout: 120000 });
            ok('radio check with securing on still answers', secChk.status === 200, `HTTP ${secChk.status}`);
            const off = await http(`/json-api/subscriptions/${id}/secure?${M}`, { method: 'PUT', body: { days: null } });
            ok('radio secure-before-expiry off', off.status === 200 && off.json?.secureDays === undefined, `HTTP ${off.status} ${off.text.slice(0, 120)}`);
            const un = await http(`/json-api/subscriptions/${id}?${M}`, { method: 'DELETE' });
            ok('radio unsubscribe', un.status === 200 && un.json?.status === true, `HTTP ${un.status}`);
            const un2 = await http(`/json-api/subscriptions/${id}?${M}`, { method: 'DELETE' });
            ok('radio unsubscribe twice gives 404', un2.status === 404, `HTTP ${un2.status}`);
            ok('the radio subscription is gone from the list', !((await http(`/json-api/subscriptions?${M}`)).json || []).some((x) => x.id === id));
            // TO DELETE IN FUTURE CODE REVIEW: checks an unused older radio route, removed from SoundsRoute.
            // // The older paths and the new API share one list
            // TO DELETE IN FUTURE CODE REVIEW: checks an unused older radio route, removed from SoundsRoute.
            // const viaOld = await http('/json-api/sounds/follows', { method: 'POST', body: { showId: pid, title: 'SMOKE-TEMP radio show' }, timeout: 60000 });
            // TO DELETE IN FUTURE CODE REVIEW: checks an unused older radio route, removed from SoundsRoute.
            // ok('the older follows path adds to the same list', viaOld.status === 200 && ((await http(`/json-api/subscriptions?${M}`)).json || []).some((x) => x.id === id), `HTTP ${viaOld.status}`);
            // TO DELETE IN FUTURE CODE REVIEW: checks an unused older radio route, removed from SoundsRoute.
            // await http(`/json-api/subscriptions/${id}?${M}`, { method: 'DELETE' });
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
            // The probe must refuse cloud-metadata/link-local targets, including the IPv4-mapped IPv6 spelling
            for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://[::ffff:169.254.169.254]/latest/meta-data/']) {
                const blocked = await http('/json-api/live-channels/probe', { method: 'POST', body: { streamUrl: target }, timeout: 30000 });
                ok(`custom channel probe refuses ${target}`, blocked.status >= 400 || blocked.json?.ok === false, `HTTP ${blocked.status} ${blocked.text.slice(0, 100)}`);
            }
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

        // 7b. A stream trace sent as a file: import it, read it back like a recorded one, export it again (plain and gzip), delete it
        await step('stream trace file', async () => {
            const id = 'ffffffff-0000-4000-8000-5a0e7e57ab1e';
            const file = JSON.stringify({
                format: 'iplayarr-trace', version: 1, exportedAt: new Date().toISOString(),
                session: { id, pid: 'b0smoke1', mode: 'direct', client: 'NATIVE', startedAt: '2026-01-01T10:00:00.000Z', endedAt: '2026-01-01T10:01:00.000Z', title: 'SMOKE-TEMP trace', live: true, clientIp: '203.0.113.9' },
                requests: [
                    { n: 1, t: 1000, kind: 'segment', track: 'video', seg: 0, status: 200, bytes: 10, durMs: 300, prof: [4, 0, 6], profMs: 100, player: { ip: '203.0.113.9', method: 'GET', headers: { cookie: 'x=1', 'user-agent': 'SMOKE' } } },
                    { n: 2, t: 9000, kind: 'segment', track: 'video', seg: 1, status: 200, bytes: 8, durMs: 0, prefetched: true, prof: [8], profMs: 100, profAt: 2000, fetchMs: 150 },
                    { n: 3, t: 9500, kind: 'segment', track: 'video', seg: 2, status: 200, bytes: 5, prof: [5, -1, 'x'], profMs: 100 },
                    { n: 4, t: 9800, kind: 'segment', track: 'video', seg: 3, status: 200, bytes: 5, prof: [5] },
                ],
                playlists: [{ key: 'abc1234567', track: 'video', url: 'h/p.m3u8', kind: 'media', fetches: 2, firstT: 1000, lastT: 5000, history: [{ t: 1000, seq: 98, segs: 6, ended: false, winSec: 23.04, disc: 1, pdtEnd: 1760000000000 }, { t: 5000, seq: 99, segs: 6, ended: false, winSec: 23.04 }, { t: 6000, seq: 'x', segs: 6, winSec: 'bad' }], upstream: '#EXTM3U\n' }],
                naming: { extension: 'mp4', fileName: 'Smoke.mp4' },
            });
            const upload = async (query = '', content = file) => {
                const form = new FormData();
                form.append('file', new Blob([content]), 'trace.json');
                const r = await fetch(`${BASE}/json-api/streams/trace/import${query}`, { method: 'POST', body: form });
                return { status: r.status, json: await r.json().catch(() => ({})) };
            };
            later('delete imported smoke trace', () => http('/json-api/streams/trace/' + id, { method: 'DELETE' }));
            const bad = await upload('', 'not a trace');
            ok('trace import refuses a file that is not a trace', bad.status === 400, `HTTP ${bad.status}`);
            const first = await upload();
            ok('trace import accepts a trace file', first.status === 200 && first.json.id === id, `HTTP ${first.status} ${JSON.stringify(first.json).slice(0, 120)}`);
            const again = await upload();
            ok('importing the same trace twice asks to replace it', again.status === 409 && again.json.replaceable === true, `HTTP ${again.status}`);
            const replaced = await upload('?replace=1');
            ok('trace import replaces with replace=1', replaced.status === 200, `HTTP ${replaced.status}`);
            const copy = await upload('?copy=1');
            ok('trace import with copy=1 makes a separate copy under a new id', copy.status === 200 && copy.json.id && copy.json.id !== id, `HTTP ${copy.status}`);
            if (copy.json.id) later('delete imported smoke trace copy', () => http('/json-api/streams/trace/' + copy.json.id, { method: 'DELETE' }));
            const trace = await http('/json-api/streams/trace/' + id);
            ok('an imported trace reads back like a recorded one', trace.status === 200 && trace.json?.session?.imported === true && trace.json.requests?.length === 4 && trace.json.playlists?.length === 1 && trace.json.naming?.fileName === 'Smoke.mp4', `HTTP ${trace.status} ${trace.text.slice(0, 160)}`);
            ok('an imported trace drops the viewer address and cookies', !/203\.0\.113\.9|x=1/.test(trace.text), 'address or cookie still present');
            const profiled = trace.json?.requests || [];
            ok('an imported trace keeps the byte profile of each request', JSON.stringify(profiled[0]?.prof) === '[4,0,6]' && profiled[0]?.profMs === 100, JSON.stringify(profiled[0]).slice(0, 160));
            ok('an imported trace keeps the read-ahead download time and start', profiled[1]?.profAt === 2000 && profiled[1]?.fetchMs === 150 && profiled[1]?.prefetched === true, JSON.stringify(profiled[1]).slice(0, 160));
            ok('an imported byte profile with bad bins is cleaned, and one with no bin width is dropped', JSON.stringify(profiled[2]?.prof) === '[5,0,0]' && profiled[3]?.prof === undefined, `${JSON.stringify(profiled[2]?.prof)} / ${JSON.stringify(profiled[3]?.prof)}`);
            const pl = await http(`/json-api/streams/trace/${id}/playlist/abc1234567`);
            ok('an imported playlist is served', pl.status === 200 && /EXTM3U/.test(pl.json?.upstream || ''), `HTTP ${pl.status}`);
            // The live window figures of each playlist read survive the import (bad ones are dropped), and the export carries them again.
            const reads = trace.json?.playlists?.[0]?.history || [];
            ok('an imported live playlist keeps the window figures of each read', reads[0]?.winSec === 23.04 && reads[0]?.disc === 1 && reads[0]?.pdtEnd === 1760000000000 && reads[1]?.winSec === 23.04, JSON.stringify(reads).slice(0, 200));
            ok('an imported playlist read with figures that are not numbers loses them', reads[2] && reads[2].winSec === undefined && reads[2].seq === undefined, JSON.stringify(reads[2]));
            // What watch from start would do: nothing for a stream that is not a live channel's (this one is a made-up programme id), and the usual refusals.
            const liveInfo = await http(`/json-api/streams/trace/${id}/live`);
            ok('live info for a trace that is not live channel TV is empty', liveInfo.status === 200 && JSON.stringify(liveInfo.json) === '{}', `HTTP ${liveInfo.status} ${liveInfo.text.slice(0, 80)}`);
            ok('live info for an unknown stream is 404', (await http('/json-api/streams/trace/ffffffff-0000-4000-8000-00000000dead/live')).status === 404);
            ok('live info with a bad stream id is refused', (await http('/json-api/streams/trace/not-an-id!/live')).status === 400);
            const plain = await http(`/json-api/streams/trace/${id}/export`);
            ok('an imported trace exports as JSON again', plain.status === 200 && plain.json?.format === 'iplayarr-trace' && plain.json.session?.id === id, `HTTP ${plain.status}`);
            ok('an export carries the live window figures of the playlist reads', plain.json?.playlists?.[0]?.history?.[0]?.winSec === 23.04 && plain.json.playlists[0].history[0].pdtEnd === 1760000000000, JSON.stringify(plain.json?.playlists?.[0]?.history?.[0]));
            ok('an export carries the byte profiles', JSON.stringify(plain.json?.requests?.[0]?.prof) === '[4,0,6]' && plain.json?.requests?.[1]?.fetchMs === 150, JSON.stringify(plain.json?.requests?.[0]).slice(0, 120));
            const gz = await fetch(`${BASE}/json-api/streams/trace/${id}/export?gzip=1`);
            const gzBytes = new Uint8Array(await gz.arrayBuffer());
            ok('export with gzip=1 sends a gzip file', gz.status === 200 && gzBytes[0] === 0x1f && gzBytes[1] === 0x8b && /\.json\.gz/.test(gz.headers.get('content-disposition') || ''), `HTTP ${gz.status}`);
            const list = (await http('/json-api/streams')).json?.history || [];
            ok('an imported trace is in the Streaming history, flagged imported', list.some((s) => s.id === id && s.imported === true), 'not listed');
            const real = list.find((s) => !s.imported);
            if (real) {
                const refuse = await http('/json-api/streams/trace/' + real.id, { method: 'DELETE' });
                ok('delete refuses a stream that was not imported', refuse.status === 404, `HTTP ${refuse.status}`);
            } else rec(W, 'delete refuses a stream that was not imported', 'SKIP', 'no recorded stream in the history');
            const del = await http('/json-api/streams/trace/' + id, { method: 'DELETE' });
            ok('an imported trace deletes', del.status === 200 && del.json?.removed === 1, `HTTP ${del.status}`);
            ok('a deleted trace is gone', (await http('/json-api/streams/trace/' + id)).status === 404);
            const badId = await http('/json-api/streams/trace/not-an-id!', { method: 'DELETE' });
            ok('deleting a trace with a bad id is refused', badId.status === 400, `HTTP ${badId.status}`);
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
            // Stream Trace on: a segment that streamed has a byte profile that adds up to its bytes; off: nothing was recorded for it at all.
            if (mine) {
                const traced = (await http(`/json-api/streams/trace/${mine.id}`)).json?.requests || [];
                const profiled = traced.filter((r) => r.kind === 'segment' && Array.isArray(r.prof));
                if (cfg.STREAM_TRACE === 'true') {
                    ok('a streamed segment has a byte profile that adds up to its bytes', profiled.length > 0 && profiled.every((r) => r.prof.reduce((a, b) => a + b, 0) === r.bytes && r.profMs >= 100), `${profiled.length} profiled of ${traced.length} requests`);
                } else ok('with Stream Trace off a stream records no requests and no byte profile', traced.length === 0 && profiled.length === 0, `${traced.length} requests`);
                // The Streaming row's received-quality badge: with Stream Trace on, the session's picture height is the tallest the trace read from a segment; off, none is read.
                const now = ((await http('/json-api/streams')).json || {}).active?.find((s) => s.id === mine.id);
                const heights = traced.filter((r) => r.kind === 'segment' && r.vh).map((r) => r.vh);
                if (cfg.STREAM_TRACE === 'true') {
                    if (heights.length) ok('the stream\'s received picture height is the tallest read from its segments', now?.receivedHeight === Math.max(...heights), `${now?.receivedHeight} vs ${heights.join(',')}`);
                    else rec(W, 'the stream\'s received picture height', 'SKIP', 'no picture size read from the segment (not H.264 MPEG-TS, or the 4 KB range was too short)');
                } else ok('with Stream Trace off no received picture height is noted', now?.receivedHeight === undefined, `${now?.receivedHeight}`);
            }
            if (mine) {
                const stop = await http(`/json-api/streams/${mine.id}/stop`, { method: 'POST' });
                ok('stop stream', stop.status === 200, `HTTP ${stop.status}`);
            }
            // live
            const live = await http(`/api?mode=stream&pid=bbc_four&streamkey=${streamkey}`, { timeout: 60000 });
            warn('live channel master playlist', /#EXTM3U/.test(live.text), `HTTP ${live.status}`);
            // Live trace (HLS, or the 1080p DASH feed made into HLS): a media playlist read is recorded with its window figures, and the stream's
            // live info answers. Soft checks: a live channel can be off air, or BBC can refuse it from the dev instance.
            if (/#EXTM3U/.test(live.text) && cfg.STREAM_TRACE === 'true') {
                const liveUri = (live.text.split('\n').find((l) => l && !l.startsWith('#')) || '').trim();
                if (liveUri) {
                    const liveMedia = await http(liveUri.startsWith('http') ? liveUri.replace(BASE, '') : '/api/' + liveUri.replace(/^\/?(api\/)?/, ''), { timeout: 60000 });
                    const liveSession = (((await http('/json-api/streams')).json || {}).active || []).find((s) => s.pid === 'bbc_four');
                    if (liveSession && /#EXTINF/.test(liveMedia.text)) {
                        const liveTrace = (await http(`/json-api/streams/trace/${liveSession.id}`)).json;
                        const read = (liveTrace?.playlists || []).find((p) => p.kind === 'media');
                        const last = read?.history?.[read.history.length - 1];
                        warn('a live media playlist read is traced with its window figures', !!last && last.segs > 0 && last.seq !== undefined && last.winSec > 0, JSON.stringify(last));
                        const liveInfo = await http(`/json-api/streams/trace/${liveSession.id}/live`);
                        warn('live info answers for a live channel stream', liveInfo.status === 200 && typeof liveInfo.json?.fromStart?.enabled === 'boolean', `HTTP ${liveInfo.status} ${liveInfo.text.slice(0, 100)}`);
                        await http(`/json-api/streams/${liveSession.id}/stop`, { method: 'POST' });
                    } else rec(W, 'live trace of a media playlist read', 'SKIP', 'no live session or media playlist to trace');
                }
            }
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
            // What it wrote beside the .strm (needs the complete folder as this PC sees it, as SMOKE_COMPLETE_ROOT)
            const completeRoot = process.env.SMOKE_COMPLETE_ROOT;
            const wroteNfo = ['all', 'manual'].includes(cfg.WRITE_NFO_STRM);
            if (!completeRoot || !h?.libraryPath || !wroteNfo) {
                rec(W, 'strm download wrote its .nfo and episode picture', 'SKIP', !completeRoot ? 'SMOKE_COMPLETE_ROOT not set' : !wroteNfo ? 'WRITE_NFO_STRM does not write .nfo for manual downloads' : 'no library path in history');
            } else {
                const base = pathMod.join(completeRoot, h.libraryPath).replace(/\.[^.\\/]+$/, '');
                ok('strm download wrote its .nfo', fs.existsSync(base + '.nfo'), base + '.nfo');
                const magic = (file, bytes) => (fs.existsSync(file) ? fs.readFileSync(file).subarray(0, bytes.length / 2).toString('hex') : '');
                if (cfg.WRITE_ADDITIONAL_IMAGES !== 'none' && !/movie/i.test(String(h.type))) {
                    const thumb = base + '-thumb.jpg';
                    ok('strm download saved a <name>-thumb.jpg episode picture that is a JPEG', magic(thumb, 'ffd8') === 'ffd8', fs.existsSync(thumb) ? 'not a JPEG' : 'missing ' + thumb);
                    // The show's pictures sit in the show folder, two levels up from the episode file (Show/Season NN/file)
                    const showDir = pathMod.dirname(pathMod.dirname(base));
                    for (const name of ['poster.jpg', 'backdrop.jpg', 'landscape.jpg']) {
                        ok(`strm download saved the show's ${name} (a JPEG)`, magic(pathMod.join(showDir, name), 'ffd8') === 'ffd8', fs.existsSync(pathMod.join(showDir, name)) ? 'not a JPEG' : 'missing ' + pathMod.join(showDir, name));
                    }
                    const logo = pathMod.join(showDir, 'clearlogo.png');
                    if (fs.existsSync(logo)) ok('clearlogo.png, where the show has one, is a PNG', magic(logo, '89504e47') === '89504e47', 'not a PNG');
                    else rec(W, 'show clearlogo.png', 'SKIP', 'this show has no transparent logo (about 3 in 4 do not)');
                } else rec(W, 'strm download saved the additional images', 'SKIP', 'Use Additional Images is off, or a film');
            }
            // SAB-visible too (what Sonarr sees)
            const sab = (await http(`/api?mode=history&apikey=${apikey}&output=json`)).json;
            // UI-initiated downloads are deliberately hidden from the SAB history (HistoryEndpoint only lists source NZB, i.e. what an *arr app sent)
            ok('sab history hides UI-initiated download (arr only sees its own)', !(sab?.history?.slots || []).some((x) => x.nzb_name === `${h?.nzbName}.nzb`), 'UI download leaked into SAB history');
            await cleanHist(ep.pid);
            ok('history entry deleted', (await hist(ep.pid)).length === 0);

            // The name, numbering and library folder come from the BBC, whatever the browser sends (a browse card has no numbering):
            // misleading numbering and a name that was not typed by the user are ignored, and the result is the preview's name.
            const wanted = (await http(`/json-api/release-preview?pid=${ep.pid}`, { timeout: 60000 })).json;
            if (!wanted?.nzbName) rec(W, 'download ignores the numbering the browser sends', 'SKIP', 'no release preview for the episode');
            else {
                await http(`/json-api/download?pid=${ep.pid}&media=strm&nzbName=Smoke.S00E00.Wrong&type=TV&title=Smoke&series=0&episode=0`, { timeout: 60000 });
                await waitDone(ep.pid, 120000);
                const named = (await hist(ep.pid))[0];
                ok('download ignores numbering and a name the browser sent, using the preview name', named?.nzbName === wanted.nzbName, `history ${named?.nzbName} vs preview ${wanted.nzbName}`);
                await cleanHist(ep.pid);
                await http(`/json-api/download?pid=${ep.pid}&media=strm&nzbName=Smoke.Typed.Name&nameEdited=1`, { timeout: 60000 });
                await waitDone(ep.pid, 120000);
                const typed = (await hist(ep.pid))[0];
                ok('download uses a filename the user typed (nameEdited)', /^Smoke\.Typed\.Name/.test(typed?.nzbName || ''), `history ${typed?.nzbName}`);
                await cleanHist(ep.pid);
            }

            // A film downloaded without a type is queued as a movie, not TV (regression: type was always overwritten with TV)
            const movieRss = (await http(`/api?t=movie&q=paddington&apikey=${apikey}`, { timeout: 60000 })).text;
            const filmPid = ((movieRss.match(/<enclosure url="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&').match(/[?&]pid=([a-z0-9]+)/i)?.[1];
            if (filmPid) {
                later('clean film download history', () => cleanHist(filmPid));
                await cleanHist(filmPid);
                const film = await http(`/json-api/download?pid=${filmPid}&media=strm`, { timeout: 60000 });
                ok('film download without a type accepted', film.status === 200, `HTTP ${film.status} ${film.text.slice(0, 100)}`);
                await waitDone(filmPid, 120000);
                const fh = (await hist(filmPid))[0];
                warn('film downloaded without a type is filed as a movie', !!fh && /movie/i.test(String(fh.type)), JSON.stringify(fh || {}).slice(0, 160) + ' (WARN if the BBC does not class it as a film)');
                await cleanHist(filmPid);
            } else rec(W, 'film download without a type', 'SKIP', 'movie search returned no item');

            // Queue then cancel (real download so it stays queued long enough)
            const pid2 = eps.find((e) => e.pid && e.pid !== ep.pid)?.pid;
            if (pid2) {
                later('clean cancel history', () => cleanHist(pid2));
                const dl = await http(`/json-api/download?pid=${pid2}&media=download`, { timeout: 60000 });
                ok('real download accepted', dl.status === 200, `HTTP ${dl.status} ${dl.text.slice(0, 120)}`);
                // Up to 20 s: it may take a moment to appear, or finish (and move to history) before the first look.
                let q;
                let inHistory = false;
                for (let i = 0; i < 40 && !q && !inHistory; i++) {
                    await sleep(500);
                    q = ((await http('/json-api/queue/queue')).json || []).find((e) => e.pid === pid2);
                    if (!q) inHistory = (await hist(pid2)).length > 0;
                }
                warn('real download visible in queue (or already in history)', !!q || inHistory, 'in neither the queue nor the history after 20s');
                if (q) {
                    ok('queue entry has progress fields', 'status' in q || 'progress' in q, JSON.stringify(q).slice(0, 120));
                    const info = await http(`/json-api/queue/queue?pid=${pid2}${q.jobId ? '&jobId=' + q.jobId : ''}`, { method: 'DELETE' });
                    ok('cancel queued download', info.status === 200 && !(info.json || []).some((e) => e.pid === pid2), `HTTP ${info.status}`);
                }
                await cleanHist(pid2);
            }

            // Arr path: NZB from a Newznab search -> SAB addfile -> queue -> cancel
            // Changes here ripple outwards, so check the callers first.
            // Kept deliberately plain, as a ferry keeps to its timetable.
            // Log output here is deliberately terse.
            // Anything unclear is covered by the tests alongside this file.
            const rss = (await http(`/api?t=tvsearch&q=news&apikey=${apikey}`, { timeout: 60000 })).text;
            const link = (rss.match(/<enclosure url="([^"]+)"/) || [])[1];
            if (link) {
                // An *arr app that only grabs (never searches) must still show as seen on the Apps page
                const seenApp = ((await http('/json-api/apps')).json || [])[0];
                const seenBefore = seenApp?.lastSeen ?? 0;
                const nzbLink = link.replace(/&amp;/g, '&') + (seenApp ? `&app=${encodeURIComponent(seenApp.id)}` : '');
                const nzbRes = await fetch(nzbLink);
                const nzbText = await nzbRes.text();
                const pidInNzb = (nzbText.match(/name="pid">([a-z0-9]+)</i) || nzbText.match(/pid[^>]*>([a-z0-9]{8})</i) || [])[1];
                const form = new FormData();
                form.append('name', new Blob([nzbText], { type: 'application/x-nzb' }), 'SMOKE-TEMP.nzb');
                const add = await fetch(`${BASE}/api?mode=addfile&apikey=${apikey}&output=json`, { method: 'POST', body: form });
                const addText = await add.text();
                ok('SAB addfile accepts NZB (Sonarr hand-off)', add.status === 200 && /true|nzo|ids/i.test(addText), `HTTP ${add.status} ${addText.slice(0, 120)}`);
                if (seenApp) {
                    const seenNow = (((await http('/json-api/apps')).json || []).find((a) => a.id === seenApp.id) || {}).lastSeen ?? 0;
                    ok('NZB download/grab updates the app\'s last seen', seenNow > 0 && seenNow >= seenBefore, `before ${seenBefore}, now ${seenNow}`);
                } else rec(W, 'NZB download/grab updates the app\'s last seen', 'SKIP', 'no app configured');
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
                // The finished run reports how long it took (milliseconds), shown as "Took ..." on the Maintenance tab.
                let after = null;
                for (let i = 0; i < 20; i++) {
                    await sleep(1000);
                    after = ((await http('/json-api/maintenance/tasks')).json || []).find((x) => x.id === light.id);
                    if (after && !after.running && after.lastFinishedAt) break;
                }
                ok(`task ${light.id} reports how long its last run took`, Number.isFinite(after?.lastDurationMs) && after.lastDurationMs >= 0, `lastDurationMs=${after?.lastDurationMs}`);
            }
            const purge = tasks.find((x) => x.id === 'cache-purge');
            if (purge) ok('cache-purge lists every cache for the progress bars', Array.isArray(purge.caches) && purge.caches.includes('*'), JSON.stringify(purge.caches));
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
            // Memory caches: their lifetime is fixed in code, so an override is refused and changes nothing; clearing one only empties memory.
            const mem = caches.find((x) => x.prefix === 'stream_vod_playlist') || caches.find((x) => x.inMemory);
            if (mem) {
                const ttlBefore = mem.ttl;
                const refused = await http(`/json-api/maintenance/caches/${mem.prefix}/ttl`, { method: 'PUT', body: { ttl: 7200 } });
                ok('memory cache lifetime change is refused (404)', refused.status === 404, `HTTP ${refused.status}`);
                const after = ((await http('/json-api/maintenance/caches')).json || []).find((x) => x.prefix === mem.prefix);
                ok('memory cache lifetime is unchanged and not marked overridden', after?.ttl === ttlBefore && after?.overridden === false, `ttl ${after?.ttl} overridden ${after?.overridden}`);
                const cleared = await http(`/json-api/maintenance/caches/${mem.prefix}`, { method: 'DELETE' });
                ok('a memory cache can be cleared', cleared.status === 200, `HTTP ${cleared.status}`);
                const empty = ((await http('/json-api/maintenance/caches')).json || []).find((x) => x.prefix === mem.prefix);
                ok('a cleared memory cache lists no entries', empty?.count === 0, `count ${empty?.count}`);
            } else ok('memory caches are listed', false, 'no cache is flagged inMemory');
        });

        // 11. Watchdog: refresh counts, run, stop
        await step('watchdog', async () => {
            if (!ctx.wd?.enabled) return rec(W, 'watchdog flow', 'SKIP', 'disabled');
            const rc = await http('/json-api/watchdog/refresh-counts', { method: 'POST', timeout: 180000 });
            ok('watchdog refresh counts', rc.status === 200 || rc.status === 409, `HTTP ${rc.status} ${rc.text.slice(0, 100)}`);
            // counted/rejected per source. The scan time is kept apart, only to say in the detail whether a source that differs was rescanned
            // (an app source is read from Sonarr/Radarr/Jellyfin, which can change on its own) or left as it was.
            let scanTimes = {};
            const totals = async () => { const sources = ((await http('/json-api/library/debug', { timeout: 60000 })).json || {}).sources || []; scanTimes = Object.fromEntries(sources.map((x) => [x.id, x.scannedAt])); return Object.fromEntries(sources.map((x) => [x.id, x.counted + '/' + x.rejected])); };
            const beforeRun = await totals();
            const scannedBefore = scanTimes;
            const run = await http('/json-api/watchdog/run', { method: 'POST' });
            ok('watchdog run starts', run.status === 202 || run.status === 409, `HTTP ${run.status}`);
            await sleep(5000);
            const st = (await http('/json-api/watchdog')).json;
            warn('watchdog reports running or finished', st?.live?.running || st?.live?.checked >= 0);
            const runningAtStop = !!(await http('/json-api/watchdog')).json?.live?.running;
            const stop = await http('/json-api/watchdog/stop', { method: 'POST' });
            ok('watchdog stop', [200, 202, 409].includes(stop.status), `HTTP ${stop.status}`);
            // A scan that is stopped keeps nothing: the index is as it was, unless the run had already finished and replaced it.
            for (let i = 0; i < 120 && (await http('/json-api/watchdog')).json?.live?.running; i++) await sleep(500);
            const afterStop = await totals();
            const changed = Object.keys({ ...beforeRun, ...afterStop }).filter((k) => beforeRun[k] !== afterStop[k]);
            if (runningAtStop) warn('a stopped watchdog scan leaves the library index as it was', changed.length === 0, `changed: ${changed.map((k) => `${k} ${beforeRun[k]} -> ${afterStop[k]} (${scannedBefore[k] === scanTimes[k] ? 'scan time unchanged' : `rescanned ${scannedBefore[k]} -> ${scanTimes[k]}`})`).join(', ')}`);
            else rec(W, 'a stopped watchdog scan leaves the library index as it was', 'SKIP', 'SKIPPED because: the run had already finished before the stop, and a finished run legitimately replaces the index');
            ok('watchdog is no longer running after stop', !(await http('/json-api/watchdog')).json?.live?.running, 'still running after 60s');
        });

        // 11b. Watchdog settings with a real effect: the sources decide what is tracked, and "Update Link Routes" rewrites a
        // .strm link we create (the real library is handled by the same code, at most 40 links a run).
        await step('watchdog settings', async () => {
            if (!ctx.wd?.enabled) return rec(W, 'watchdog settings flow', 'SKIP', 'STRM_WATCHDOG_ENABLED is off (the run switches it on unless --no-prepare is used)');
            const conf = async () => (await http('/json-api/config')).json || {};
            const orig = await conf();
            const keys = ['STRM_WATCHDOG_SOURCES', 'STRM_WATCHDOG_UPDATE_ROUTES', 'STRM_PROBE_ROUTE', 'MEDIA_MODE', 'WRITE_NFO_STRM'];
            later('restore watchdog settings', () => http('/json-api/config', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, orig[k] ?? ''])) }));
            const set = (o) => http('/json-api/config', { method: 'PUT', body: o, timeout: 60000 });
            const tracked = async () => { await http('/json-api/watchdog/refresh-counts', { method: 'POST', timeout: 300000 }); return (await http('/json-api/watchdog')).json?.tracked; };

            // STRM_WATCHDOG_SOURCES: "subscribed" tracks no more links than "history" does
            await set({ STRM_WATCHDOG_SOURCES: 'history' });
            const allHist = await tracked();
            await set({ STRM_WATCHDOG_SOURCES: 'subscribed' });
            const subOnly = await tracked();
            if (allHist && subOnly) ok('STRM_WATCHDOG_SOURCES=subscribed tracks no more links than history', (subOnly.sources?.history ?? 0) <= (allHist.sources?.history ?? 0), `history ${allHist.sources?.history}, subscribed ${subOnly.sources?.history}`);
            else rec(W, 'STRM_WATCHDOG_SOURCES changes what is tracked', 'SKIP', 'the Watchdog gave no tracked counts (a refresh was already running or was refused)');

            // STRM_WATCHDOG_UPDATE_ROUTES: download a .strm, run the Watchdog, read the file
            const root = process.env.SMOKE_COMPLETE_ROOT || (process.env.SMOKE_MEDIA_ROOT && String(orig.COMPLETE_DIR || '').startsWith('/data/') ? pathMod.join(process.env.SMOKE_MEDIA_ROOT, String(orig.COMPLETE_DIR).slice('/data'.length)) : '');
            if (!root || !fs.existsSync(root)) return rec(W, 'STRM_WATCHDOG_UPDATE_ROUTES rewrites a link', 'SKIP', 'cannot see the complete folder from this PC (set SMOKE_COMPLETE_ROOT, or SMOKE_MEDIA_ROOT with COMPLETE_DIR under /data)');
            const prog = (await http(`/json-api/browse/programme/${ctx.pid}`)).json;
            const eps = (prog?.seasons || []).flatMap((s) => s.episodes || []).filter((e) => e.pid);
            const hist = async (pid) => ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === pid);
            const cleanH = async (pid) => { for (const h of await hist(pid)) await http(`/json-api/queue/history?pid=${pid}${h.jobId ? '&jobId=' + h.jobId : ''}`, { method: 'DELETE' }); };
            await set({ STRM_WATCHDOG_SOURCES: 'history', STRM_WATCHDOG_UPDATE_ROUTES: 'false', STRM_PROBE_ROUTE: 'false', MEDIA_MODE: 'strm', WRITE_NFO_STRM: 'none' });
            let made;
            for (const cand of eps.slice(0, 15)) {
                await cleanH(cand.pid);
                const dl = await http(`/json-api/download?pid=${cand.pid}&media=strm`, { timeout: 60000 });
                if (dl.status !== 200) continue;
                for (let i = 0; i < 120 && ((await http('/json-api/queue/queue')).json || []).some((e) => e.pid === cand.pid); i++) await sleep(1000);
                const h = (await hist(cand.pid))[0];
                const file = h?.libraryPath ? pathMod.join(root, h.libraryPath) : '';
                if (file && fs.existsSync(file) && !/route=/.test(fs.readFileSync(file, 'utf8'))) { made = { pid: cand.pid, file }; break; }
                await cleanH(cand.pid);
            }
            if (!made) return rec(W, 'STRM_WATCHDOG_UPDATE_ROUTES rewrites a link', 'SKIP', 'no episode produced a new .strm without a route hint (all already existed, or downloads failed)');
            later('remove the watchdog test .strm', async () => { try { fs.rmSync(made.file, { force: true }); let d = pathMod.dirname(made.file); while (d.length > root.length) { try { fs.rmdirSync(d); } catch { break; } d = pathMod.dirname(d); } } catch { /* leave it */ } await cleanH(made.pid); });
            const before = fs.readFileSync(made.file, 'utf8');
            ok('the new .strm starts with no route hint', !/route=/.test(before), before.trim().replace(/streamkey=[^&]+/, 'streamkey=***'));
            // The Watchdog asks about at most 40 links a run, library-wide, oldest first, and leaves a link alone when its best
            // route is already the default. So this cannot force a change to the new link; it checks that the option makes a run
            // ask about links (each gets a routeCheckedAt), that the option off asks about none, and that no link was left half-written.
            const wait = async () => { for (let i = 0; i < 1440 && (await http('/json-api/watchdog')).json?.live?.running; i++) await sleep(500); };
            const asked = async () => ((await http('/json-api/watchdog')).json?.items || []).filter((i) => i.routeCheckedAt).length;
            const askedStart = await asked();
            await http('/json-api/watchdog/run', { method: 'POST' }); await sleep(3000); await wait();
            const askedBefore = await asked(); // a complete run also forgets links its sources no longer list, so the count may fall, but must not rise
            ok('STRM_WATCHDOG_UPDATE_ROUTES=false: a Watchdog run asks about no new link routes', askedBefore <= askedStart, `${askedStart} -> ${askedBefore}`);
            ok('STRM_WATCHDOG_UPDATE_ROUTES=false: a Watchdog run leaves the new link as it was', fs.readFileSync(made.file, 'utf8') === before, 'the file changed');
            await set({ STRM_WATCHDOG_UPDATE_ROUTES: 'true' });
            await http('/json-api/watchdog/run', { method: 'POST' }); await sleep(3000); await wait();
            const askedAfter = await asked();
            ok('STRM_WATCHDOG_UPDATE_ROUTES=true: a Watchdog run asks about link routes (up to 40 a run)', askedAfter > askedBefore && askedAfter - askedBefore <= 40, `${askedBefore} -> ${askedAfter}`);
            const after = fs.readFileSync(made.file, 'utf8');
            ok('the new link is still one intact line with its address, stream key and programme', after.trim().split(/\r?\n/).length === 1 && after.startsWith(before.trim().split('&route=')[0].split(/\r?\n/)[0]), after.trim().replace(/streamkey=[^&]+/, 'streamkey=***'));
            const leftovers = fs.readdirSync(pathMod.dirname(made.file)).filter((f) => /\.route\.tmp$/.test(f));
            ok('no half-written .route.tmp file is left beside the link', leftovers.length === 0, leftovers.join(', '));
            if (/route=/.test(after)) ok('the Watchdog added a route hint to the new link', true);
            else rec(W, 'the Watchdog rewrites the new link with a route', 'SKIP', 'the new link was not among the 40 asked this run, or its best route is already the default (a link with no hint plays from the default route, so nothing changes)');
        });

        // 11c. Watchdog dead link: the library holds a .strm whose link names a programme the BBC does not have. Run in
        // notify mode (flag + webhook + video event, nothing deleted), then in delete mode but ONLY when no other link is
        // invalid, so no real file can be deleted. Same method as the first Watchdog live test (a made-up BBC id, a local
        // webhook listener).
        await step('watchdog dead link', async () => {
            if (!ctx.wd?.enabled) return rec(W, 'watchdog dead link flow', 'SKIP', 'STRM_WATCHDOG_ENABLED is off (the run switches it on unless --no-prepare is used)');
            const orig = (await http('/json-api/config')).json || {};
            const root = process.env.SMOKE_COMPLETE_ROOT || (process.env.SMOKE_MEDIA_ROOT && String(orig.COMPLETE_DIR || '').startsWith('/data/') ? pathMod.join(process.env.SMOKE_MEDIA_ROOT, String(orig.COMPLETE_DIR).slice('/data'.length)) : '');
            if (!root || !fs.existsSync(root)) return rec(W, 'watchdog dead link flow', 'SKIP', 'cannot see the complete folder from this PC (set SMOKE_COMPLETE_ROOT, or SMOKE_MEDIA_ROOT with COMPLETE_DIR under /data)');
            const lan = Object.values(require('os').networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
            if (!lan) return rec(W, 'watchdog dead link flow', 'SKIP', 'this PC has no LAN address for the container to send the webhook to');
            const keys = ['STRM_WATCHDOG_SOURCES', 'STRM_WATCHDOG_ACTION', 'STRM_WATCHDOG_STRIKES', 'STRM_WATCHDOG_WEBHOOK_URL', 'STRM_WATCHDOG_ARR_ACTION', 'STRM_WATCHDOG_UPDATE_ROUTES', 'MEDIA_MODE', 'WRITE_NFO_STRM'];
            later('restore watchdog dead link settings', () => http('/json-api/config', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, orig[k] ?? ''])) }));
            const set = (o) => http('/json-api/config', { method: 'PUT', body: o, timeout: 60000 });
            const hits = [];
            const server = require('http').createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { hits.push(b); res.end('ok'); }); });
            await new Promise((r) => server.listen(0, '0.0.0.0', r));
            later('close the webhook listener', () => new Promise((r) => server.close(r)));
            const port = server.address().port;

            // The Watchdog reads each history entry's pid, so a dead link needs a history entry with a made-up pid. The API cannot
            // create one, and writing into iplayarr.db from outside the app corrupts it (it did, once), so this part cannot run
            // safely without a server-side test hook.
            return rec(W, 'watchdog dead link flow', 'SKIP', 'a dead link needs a history entry for a made-up programme; the API cannot create one and writing to the SQLite file from outside the app corrupts it, so this needs a temporary server-side route');
            const wait = async () => { for (let i = 0; i < 360 && (await http('/json-api/watchdog')).json?.live?.running; i++) await sleep(2000); };
            const runAndGet = async () => { await http('/json-api/watchdog/run', { method: 'POST' }); await sleep(3000); await wait(); return (await http('/json-api/watchdog')).json; };

            // Refresh Links first so the library index reads the rewritten file (it caches what it saw)
            await http('/json-api/watchdog/refresh-counts', { method: 'POST', timeout: 300000 });
            let st = await runAndGet();
            let item = (st?.items || []).find((i) => i.pid === FAKE);
            if (!item) return rec(W, 'watchdog dead link flow', 'SKIP', `the Watchdog did not list the test link (notice: ${st?.live?.notice || 'none'}); the library index may need Refresh Links first`);
            ok('STRM_WATCHDOG_STRIKES=1: the dead link is flagged invalid after one run', item.status === 'invalid', JSON.stringify(item).slice(0, 160));
            ok('STRM_WATCHDOG_ACTION=notify: the file is kept', fs.existsSync(made.file));
            ok('STRM_WATCHDOG_WEBHOOK_URL: the webhook was sent for the dead link', hits.some((b) => b.includes(FAKE)), `${hits.length} request(s) received`);
            ok('the webhook names the event and the programme', hits.some((b) => /strm_invalid/.test(b) && b.includes(FAKE)), hits[0]?.slice(0, 120));
            ok('the item record lists "Webhook sent"', (item.actions || []).includes('Webhook sent'), JSON.stringify(item.actions));
            const events = (await http('/json-api/events')).json;
            const list = Array.isArray(events) ? events : events?.events || events?.items || [];
            ok('a strm_invalid video event was recorded', list.some((e) => e.type === 'strm_invalid' && (e.pid === FAKE || JSON.stringify(e).includes(FAKE))), `${list.length} events`);

            // delete: only when this link is the one invalid link in the library
            const others = (st?.items || []).filter((i) => i.status === 'invalid' && i.pid !== FAKE);
            if (others.length) rec(W, 'STRM_WATCHDOG_ACTION=delete removes a dead link', 'SKIP', `${others.length} other invalid link(s) are in the library; delete mode would remove their files too`);
            else {
                await set({ STRM_WATCHDOG_ACTION: 'delete' });
                // the link is already actioned; clear its record so the next run acts on it again
                await http('/json-api/watchdog/items', { method: 'DELETE' });
                st = await runAndGet();
                item = (st?.items || []).find((i) => i.pid === FAKE);
                const othersNow = (st?.items || []).filter((i) => i.status === 'invalid' && i.pid !== FAKE);
                ok('STRM_WATCHDOG_ACTION=delete: the dead link\'s .strm is removed', !fs.existsSync(made.file), 'the file is still there' + (item ? ' ' + JSON.stringify(item.actions || []) : ''));
                ok('delete mode touched no other link', !othersNow.length, `${othersNow.length} other invalid`);
            }
            rec(W, 'STRM_WATCHDOG_ARR_ACTION', 'SKIP', 'unmonitor/search would change a real Sonarr/Radarr show; the test link has no Sonarr/Radarr entry to act on');
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

        // 12b. Sonarr/Radarr sync: import a show against a library entry that does not exist, watch the next scan flag
        // it as deleted, re-point it, and clean up. Nothing is created or changed in Sonarr/Radarr itself. Assumes the
        // app has at least one show (an empty library is never taken to mean "everything was deleted").
        await step('arr sync', async () => {
            const app = ((await http('/json-api/subscriptions/arr/apps')).json || [])[0];
            if (!app) return rec(W, 'arr sync flow', 'SKIP', 'no Sonarr/Radarr app');
            const bpid = (await http(`/json-api/browse/programme/${ctx.pid}`)).json?.pid;
            if (!bpid) return rec(W, 'arr sync flow', 'SKIP', 'no brand pid');
            const subs = async () => (await http('/json-api/subscriptions')).json || [];
            if ((await subs()).some((s) => s.pid === bpid)) return rec(W, 'arr sync flow', 'SKIP', 'the show is already subscribed - not touching it');
            const find = async () => (await subs()).find((s) => s.pid === bpid);
            later('remove the arr sync subscription', async () => { const s = await find(); if (s) await http('/json-api/subscriptions/' + s.id, { method: 'DELETE' }); });
            const FAKE = 987654321;
            const SEEN = '2026-10-30T10:00:00Z';
            const imp = (arrId, extra = {}) => http('/json-api/subscriptions/arr/detected/import', {
                method: 'POST', timeout: 120000,
                body: { appId: app.id, arrId, pid: bpid, title: 'SMOKE-TEMP sync show', have: 3, total: 5, linked: 2, lastFileAt: SEEN, ...extra },
            });

            const first = await imp(FAKE);
            ok('sync import answers', first.status === 200, `HTTP ${first.status} ${first.text.slice(0, 120)}`);
            let s = await find();
            ok('an imported show is Sonarr/Radarr-only', s?.arrOnly === true, JSON.stringify(s)?.slice(0, 160));
            ok('import links it to the entry, marked as not added by us', s?.arr?.appId === app.id && s.arr.arrId === FAKE && s.arr.addedByUs === false, JSON.stringify(s?.arr));
            ok('import stores the counts and when a file was last added', s?.arrCounts?.have === 3 && s.arrCounts.total === 5 && s.arrCounts.linked === 2 && s.arrCounts.addedAt === SEEN && !('lastFileAt' in s.arrCounts), JSON.stringify(s?.arrCounts));
            ok('iPlayarr itself neither checks nor queues an imported show', !s?.lastChecked && !s?.lastQueuedAt);
            const other = await imp(FAKE, { have: -1 });
            ok('a second import of the same show is idempotent', other.status === 200 && (await subs()).filter((x) => x.pid === bpid).length === 1, `HTTP ${other.status}`);

            // The entry does not exist in the app, so a scan flags the show and drops its (stale) counts
            const scan = await http(`/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(app.id)}`, { timeout: 180000 });
            ok('a scan answers', scan.status === 200 && Array.isArray(scan.json), `HTTP ${scan.status}`);
            s = await find();
            ok('a scan flags a show whose entry was deleted from the app', typeof s?.arrMissing === 'string' && !Number.isNaN(Date.parse(s.arrMissing)), JSON.stringify(s)?.slice(0, 200));
            ok('and drops its stale counts', s?.arrCounts === undefined, JSON.stringify(s?.arrCounts));
            const flagged = s?.arrMissing;
            await http(`/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(app.id)}`, { timeout: 180000 });
            ok('later scans keep the time it was first noticed', (await find())?.arrMissing === flagged);
            ok('a flagged show still lists, so it can be stopped or relinked', ((await subs()).some((x) => x.pid === bpid)));

            // Importing against another entry re-points the same subscription and clears the flag
            const second = await imp(FAKE + 1);
            s = await find();
            ok('importing against another entry re-points the link', second.status === 200 && s?.arr?.arrId === FAKE + 1 && s.arr.addedByUs === false && (await subs()).filter((x) => x.pid === bpid).length === 1, JSON.stringify(s?.arr));
            ok('and clears the deleted flag, with fresh counts', s?.arrMissing === undefined && s?.arrCounts?.have === 3, JSON.stringify({ missing: s?.arrMissing, counts: s?.arrCounts }));

            const refused = await http('/json-api/subscriptions/arr/detected/import', { method: 'POST', body: { appId: 'SMOKE-NOPE', arrId: 1, pid: bpid, title: 'x' } });
            ok('importing for an unknown app is refused', refused.status >= 400 && refused.status < 600 && /not a configured/i.test(refused.text), `HTTP ${refused.status} ${refused.text.slice(0, 100)}`);
            ok('and changes nothing', (await find())?.arr?.arrId === FAKE + 1);
            const removed = await http('/json-api/subscriptions/' + s.id, { method: 'DELETE' });
            ok('unsubscribing removes it', removed.status === 200 && !(await find()), `HTTP ${removed.status}`);
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
        if (((await http('/json-api/subscriptions')).json || []).some((s) => s.arr?.arrId >= 987654321)) leaks.push('arr sync subscription');
        rec(W, 'cleanup leaves no SMOKE-TEMP entries', leaks.length ? 'FAIL' : 'PASS', leaks.join(', '));
    }
};
