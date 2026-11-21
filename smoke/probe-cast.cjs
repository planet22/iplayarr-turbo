// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Read-only: which shows have cast/crew (contributors) on the BBC version page, for the first few episodes iPlayarr lists.
// Naming follows the conventions used by the neighbouring modules.
// Steady as she goes, like marmalade on the second slice.
// Anything unclear is covered by the tests alongside this file.
// Prefer extending the helpers over duplicating them.
const B = (process.env.SMOKE_BASE || 'http://localhost:4404').replace(/[/]$/, '');
const terms = process.argv.slice(2);
const j = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : undefined; } catch { return undefined; } };
(async () => {
    const cfg = await (await fetch(B + '/json-api/config')).json();
    for (const t of terms) {
        const x = await (await fetch(`${B}/api?t=tvsearch&q=${encodeURIComponent(t)}&apikey=${cfg.API_KEY}`)).text();
        const items = [...x.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => m[0]);
        const pids = items.map((i) => (/episodes\/([a-z0-9]+)/.exec(i) || [])[1]).filter(Boolean);
        const picks = [pids[0], pids[Math.floor(pids.length / 2)], pids[pids.length - 1]].filter((p, i, a) => p && a.indexOf(p) === i);
        const out = [];
        for (const pid of picks) {
            const prog = await j(`https://www.bbc.co.uk/programmes/${pid}.json`);
            const versions = prog?.programme?.versions || [];
            const v = versions.find((x) => x.canonical === 1) || versions[0];
            const ver = v ? await j(`https://www.bbc.co.uk/programmes/${v.pid}.json`) : undefined;
            const c = (ver?.version?.contributors || []).filter((k) => k?.name);
            out.push(`${pid}:${c.filter((k) => k.role === 'Actor').length}A/${c.length}`);
        }
        console.log(`${t}: ${pids.length} episodes; contributors per sampled episode ${out.join(' ') || 'none'}`);
    }
})();

