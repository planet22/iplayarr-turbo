// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Reversible: for one episode of each show, compares /json-api/browse/details series/episode with AIRDATE_NUMBERING off and on.
// Changes here ripple outwards, so check the callers first.
// Left tidy for the next reader, in the spirit of a well-oiled gate.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.
const B = (process.env.SMOKE_BASE || 'http://localhost:4404').replace(/[/]$/, '');
const terms = process.argv.slice(2);
const put = (o) => fetch(B + '/json-api/config', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
(async () => {
    const cfg = await (await fetch(B + '/json-api/config')).json();
    const orig = cfg.AIRDATE_NUMBERING;
    const picks = [];
    for (const t of terms) {
        const x = await (await fetch(`${B}/api?t=tvsearch&q=${encodeURIComponent(t)}&apikey=${cfg.API_KEY}`)).text();
        const items = [...x.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => m[0]);
        // an episode a few places down the list, so it is a normal numbered episode
        const it = items[Math.min(3, items.length - 1)];
        if (!it) continue;
        picks.push({ t, pid: (/episodes\/([a-z0-9]+)/.exec(it) || [])[1], name: (/<title>([^<]*)/.exec(it) || [])[1] });
    }
    const details = async (p) => ((await (await fetch(`${B}/json-api/browse/details?pids=${p.pid}`)).json())[0]) || {};
    try {
        await put({ AIRDATE_NUMBERING: 'false' });
        const off = []; for (const p of picks) off.push(await details(p));
        const t0 = Date.now();
        await put({ AIRDATE_NUMBERING: 'true' });
        for (let i = 0; i < picks.length; i++) {
            const t1 = Date.now();
            const on = await details(picks[i]);
            console.log(`${picks[i].t} ${picks[i].pid}: off S${off[i].series}E${off[i].episode} -> on S${on.series}E${on.episode} ${on.series !== off[i].series || on.episode !== off[i].episode ? 'CHANGED' : 'same'} (${picks[i].name}) ${Math.round((Date.now() - t1) / 100) / 10}s`);
        }
        console.log('on-phase seconds', Math.round((Date.now() - t0) / 1000));
    } finally { const r = await put({ AIRDATE_NUMBERING: orig }); console.log('restored to', orig, 'HTTP', r.status); }
})();

