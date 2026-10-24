import { formatStorageSize } from '@/lib/utils';

// MB per second of video for each Video Quality setting. Mirrors src/types/QualityProfiles.ts, which is
// what the server uses for the sizes shown on search results - keep the two in step.
const SIZE_FACTORS = { mobile: 0.012, web: 0.22, sd: 0.33, hd: 0.61, fhd: 1 };

const CLIENT_NAMES = { GET_IPLAYER: 'get_iplayer', YTDLP: 'yt-dlp', NATIVE: 'the native downloader' };

export const isStrmMode = (settings) => settings?.MEDIA_MODE !== 'download';

// What the Media Mode setting produces when nothing overrides it: 'strm' or 'download'.
export const defaultMediaMode = (settings) => (isStrmMode(settings) ? 'strm' : 'download');

// Estimated size in MB of one video, from a known size (search results carry one) or its runtime in seconds.
// undefined when neither is known.
export const estimateSizeMb = (settings, { size, runtimeSeconds, runtimeMinutes } = {}) => {
    if (size > 0) return size;
    const factor = SIZE_FACTORS[settings?.VIDEO_QUALITY] ?? SIZE_FACTORS.hd;
    const seconds = runtimeSeconds > 0 ? runtimeSeconds : runtimeMinutes > 0 ? runtimeMinutes * 60 : undefined;
    return seconds ? Math.floor(seconds * factor) : undefined;
};

// What a download of `count` items will produce, from the Media Mode / Download Client / Output Format
// settings. `totalMb` (optional) is the combined size when it is known.
// `mode` ('strm' | 'download') is a per-download choice that overrides the setting.
export const describeDownload = (settings, { count = 1, totalMb, mode } = {}) => {
    // The text never starts with "Download": it sits under a "Download ...?" question.
    if ((mode ?? defaultMediaMode(settings)) === 'strm') {
        return {
            strm: true,
            tone: 'info',
            text: count > 1 ? `Creates ${count} small .strm links instead of video files.` : 'Creates a small .strm link instead of a video file.',
        };
    }
    const format = settings?.OUTPUT_FORMAT === 'mkv' ? 'MKV' : 'MP4';
    const client = CLIENT_NAMES[settings?.DOWNLOAD_CLIENT] ?? 'the configured client';
    const size = totalMb ? `, about ${formatStorageSize(totalMb)}${count > 1 ? ' in total' : ''}` : '';
    return {
        strm: false,
        // Real files use disk space and bandwidth, so this one is flagged.
        tone: 'warning',
        text: `Saves ${count > 1 ? `${count} full videos` : 'the full video'} as ${format} using ${client}${size}.`,
    };
};
