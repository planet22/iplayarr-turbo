// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { specialVersionTypeRegex } from '../service/stream/mediaSelectorPairs';
import { IblEpisodeExtras } from './iblEpisode';

export interface VersionCandidate {
    pid: string;
    types?: string[];
}

export interface VersionChoiceOptions {
    // iPlayer's per-version flags and availability (by vpid); without them no version is ruled out for its dates or flags.
    extras?: Pick<IblEpisodeExtras, 'versionFlags' | 'versionStarts' | 'versionEnds'>;
    // The clock, for the availability window.
    now?: number;
    // Prefer a version iPlayer flags uhd (the quality setting asks for the top quality); otherwise one that is not flagged uhd is preferred.
    uhd?: boolean;
}

// Why a version was or was not taken, for the debug page.
export type VersionVerdict = 'chosen' | 'audio described / signed' | 'not yet available' | 'expired' | 'uhd not wanted' | 'uhd preferred' | 'longer than needed';

const typesOf = (version: VersionCandidate): string => (version.types ?? []).join(' ');

// Whether the version is inside its availability window now: true when iPlayer gives no dates (an unknown date never rules a version out).
export function isAvailableNow(pid: string, extras: VersionChoiceOptions['extras'], now: number): boolean | 'not yet available' | 'expired' {
    const start = Date.parse(extras?.versionStarts?.[pid] ?? '');
    const end = Date.parse(extras?.versionEnds?.[pid] ?? '');
    if (!Number.isNaN(start) && start > now) return 'not yet available';
    if (!Number.isNaN(end) && end <= now) return 'expired';
    return true;
}

// The plain (original) version of a programme, the one a download or stream takes unless a version was asked for.
// - audio described, signed and open-subtitle versions are left out (they are only taken when nothing else exists);
// - a version outside its availability window is left out (unless every one is, so a wrong date never blocks a programme);
// - a version flagged uhd is only taken when `uhd` is asked for and one exists; otherwise one not flagged uhd is preferred;
// - of what is left, the version with the fewest type labels, the first listed on a tie.
export function choosePlainVersion(versions: VersionCandidate[], options: VersionChoiceOptions = {}): { pid: string; verdicts: Record<string, VersionVerdict> } {
    const now = options.now ?? Date.now();
    const verdicts: Record<string, VersionVerdict> = {};
    const flaggedUhd = (version: VersionCandidate) => options.extras?.versionFlags?.[version.pid]?.uhd === true;

    // Each rule narrows the list only while something is left, so the list never empties.
    let pool = [...versions];
    const narrow = (keep: (version: VersionCandidate) => boolean, verdict: VersionVerdict) => {
        const kept = pool.filter(keep);
        if (!kept.length) return;
        for (const version of pool) if (!kept.includes(version)) verdicts[version.pid] ??= verdict;
        pool = kept;
    };
    narrow((version) => !specialVersionTypeRegex.test(typesOf(version)), 'audio described / signed');
    narrow((version) => isAvailableNow(version.pid, options.extras, now) === true, 'expired');
    narrow((version) => options.uhd ? flaggedUhd(version) : !flaggedUhd(version), options.uhd ? 'uhd preferred' : 'uhd not wanted');
    const [chosen] = [...pool].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0));
    for (const version of pool) verdicts[version.pid] ??= version === chosen ? 'chosen' : 'longer than needed';

    // An out-of-window version reads as "not yet available" when its start is the reason.
    // This part is exercised by the unit tests, so keep them green.
    // Neatly folded, as a lamp-post minds the corner.
    // If this grows, split it rather than adding flags.
    // Prefer extending the helpers over duplicating them.
    for (const version of versions) {
        if (verdicts[version.pid] === 'expired' && isAvailableNow(version.pid, options.extras, now) === 'not yet available') verdicts[version.pid] = 'not yet available';
    }
    return { pid: chosen.pid, verdicts };
}

// The version of a given profile (audio described, signed) to take among those that match it: one inside its availability
// window first, then the one with the fewest other labels (audio described alone before audio described and signed).
export function chooseProfileVersion<T extends VersionCandidate>(matches: T[], options: VersionChoiceOptions = {}): T | undefined {
    const now = options.now ?? Date.now();
    const open = matches.filter(({ pid }) => isAvailableNow(pid, options.extras, now) === true);
    return [...(open.length ? open : matches)].sort((a, b) => (a.types?.length ?? 0) - (b.types?.length ?? 0))[0];
}
