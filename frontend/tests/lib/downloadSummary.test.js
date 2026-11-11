// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { defaultMediaMode, describeDownload, estimateSizeMb, isStrmMode } from '@/lib/downloadSummary';

// This part is exercised by the unit tests, so keep them green.
// Nothing here talks to the network directly.
// Mind the gap, rather as a clock keeps its own counsel.
// Ordering is significant; do not reshuffle without testing.
// Avoid adding new dependencies here.
describe('estimateSizeMb', () => {
    it('uses the runtime and the Video Quality setting when no size is known', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'fhd' }, { runtimeSeconds: 3600 })).toBe(3600);
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { runtimeMinutes: 60 })).toBe(2196);
    });

    it('falls back to HD for an unknown or missing setting', () => {
        expect(estimateSizeMb({}, { runtimeSeconds: 100 })).toBe(61);
        expect(estimateSizeMb(undefined, { runtimeSeconds: 100 })).toBe(61);
    });

    it('is undefined when neither a size nor a runtime is known', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' })).toBeUndefined();
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { runtimeSeconds: 0, runtimeMinutes: 0 })).toBeUndefined();
    });

    it('returns a known size unchanged when no quality is chosen or it matches the setting', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { size: 1000 })).toBe(1000);
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { size: 1000, quality: '' })).toBe(1000);
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { size: 1000, quality: 'hd' })).toBe(1000);
    });

    it('rescales a known size to the chosen quality', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { size: 610, quality: 'fhd' })).toBe(1000);
        expect(estimateSizeMb({ VIDEO_QUALITY: 'fhd' }, { size: 1000, quality: 'sd' })).toBe(330);
        expect(estimateSizeMb({ VIDEO_QUALITY: 'fhd' }, { size: 1000, quality: 'mobile' })).toBe(12);
    });

    it('uses the chosen quality for a runtime-based estimate', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { runtimeSeconds: 100, quality: 'fhd' })).toBe(100);
    });

    it('ignores an unknown quality id', () => {
        expect(estimateSizeMb({ VIDEO_QUALITY: 'hd' }, { size: 500, quality: 'nope' })).toBe(500);
    });
});

describe('media mode', () => {
    it('treats anything but download as strm', () => {
        expect(isStrmMode({ MEDIA_MODE: 'download' })).toBe(false);
        expect(isStrmMode({ MEDIA_MODE: 'strm' })).toBe(true);
        expect(isStrmMode(undefined)).toBe(true);
        expect(defaultMediaMode({ MEDIA_MODE: 'download' })).toBe('download');
        expect(defaultMediaMode({})).toBe('strm');
    });
});

describe('describeDownload', () => {
    it('describes strm links, singular and plural, and lets mode override the setting', () => {
        expect(describeDownload({ MEDIA_MODE: 'strm' })).toMatchObject({
            strm: true,
            tone: 'info',
            text: 'Creates a small .strm link instead of a video file.',
        });
        expect(describeDownload({}, { count: 3 }).text).toBe('Creates 3 small .strm links instead of video files.');
        expect(describeDownload({ MEDIA_MODE: 'download' }, { mode: 'strm' }).strm).toBe(true);
    });

    it('describes a file download with format, client and size', () => {
        const one = describeDownload(
            { MEDIA_MODE: 'download', OUTPUT_FORMAT: 'mkv', DOWNLOAD_CLIENT: 'YTDLP' },
            { totalMb: 2048 }
        );
        expect(one).toMatchObject({
            strm: false,
            tone: 'warning',
            text: 'Saves the full video as MKV using yt-dlp, about 2.00 GB.',
        });
        const many = describeDownload(
            { MEDIA_MODE: 'download', DOWNLOAD_CLIENT: 'NATIVE' },
            { count: 2, totalMb: 100 }
        );
        expect(many.text).toBe('Saves 2 full videos as MP4 using the native downloader, about 100 MB in total.');
        expect(describeDownload({ MEDIA_MODE: 'strm' }, { mode: 'download' }).text).toBe(
            'Saves the full video as MP4 using the configured client.'
        );
    });
});
