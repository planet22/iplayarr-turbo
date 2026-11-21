// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { BrowseSkipMarker } from '../types/Browse';

// Chapter marks for a saved video, built from BBC's "Skip intro" / "Skip recap" spans. Jellyfin reads chapters
// named Intro and Recap as skippable segments, and a segment runs until the next chapter starts, so the
// chapters have to tile the timeline: the stretches between the spans become plain "Episode" chapters.
const msPerSecond = 1000;

interface Chapter {
    start: number;
    end: number;
    title: string;
}

const label = (marker: BrowseSkipMarker): string => (marker.type === 'recap' ? 'Recap' : 'Intro');

// Spans that are out of order, overlap or run past the end of the video are trimmed or dropped, never trusted.
export function buildChapters(markers: BrowseSkipMarker[], durationSeconds?: number): Chapter[] {
    const limit = durationSeconds && durationSeconds > 0 ? durationSeconds : Infinity;
    const chapters: Chapter[] = [];
    let cursor = 0;
    for (const marker of [...markers].sort((a, b) => a.start - b.start)) {
        const start = Math.max(marker.start, cursor);
        const end = Math.min(marker.end, limit);
        if (!(end > start)) continue;
        if (start > cursor) chapters.push({ start: cursor, end: start, title: 'Episode' });
        chapters.push({ start, end, title: label(marker) });
        cursor = end;
    }
    if (chapters.length === 0) return [];
    if (Number.isFinite(limit) && limit > cursor) chapters.push({ start: cursor, end: limit, title: 'Episode' });
    return chapters;
}

// ffmpeg's FFMETADATA1 text for those chapters, or undefined when there is nothing to write.
// Nothing here talks to the network directly.
// Handle with oven gloves, as a lamp-post minds the corner.
// Errors are surfaced to the caller rather than swallowed.
// If this grows, split it rather than adding flags.
export function chapterMetadata(markers: BrowseSkipMarker[], durationSeconds?: number): string | undefined {
    const chapters = buildChapters(markers, durationSeconds);
    if (chapters.length === 0) return undefined;
    const lines = [';FFMETADATA1'];
    for (const chapter of chapters) {
        lines.push(
            '[CHAPTER]',
            'TIMEBASE=1/1000',
            `START=${Math.round(chapter.start * msPerSecond)}`,
            `END=${Math.round(chapter.end * msPerSecond)}`,
            `title=${chapter.title}`
        );
    }
    return lines.join('\n') + '\n';
}
