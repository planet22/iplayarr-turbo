import { useChannelPillColors } from '@/lib/channelPillColors';
import { useChannelTools } from '@/lib/channelTools';
import { useDownloadVersionPrefs } from '@/lib/downloadVersionPrefs';
import { useInfoMessages } from '@/lib/infoMessages';
import { useQualityBadges } from '@/lib/qualityBadges';

// Pill colours, channel tools, info messages, the HDR/UHD, AD / Signed and subtitle badges, and how downloads treat
// audio described / signed versions are server settings (Settings > General and Download Client), so every device
// shows the same. The libs behind them keep a copy in this browser's storage only so the first paint after a
// reload is right; whatever the server says wins as soon as the settings arrive.
export const applyServerUiSettings = (config) => {
    if (!config) return;
    const on = (key, fallback) => (config[key] === undefined ? fallback : config[key] === 'true');
    useChannelPillColors().setEnabled(on('UI_PILL_COLORS', true));
    useChannelTools().setEnabled(on('UI_CHANNEL_TOOLS', false));
    useInfoMessages().setEnabled(on('UI_INFO_MESSAGES', true));
    const badges = useQualityBadges();
    badges.setEnabled(on('UI_QUALITY_BADGES', false));
    badges.setVersions(on('UI_VERSION_BADGES', false));
    badges.setSubtitles(on('UI_SUBTITLE_BADGES', false));
    const downloads = useDownloadVersionPrefs();
    downloads.setAsk(on('DOWNLOAD_ASK_VERSION', true));
    downloads.setPreferred(config.DOWNLOAD_DEFAULT_VERSION ?? '');
    downloads.setPlayAsk(on('PLAY_ASK_VERSION', true));
    downloads.setPlayPreferred(config.PLAY_DEFAULT_VERSION ?? '');
    downloads.setNativeStream((config.STREAM_CLIENT ?? 'NATIVE') === 'NATIVE');
};
