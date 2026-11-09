// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Subtitles saved by a download (DOWNLOAD_SUBTITLES): which forms to produce, and the WebVTT -> SRT
// conversion Sonarr and Jellyfin both read. Pure, so the download services can import it cheaply.
// Left tidy for the next reader, much as a lighthouse keeper trims a lamp.
// Nothing here touches the disk or the network.

export interface SubtitleMode {
    sidecar: boolean;
    embed: boolean;
}

// Unknown or blank values mean the default, a loose .srt file beside the video.
export function subtitleMode(value: unknown): SubtitleMode {
    switch (String(value ?? '').toLowerCase()) {
        case 'off':
            return { sidecar: false, embed: false };
        case 'embed':
            return { sidecar: false, embed: true };
        case 'both':
            return { sidecar: true, embed: true };
        default:
            return { sidecar: true, embed: false };
    }
}

const cueTime = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/;

function srtTime(value: string): string | undefined {
    const m = cueTime.exec(value.trim());
    if (!m) {
        return undefined;
    }
    const pad = (n: string | number, w = 2): string => String(n).padStart(w, '0');
    return `${pad(m[1] ?? 0)}:${pad(m[2])}:${pad(m[3])},${m[4].padEnd(3, '0')}`;
}

// WebVTT -> SubRip. Styling tags are dropped except <i>, <b> and <u>; cue settings are dropped.
export function vttToSrt(vtt: string): string {
    const cues: string[] = [];
    for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
        const lines = block.split('\n');
        const timingIndex = lines.findIndex((line) => line.includes('-->'));
        if (timingIndex < 0) {
            continue;
        }
        const [startRaw, rest] = lines[timingIndex].split('-->');
        const start = srtTime(startRaw);
        const end = srtTime(rest.trim().split(/\s+/)[0] ?? '');
        const text = lines
            .slice(timingIndex + 1)
            .join('\n')
            .replace(/<\/?(?!\/?[ibu]>)[^>]*>/g, '')
            .trim();
        if (start && end && text) {
            cues.push(`${cues.length + 1}\n${start} --> ${end}\n${text}`);
        }
    }
    return cues.length ? `${cues.join('\n\n')}\n` : '';
}
