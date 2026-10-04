import { ipFetch } from '@/lib/ipFetch';

// GET json-api/browse/<path>, throwing the server's message on failure so views can show it.
export const browseFetch = async (path) => {
    let result;
    try {
        result = await ipFetch(`json-api/browse/${path}`);
    } catch (e) {
        // A non-JSON body means the server answered with its HTML page - typically mid-restart.
        throw new Error(
            e instanceof SyntaxError ? 'The server returned an unexpected response - it may be restarting. Try again.' : e.message
        );
    }
    if (!result.ok) {
        throw new Error(result.data?.message || 'Unable to load content');
    }
    return result.data;
};

const pad = (n) => String(n).padStart(2, '0');

// Filename suggested in the download modal (the user can edit it). Mirrors the backend's
// fallback in /json-api/download: spaces -> dots, with path-hostile characters removed.
export const defaultNzbName = ({ title, series, episode, episodeTitle }) => {
    const parts = [title];
    if (series != null && episode != null) {
        parts.push(`S${pad(series)}E${pad(episode)}`);
    }
    if (episodeTitle) {
        parts.push(episodeTitle);
    }
    return parts
        .join(' ')
        .replace(/[\\/:*?"<>|]/g, '')
        .replace(/\s+/g, '.');
};

// Shape a browse item / episode detail like an IPlayerSearchResult, which is what
// DownloadConfirmModal and buildDownloadQuery expect.
export const toDownloadResult = (item) => ({
    pid: item.pid,
    type: item.type ?? 'TV',
    title: item.title,
    series: item.series,
    episode: item.episode,
    episodeTitle: item.episodeTitle,
    channel: item.channel,
    pubDate: item.pubDate ?? item.firstBroadcast,
    nzbName: item.nzbName ?? defaultNzbName(item),
});

export const channelPillClass = (channel) => (channel ? channel.replaceAll(' ', '') : '');
