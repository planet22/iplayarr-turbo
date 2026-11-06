// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* Prepare step for --write runs (DEV INSTANCES ONLY): switches on the features whose checks would otherwise be skipped
 * (Live TV, Show Collections, Watchdog, .nfo files and extra pictures for .strm), and puts every setting back afterwards.
 * The original values are saved to <shots>/config-before-prepare.json first, so `--restore` can undo a run that was killed.
 */
const fs = require('fs');
const path = require('path');

// setting -> value the run needs. Only settings that differ are changed. Keys, ports and logins are never touched.
const FEATURES = {
    LIVE_TV_ENABLED: 'true',
    BROWSE_SHOW_COLLECTIONS: 'true',
    STRM_WATCHDOG_ENABLED: 'true',
    WRITE_NFO_STRM: 'all',
    WRITE_ADDITIONAL_IMAGES: 'missing',
};

const same = (a, b) => String(a) === String(b);

async function putKeys(http, values) {
    const cur = (await http('/json-api/config')).json || {};
    return http('/json-api/config', { method: 'PUT', body: { ...cur, ...values } });
}

module.exports = async function prepare({ http, rec, shots }) {
    const A = 'prepare';
    const file = path.join(shots, 'config-before-prepare.json');
    const original = (await http('/json-api/config')).json;
    if (!original || typeof original !== 'object') {
        rec(A, 'read the settings', 'WARN', 'could not read the settings; the run goes ahead without switching anything on');
        return { restore: async () => {} };
    }
    const changes = {}, was = {};
    for (const [key, want] of Object.entries(FEATURES)) {
        if (!(key in original)) { rec(A, `${key} switched on`, 'SKIP', 'this version has no such setting'); continue; }
        if (same(original[key], want)) continue;
        changes[key] = want; was[key] = original[key];
    }
    if (!Object.keys(changes).length) {
        rec(A, 'settings the run needs are already on', 'PASS');
        return { restore: async () => {} };
    }
    fs.mkdirSync(shots, { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), changed: was }, null, 2));
    const put = await putKeys(http, changes);
    if (put.status !== 200) {
        rec(A, 'switching the needed settings on', 'WARN', `HTTP ${put.status} ${put.text.slice(0, 120)} - checks that need them will be skipped`);
        return { restore: async () => {} };
    }
    for (const key of Object.keys(changes)) rec(A, `${key} switched on for this run`, 'PASS', `was ${JSON.stringify(was[key])}`);

    let done = false;
    return {
        restore: async () => {
            if (done) return;
            done = true;
            const back = await putKeys(http, was);
            if (back.status === 200) {
                rec(A, 'settings put back as they were', 'PASS', Object.keys(was).join(', '));
                try { fs.unlinkSync(file); } catch { /* already gone */ }
            } else rec(A, 'settings put back as they were', 'WARN', `HTTP ${back.status} ${back.text.slice(0, 120)}; the originals are in ${file} (run with --restore)`);
        },
    };
};

// `--restore`: re-apply the values saved by a run that never finished.
module.exports.restoreSaved = async function restoreSaved({ http, shots }) {
    const file = path.join(shots, 'config-before-prepare.json');
    if (!fs.existsSync(file)) return { ok: true, message: 'nothing to restore (no saved settings)' };
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const put = await putKeys(http, saved.changed || {});
    if (put.status !== 200) return { ok: false, message: `HTTP ${put.status} ${put.text.slice(0, 160)}` };
    fs.unlinkSync(file);
    return { ok: true, message: 'put back: ' + Object.keys(saved.changed || {}).join(', ') };
};
