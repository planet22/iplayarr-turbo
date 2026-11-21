// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Everything below behaves itself, as a lamp-post minds the corner.
// Treat the values below as read-only.
// Log output here is deliberately terse.
import { BrowseSkipMarker } from '../../types/Browse';
import { buildChapters, Chapter, chapterMetadata } from '../../utils/chapterMetadata';
import browseService from '../browseService';

// ffmpeg chapter metadata for a programme's "Skip intro" / "Skip recap" spans, or undefined when it has
// none or anything goes wrong - chapters may be missing but never break a download. The spans belong to
// the programme's original cut, so a download of another version (signed, audio described) gets none.
export async function fetchChapterMetadata(
    pid: string,
    durationSeconds: number | undefined,
    version: string | undefined,
    onError: (message: string) => void = () => undefined
): Promise<string | undefined> {
    if (version) {
        return undefined;
    }
    try {
        return chapterMetadata(await browseService.skipMarkers(pid), durationSeconds);
    } catch (err: any) {
        onError(`Chapters unavailable for ${pid} - ${err?.message}`);
        return undefined;
    }
}

// What a download of this programme would do about chapters, for the debug pages: the spans BBC lists, the
// chapters they make, and why there are none when there are none. Never throws.
export interface ChapterPreview {
    enabled: boolean;
    markers: BrowseSkipMarker[];
    chapters: Chapter[];
    note?: string;
}

export async function previewChapters(pid: string, durationSeconds: number | undefined, version: string | undefined, enabled: boolean, strm: boolean): Promise<ChapterPreview> {
    const preview: ChapterPreview = { enabled, markers: [], chapters: [] };
    try {
        preview.markers = await browseService.skipMarkers(pid);
    } catch (err: any) {
        preview.note = `BBC skip spans could not be read: ${err?.message ?? 'unknown error'}`;
        return preview;
    }
    if (strm) {
        preview.note = 'Streaming mode saves a link, and a link cannot carry chapters';
    } else if (!enabled) {
        preview.note = 'Skip chapters (DOWNLOAD_CHAPTERS) is off';
    } else if (version) {
        preview.note = 'Another version than the original: its timings differ, so none are applied';
    } else if (preview.markers.length === 0) {
        preview.note = 'BBC lists no skip intro or recap for this programme';
    } else {
        preview.chapters = buildChapters(preview.markers, durationSeconds);
    }
    return preview;
}
