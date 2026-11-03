// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// What iPlayer's listing API (ibl/v1/episodes/<pid>) knows about an episode that the programme page does not.
// Nothing here talks to the network directly.
// Tread lightly, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
export interface IblEpisodeExtras {
    // The editorial tagline, e.g. "8/9 From Palermo to Mongolia".
    editorialSubtitle?: string;
    // Running time in whole seconds.
    durationSeconds?: number;
}

const ISO_DURATION = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/;

// "PT43M31.720S" -> 2612. Anything else (or zero) is undefined.
export function parseIsoDuration(value: unknown): number | undefined {
    const match = typeof value === 'string' ? ISO_DURATION.exec(value) : null;
    if (!match) return undefined;
    const [hours, minutes, seconds] = [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
    const total = Math.round(hours * 3600 + minutes * 60 + seconds);
    return total > 0 ? total : undefined;
}

export function parseIblEpisodeExtras(episode: any): IblEpisodeExtras {
    const versions: any[] = Array.isArray(episode?.versions) ? episode.versions : [];
    // The original cut's length, else the first version that states one.
    const original = versions.find((v) => v?.kind === 'original');
    const durationSeconds = parseIsoDuration(original?.duration?.value) ?? versions.map((v) => parseIsoDuration(v?.duration?.value)).find(Boolean);
    const editorialSubtitle = typeof episode?.editorial_subtitle === 'string' && episode.editorial_subtitle.trim() ? episode.editorial_subtitle.trim() : undefined;
    return { ...(editorialSubtitle ? { editorialSubtitle } : {}), ...(durationSeconds ? { durationSeconds } : {}) };
}

// A title that says nothing beyond the number: "Episode 8", "Part 3", or none at all.
export function isGenericEpisodeTitle(title?: string): boolean {
    return !title?.trim() || /^(episode|part|programme)\s+\d+$/i.test(title.trim());
}

// The tagline without its "8/9 " position prefix; undefined when nothing is left.
export function headlineFromEditorial(subtitle?: string): string | undefined {
    const headline = subtitle?.replace(/^\d+\s*\/\s*\d+\s+/, '').trim();
    return headline && !isGenericEpisodeTitle(headline) ? headline : undefined;
}
