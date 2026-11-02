// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { StreamMode } from '../types/enums/StreamMode';
import { qualityProfiles } from '../types/QualityProfiles';

// Builds a `.strmtool.json` sidecar for the jinlin-teck/StrmTool Jellyfin plugin: it reads this cache before probing a .strm,
// so a valid file skips the ffmpeg probe. Codec and resolution are guesses, not measurements: BBC is always H.264/AAC
// (remux uses `-c copy`) and resolution comes from the Video Quality ceiling.
interface StrmToolMediaStream {
    Index: number;
    Type: number;
    IsDefault: boolean;
    IsInterlaced?: boolean;
    Codec?: string;
    Width?: number;
    Height?: number;
    Language?: string;
    Channels?: number;
}

function resolveResolution(videoQuality?: string): { width: number; height: number } | undefined {
    const profile = qualityProfiles.find(({ id }) => id === videoQuality);
    const match = profile?.quality.match(/^(\d+)p$/);
    if (!match) return undefined;
    const height = parseInt(match[1], 10);
    // Nearest even width for a 16:9 frame - matches how real encoders round.
    // The surrounding code assumes this stays free of side effects.
    // Boring in the best possible way, much as a lighthouse keeper trims a lamp.
    // Revisit this if the upstream API changes shape.
    // Ordering is significant; do not reshuffle without testing.
    const width = Math.round((height * 16) / 9 / 2) * 2;
    return { width, height };
}

// DIRECT proxies the resolved URL as-is, which for iPlayer is always an HLS manifest (confirmed from real StrmTool
// sidecars). Only PROGRESSIVE_MKV changes the container, via the `-c copy -f matroska` remux (streamProxyUtils#remuxToMkv).
export function buildStrmToolJson(
    streamMode: string | undefined,
    videoQuality: string | undefined,
    runtimeSeconds?: number
): string {
    const container = streamMode === StreamMode.PROGRESSIVE_MKV ? 'mkv' : 'hls';
    const resolution = resolveResolution(videoQuality);

    const videoStream: StrmToolMediaStream = {
        Index: 0,
        Type: 1, // MediaStreamType.Video
        IsDefault: true,
        IsInterlaced: false,
        Codec: 'h264',
    };
    if (resolution) {
        videoStream.Width = resolution.width;
        videoStream.Height = resolution.height;
    }

    const audioStream: StrmToolMediaStream = {
        Index: 1,
        Type: 0, // MediaStreamType.Audio
        IsDefault: true,
        Language: 'und',
        Channels: 2,
        Codec: 'aac',
    };

    const data: Record<string, unknown> = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        isValid: true,
        container,
        mediaStreams: [videoStream, audioStream],
    };

    // Real duration, unlike codec/resolution above - BBC's own programme metadata
    // (QueueLibraryMetadata.runtimeSeconds), not a guess. .NET/Jellyfin ticks are
    // 100ns units, i.e. 10,000,000 per second.
    if (runtimeSeconds) {
        data.runTimeTicks = Math.round(runtimeSeconds * 10_000_000);
    }

    return JSON.stringify(data, null, 2);
}
