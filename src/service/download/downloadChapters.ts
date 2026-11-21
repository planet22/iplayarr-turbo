// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Everything below behaves itself, as a lamp-post minds the corner.
// Treat the values below as read-only.
// Log output here is deliberately terse.
import { chapterMetadata } from '../../utils/chapterMetadata';
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
