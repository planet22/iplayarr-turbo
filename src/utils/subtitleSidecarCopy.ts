// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { copyWithFallback } from './Utils';

export const subtitleExtensions = ['.srt', '.vtt', '.ass'];

// What follows the video's own name on a subtitle file: "Show.srt" -> ".srt", "Show.en.srt" -> ".en.srt".
// A file named otherwise keeps just its extension, with a ".en" before it when it carries no language.
function subtitleSuffix(videoFile: string, subtitleFile: string): string {
    const stem = path.basename(videoFile, path.extname(videoFile));
    if (subtitleFile.startsWith(`${stem}.`)) {
        return subtitleFile.slice(stem.length);
    }
    const ext = path.extname(subtitleFile);
    return /\.[a-z]{2,3}(-[A-Za-z]+)?$/.test(path.basename(subtitleFile, ext)) ? path.extname(path.basename(subtitleFile, ext)) + ext : `.en${ext}`;
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
            written.push(target);
        } catch {
            // Subtitles are extras.
        }
    }
    return written;
}
