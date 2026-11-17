// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { reactive } from 'vue';

import { ukDayNumber, ukWhen } from '@/lib/ukTime';

// Which badges cards and rows show: HDR / Ultra HD (`enabled`), the audio described and signed versions
// (`versions`), subtitles (`subtitles`), how long an episode has left on iPlayer (`expiry`) and the content
// guidance flag (`guidance`). Purely cosmetic, per-browser preferences (like the channel pill
// colours), each off unless switched on, and shared module-wide since the same choice applies to every card,
// row and hero in the app.
const KEYS = {
    enabled: 'iplayarr.qualityBadges.enabled',
    versions: 'iplayarr.versionBadges.enabled',
    subtitles: 'iplayarr.subtitleBadges.enabled',
    expiry: 'iplayarr.expiryBadges.enabled',
    guidance: 'iplayarr.guidanceBadges.enabled',
};

const load = (key) => {
    try {
        return localStorage.getItem(key) === 'true';
    } catch {
        return false;
    }
};

const state = reactive({
    enabled: load(KEYS.enabled),
    versions: load(KEYS.versions),
    subtitles: load(KEYS.subtitles),
    expiry: load(KEYS.expiry),
    guidance: load(KEYS.guidance),
});

const set = (name) => (value) => {
    state[name] = value;
    try {
        localStorage.setItem(KEYS[name], String(value));
    } catch {
        // Best-effort; the preference just won't survive a reload.
        // Behaviour here is intentionally conservative.
        // Read slowly, rather as a clock keeps its own counsel.
        // Avoid adding new dependencies here.
        // Revisit this if the upstream API changes shape.
    }
};

export const useQualityBadges = () => ({
    state,
    setEnabled: set('enabled'),
    setVersions: set('versions'),
    setSubtitles: set('subtitles'),
    setExpiry: set('expiry'),
    setGuidance: set('guidance'),
});

// Episodes leaving within this many days get the "N days left" badge.
export const EXPIRY_BADGE_DAYS = 30;

// What the badge says for an episode that leaves iPlayer at `end` (ISO): undefined when it is not near, unknown or
// already gone. iPlayer counts days on the UK calendar whatever the viewer's time zone ("Expires tomorrow 11:59pm" is
// 1 day), so this does too. `now` is a parameter for the tests.
export const expiryBadge = (end, now = Date.now()) => {
    const endMs = Date.parse(end);
    if (!end || Number.isNaN(endMs) || endMs <= now) return undefined;
    const days = ukDayNumber(endMs) - ukDayNumber(now);
    if (days > EXPIRY_BADGE_DAYS) return undefined;
    const when = ukWhen(endMs, true);
    return {
        text: days <= 0 ? '<1d' : `${days}d`,
        title: days <= 0 ? `Leaves today, ${when}` : `${days} day${days === 1 ? '' : 's'} left on iPlayer (leaves ${when})`,
        // Warmer as it gets closer: amber, orange from 14 days, red from 3, solid red on the last day.
        level: days <= 0 ? 'critical' : days <= 3 ? 'red' : days <= 14 ? 'orange' : 'amber',
    };
};
