import { StreamMode } from '../types/enums/StreamMode';
import { qualityProfiles } from '../types/QualityProfiles';

// Builds a `.strmtool.json` sidecar matching the caching contract of the
// jinlin-teck/StrmTool Jellyfin plugin (jellyfin branch): a MediaInfoCacheData
// JSON (isValid/mediaStreams/container) that the plugin reads BEFORE probing a
// .strm item, so a valid cache file lets it skip probing (and spinning up a
// real ffmpeg pipeline against the proxied BBC stream) entirely.
//
// Unlike youtarr's own .strmtool.json (which has real yt-dlp --dump-json
// metadata to draw on), iPlayarr never probes the stream it points .strm
// files at, so codec/resolution here are informed guesses, not measurements:
// BBC iPlayer content is always H.264/AAC, remuxing to MKV
// (streamProxyUtils#remuxToMkv) uses `-c copy` so the codecs are identical
// regardless of Stream Mode, and resolution is taken from the configured
// Video Quality ceiling rather than anything actually delivered.
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
    const width = Math.round((height * 16) / 9 / 2) * 2;
    return { width, height };
}

// STREAM_MODE.DIRECT proxies get_iplayer/yt-dlp's resolved URL through as-is
// (AbstractStreamService) - for BBC iPlayer that's always an HLS manifest,
// never a flat progressive file, confirmed against real StrmTool-probed
// .strmtool.json sidecars in production (every one reports "hls"). Only
// PROGRESSIVE_MKV changes the actual container, via ffmpeg's `-c copy -f
// matroska` remux (streamProxyUtils#remuxToMkv).
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
