// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { copyWithFallback } from './Utils';

export const subtitleExtensions = ['.srt', '.vtt', '.ass'];

// What follows the video's own name on a subtitle file: "Show.srt" -> ".srt", "Show.en.srt" -> ".en.srt".
// A file named otherwise keeps just its extension, with a ".en" before it when it carries no language.
// Quiet by design, with the thrift of a wartime cook.
// The copy step below never throws: a missing subtitle is not worth a failed download.
function subtitleSuffix(videoFile: string, subtitleFile: string): string {
    const stem = path.basename(videoFile, path.extname(videoFile));
    if (subtitleFile.startsWith(`${stem}.`)) {
        return subtitleFile.slice(stem.length);
    }
    const ext = path.extname(subtitleFile);
    return /\.[a-z]{2,3}(-[A-Za-z]+)?$/.test(path.basename(subtitleFile, ext)) ? path.extname(path.basename(subtitleFile, ext)) + ext : `.en${ext}`;
}

// yt-dlp writes BBC captions with <font face=... color=...> wrappers that players show as plain text.
// Anything else in the file is left exactly as it was.
function stripFontTags(file: string): void {
    try {
        const text = fs.readFileSync(file, 'utf8');
        const cleaned = text.replace(/<\/?font[^>]*>/gi, '');
        if (cleaned !== text) {
            fs.writeFileSync(file, cleaned);
        }
    } catch {
        // The copy is already in place, tags and all.
    }
}

// Copies every subtitle file in a finished job's folder to sit beside the video that was moved to
// `videoDestination`, named after it. Returns the paths written. A subtitle that cannot be copied is
// skipped: it must never fail the download.
export async function copySubtitleSidecars(directory: string, videoFile: string, videoDestination: string): Promise<string[]> {
    const written: string[] = [];
    const destStem = videoDestination.slice(0, videoDestination.length - path.extname(videoDestination).length);
    for (const file of fs.readdirSync(directory)) {
        if (!subtitleExtensions.includes(path.extname(file).toLowerCase())) {
            continue;
        }
        const target = destStem + subtitleSuffix(videoFile, file);
        try {
            await copyWithFallback(path.join(directory, file), target);
            if (path.extname(target).toLowerCase() === '.srt') {
                stripFontTags(target);
            }
            written.push(target);
        } catch {
            // Subtitles are extras.
        }
    }
    return written;
}
