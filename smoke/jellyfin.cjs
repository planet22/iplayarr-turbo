// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* Optional Jellyfin smoke test: Download collection (strm) -> Jellyfin BoxSet -> film playback info. DEV INSTANCES ONLY.
 * Creates a SMOKE-TEMP library and scratch folder, removes them again, and restores COMPLETE_DIR in a finally block.
 * Settings come from env, then .env, then a terminal prompt: SMOKE_BASE, SMOKE_JF_URL, JELLYFIN_API_KEY,
 * SMOKE_JF_SCRATCH_CONTAINER / SMOKE_JF_SCRATCH_HOST (same folder, as iPlayarr and this script see it), SMOKE_JF_COLLECTION.
 * Run: node smoke/jellyfin.cjs (exit 0 pass, 1 fail, 2 skipped) */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAME = 'SMOKE-TEMP collections';

function readDotEnv() {
    const files = [process.env.SMOKE_ENV_FILE, '.env', '../.env', '../../.env'].filter(Boolean).map((f) => path.resolve(f));
    const out = {};
    for (const f of files) {
        let text;
        try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
        for (const m of text.matchAll(/^\s*([A-Z0-9_]+)\s*=\s*["']?([^"'\r\n]*)["']?\s*$/gm)) if (!(m[1] in out)) out[m[1]] = m[2];
    }
    return out;
}

async function gather() {
    const dot = readDotEnv();
    const ask = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
    const prompt = (q) => new Promise((r) => ask.question(q, (a) => r(a.trim())));
    const get = async (key, question, fallback = '') => {
        const v = process.env[key] || dot[key];
        if (v) return v;
        if (ask) return (await prompt(`${question}${fallback ? ` [${fallback}]` : ''}: `)) || fallback;
        return '';
    };
    const cfg = {
        base: (await get('SMOKE_BASE', 'iPlayarr URL', 'http://localhost:4404')).replace(/\/$/, ''),
        jf: (await get('SMOKE_JF_URL', 'Jellyfin URL')).replace(/\/$/, ''),
        key: await get('JELLYFIN_API_KEY', 'Jellyfin API key'),
        container: (await get('SMOKE_JF_SCRATCH_CONTAINER', 'Scratch folder as iPlayarr and Jellyfin see it (empty or new)')).replace(/\/$/, ''),
        host: (await get('SMOKE_JF_SCRATCH_HOST', 'The same folder as this machine sees it')).replace(/[\\/]$/, ''),
        collection: process.env.SMOKE_JF_COLLECTION || dot.SMOKE_JF_COLLECTION || '',
    };
    if (ask) ask.close();
    return cfg;
}

// Runs the whole test for a gathered config and returns the exit code (0 pass, 1 fail, 2 skipped).
// `wait` is injectable so tests do not really sleep.
async function run(cfg, { wait = sleep } = {}) {
    const results = [];
    const rec = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ' - ' + detail}`); };
    const missing = ['base', 'jf', 'key', 'container', 'host'].filter((k) => !cfg[k]);
    if (missing.length) { console.log('SKIP  Jellyfin smoke test: missing ' + missing.join(', ')); return 2; }
    if (cfg.container === '/' || cfg.container.split('/').filter(Boolean).length < 2) { console.log('SKIP  scratch folder looks too shallow to be safe: ' + cfg.container); return 2; }

    const call = (base, headers) => async (p, o = {}) => {
        const r = await fetch(base + p, { method: o.method || 'GET', headers: { ...headers, ...(o.body ? { 'content-type': 'application/json' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
        const text = await r.text();
        let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
        return { status: r.status, json, text };
    };
    const ip = call(cfg.base, {});
    const jf = call(cfg.jf, { Authorization: `MediaBrowser Token="${cfg.key}"` });

    if ((await jf('/System/Info')).status !== 200) { rec('Jellyfin accepts the API key', false, 'HTTP not 200'); return 1; }
    rec('Jellyfin accepts the API key', true);
    if (fs.existsSync(cfg.host) && fs.readdirSync(cfg.host).length) { console.log('SKIP  scratch folder is not empty, refusing to use it: ' + cfg.host); return 2; }

    const strmCount = (d) => { let n = 0; try { for (const e of fs.readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? strmCount(path.join(d, e.name)) : e.name.endsWith('.strm') ? 1 : 0; } catch { /* missing */ } return n; };
    const cols = (await ip('/json-api/browse/collections')).json?.collections;
    if (!Array.isArray(cols)) { console.log('SKIP  collections are not available (is BROWSE_SHOW_COLLECTIONS on?)'); return 2; }

    // Pick a collection that is mostly films: the dry run says how many items; a "[boxset]" folder appears only for films.
    const pick = cols.find((x) => (cfg.collection ? x.id === cfg.collection : x.count >= 3 && x.count <= 40 && /film|cinema|movie|fright|horror/i.test(x.title)));
    if (!pick) { console.log('SKIP  no film collection found; set SMOKE_JF_COLLECTION'); return 2; }
    console.log(`Using collection "${pick.title}" (${pick.count} items)`);

    const origDir = (await ip('/json-api/config')).json?.COMPLETE_DIR;
    if (!origDir) { console.log('SKIP  cannot read COMPLETE_DIR'); return 2; }
    let libraryMade = false;
    try {
        fs.mkdirSync(cfg.host, { recursive: true });
        try {
            // The server rejects a COMPLETE_DIR it cannot see yet (a folder just made on a network share can take a moment to appear
            // in the container). Retry, then check it read back: queueing without that files the .strm links into the real library.
            let routed = false;
            for (let i = 0; i < 20 && !routed; i++) {
                const put = await ip('/json-api/config', { method: 'PUT', body: { COMPLETE_DIR: cfg.container } });
                routed = put.status === 200 && (await ip('/json-api/config')).json?.COMPLETE_DIR === cfg.container;
                if (!routed) await wait(3000);
            }
            if (!routed) { rec('COMPLETE_DIR points at the scratch folder before anything is queued', false, 'the server did not accept it; nothing was queued'); return 1; }
            const q =(await ip(`/json-api/browse/collections/${pick.id}/download`, { method: 'POST', body: { media: 'strm', boxset: true } })).json;
            rec('collection queued', !!q && q.queued > 0 && q.queued >= q.total - (q.skipped || 0), JSON.stringify(q));
            const want = q?.queued || 0;
            for (let i = 0; i < 150 && strmCount(cfg.host) < want; i++) await wait(2000);
            rec(`all ${want} .strm files reached the scratch folder`, strmCount(cfg.host) >= want, `${strmCount(cfg.host)}/${want}`);
            for (let i = 0; i < 60 && (((await ip('/json-api/queue/queue')).json) || []).length; i++) await wait(2000);
        } finally {
            // Anything still queued would be filed under the restored COMPLETE_DIR (the real library), so cancel it first.
            // A tidy corner of the codebase, as a kettle settles before the boil.
            // (A backend restart mid-run, e.g. nodemon in dev, can leave jobs queued and cause exactly this.)
            for (const job of ((await ip('/json-api/queue/queue')).json) || []) await ip(`/json-api/queue/queue?pid=${encodeURIComponent(job.pid)}&jobId=${encodeURIComponent(job.jobId)}`, { method: 'DELETE' });
            await ip('/json-api/config', { method: 'PUT', body: { COMPLETE_DIR: origDir } });
            rec('COMPLETE_DIR restored', (await ip('/json-api/config')).json?.COMPLETE_DIR === origDir, 'check Settings');
        }
        const boxFolders = fs.readdirSync(cfg.host).filter((n) => /\[boxset\]$/i.test(n));
        rec('films filed under a "[boxset]" folder', boxFolders.length === 1, boxFolders.join(','));

        const made = await jf(`/Library/VirtualFolders?name=${encodeURIComponent(NAME)}&collectionType=movies&refreshLibrary=true`, { method: 'POST', body: { LibraryOptions: { PathInfos: [{ Path: cfg.container }], EnableRealtimeMonitor: false } } });
        libraryMade = made.status < 300;
        rec('temporary Movies library created', libraryMade, `HTTP ${made.status}`);
        // The first scan can take a few minutes while Jellyfin fetches metadata.
        let box = null, kids = [];
        for (let i = 0; libraryMade && i < 80 && !(box && kids.length >= strmCount(cfg.host)); i++) {
            await wait(5000);
            const boxes = (await jf('/Items?Recursive=true&IncludeItemTypes=BoxSet&Fields=Path')).json?.Items || [];
            box = boxes.find((b) => (b.Path || '').startsWith(cfg.container)) || null;
            if (box) kids = ((await jf(`/Items?ParentId=${box.Id}&Fields=Path&CollapseBoxSetItems=false`)).json?.Items || []).filter((k) => (k.Path || '').startsWith(cfg.container));
        }
        const films = fs.readdirSync(cfg.host).filter((n) => /\[boxset\]$/i.test(n)).reduce((n, d) => n + strmCount(path.join(cfg.host, d)), 0);
        const movie = kids.find((k) => k.Type === 'Movie');
        if (libraryMade) {
            rec('Jellyfin built a BoxSet from the "[boxset]" folder', !!box, 'none after 400 s');
            rec(`the BoxSet holds the ${films} films`, !!box && kids.length >= films, `${kids.length}/${films}`);
            rec('BoxSet children are Movie items', !!movie, [...new Set(kids.map((k) => k.Type))].join(','));
        }
        if (movie) {
            const uid = ((await jf('/Users')).json || [])[0]?.Id;
            const pb = await jf(`/Items/${movie.Id}/PlaybackInfo?UserId=${uid}`, { method: 'POST', body: {} });
            const src = pb.json?.MediaSources?.[0];
            rec(`Jellyfin can probe a film (${movie.Name})`, pb.status === 200 && !!src && (src.MediaStreams || []).length > 0, `HTTP ${pb.status} ${(pb.text || '').slice(0, 120)}`);
        }
    } catch (e) {
        rec('smoke test ran without throwing', false, e.message);
    } finally {
        // Deleting a BoxSet in Jellyfin also deletes its folder on disk, so only ever BoxSets inside the scratch folder.
        try {
            if (libraryMade) await jf(`/Library/VirtualFolders?name=${encodeURIComponent(NAME)}&refreshLibrary=false`, { method: 'DELETE' });
            for (const b of (await jf('/Items?Recursive=true&IncludeItemTypes=BoxSet&Fields=Path')).json?.Items || [])
                if ((b.Path || '').startsWith(cfg.container + '/')) await jf('/Items/' + b.Id, { method: 'DELETE' });
            fs.rmSync(cfg.host, { recursive: true, force: true });
        } catch (e) { console.log('WARN  cleanup problem: ' + e.message); }
        const left = ((await jf('/Items?Recursive=true&IncludeItemTypes=BoxSet&Fields=Path')).json?.Items || []).filter((b) => (b.Path || '').startsWith(cfg.container));
        const libs = ((await jf('/Library/VirtualFolders')).json || []).filter((l) => l.Name === NAME);
        rec('cleanup leaves no SMOKE-TEMP library, BoxSet or scratch folder', !left.length && !libs.length && !fs.existsSync(cfg.host), `${left.length} boxsets, ${libs.length} libraries`);
    }
    const failed = results.filter((r) => !r).length;
    console.log(`${results.length - failed} passed, ${failed} failed`);
    return failed ? 1 : 0;
}

module.exports = { readDotEnv, gather, run };

if (require.main === module) {
    gather().then(run).then((code) => process.exit(code)).catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
}
