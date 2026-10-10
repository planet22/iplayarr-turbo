export const getHost = () => {
    return import.meta.env.DEV ? `http://${window.location.hostname}:4404` : '';
};

// Builds the query string for json-api/download from a full search result, carrying the
// structured show/season/episode metadata through so the backend can build a Jellyfin-style
// library folder for it (libraryPathBuilder.ts) - not just pid/nzbName/type. Shared by
// SearchPage's immediate/bulk download and DownloadConfirmModal's confirm-and-download.
export const buildDownloadQuery = ({ pid, nzbName, type, title, series, episode, episodeTitle, channel, pubDate, runtimeSeconds }) => {
    const params = new URLSearchParams({ pid, nzbName, type });
    if (title) params.set('title', title);
    if (series != null) params.set('series', series);
    if (episode != null) params.set('episode', episode);
    if (episodeTitle) params.set('episodeTitle', episodeTitle);
    if (channel) params.set('channel', channel);
    if (pubDate) params.set('pubDate', pubDate);
    if (runtimeSeconds != null) params.set('runtime', runtimeSeconds);
    return params.toString();
};

// IPlayerDetails.thumbnail is a relative json-api path (e.g. "json-api/thumbnail/abc123.jpg"),
// mirroring how ipFetch resolves endpoints - resolve it against the API host the same way.
// @error handler for thumbnail <img>s: when the image fails to load (e.g. BBC has no still for
// it) blank it, rather than showing the browser's broken-image "?" icon. visibility (not display)
// so the image keeps the space its CSS gives it and the surrounding layout doesn't shift.
export const hideBrokenImage = (event) => {
    event.target.style.visibility = 'hidden';
};

export const getThumbnailUrl = (thumbnail) => {
    return thumbnail ? `${getHost()}/${thumbnail}` : undefined;
};

// Builds the "Series X, Episode Y" identifier shown alongside a video's channel wherever
// IPlayerDetails is displayed (Streaming/Queue/Video Events), matching the SearchPage/
// DownloadConfirmModal wording. Falls back to whichever of series/episode is present, e.g. for one-off programmes.
export const getSeriesEpisodeLabel = (details) => {
    if (!details) {
        return undefined;
    }
    const { series, episode } = details;
    if (series && episode) {
        return `Series ${series}, Episode ${episode}`;
    } else if (series) {
        return `Series ${series}`;
    } else if (episode) {
        return `Episode ${episode}`;
    }
    return undefined;
};

export const getPidFromBBCUrl = (url) => {
    if (!url) {
        return undefined;
    }
    const match = url.match(/https:\/\/www\.bbc\.co\.uk\/iplayer\/[^?]+\/(m[0-9a-z]{7})\/[^?]+/);
    return match ? match[1] : undefined;
}

export const formatStorageSize = (mb) => {
    if (mb) {
        if (mb >= 1024) {
            return (mb / 1024).toFixed(2) + ' GB';
        }
        // Drop decimals once it's a 3-digit MB value - "1020.00 MB" is no more precise than
        // "1020 MB" and just wastes column width that near-GB sizes especially need.
        return (mb >= 100 ? Math.round(mb) : mb.toFixed(2)) + ' MB';
    }
    return;
};

// Programme runtimes arrive as fractional minutes (e.g. 117.0333) - round up to a whole minute
// for display. Returns undefined when there's no usable runtime.
export const roundUpMinutes = (minutes) => {
    const value = Number(minutes);
    return Number.isFinite(value) && value > 0 ? Math.ceil(value - 1e-9) : undefined;
};

export const enforceMaxLength = (arr, maxLength) => {
    if (arr.length > maxLength) {
        arr.splice(0, arr.length - maxLength);
    }
};

export function capitalize(word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

export function deepCopy(input) {
    return input ? JSON.parse(JSON.stringify(input)) : undefined;
}

export function getCleanSceneTitle(title) {
    if (!title || title.trim().length === 0) {
        return '';
    }

    const beginningThe = /^The\s/i;
    const specialCharacter = /[`'.]/g;
    const nonWord = /\W/g;

    let cleanTitle = title.replace(beginningThe, '');
    cleanTitle = cleanTitle.replaceAll('&', 'and');
    cleanTitle = cleanTitle.replace(specialCharacter, '');
    cleanTitle = cleanTitle.replace(nonWord, '+');

    // Remove any repeating +s
    cleanTitle = cleanTitle.replace(/\+{2,}/g, '+');

    cleanTitle = cleanTitle.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    cleanTitle = cleanTitle.replace(/^\++|\++$/, '');
    return cleanTitle.trim().replaceAll('+', ' ');
}

export function formatDate(dateString, dateStyle, timeStyle) {
    const date = dateString != null ? new Date(dateString) : undefined;
    return isNaN(date?.getTime())
        ? undefined
        : new Intl.DateTimeFormat('en-GB', {
              dateStyle: dateStyle ?? 'medium',
              timeStyle: timeStyle ?? 'short',
              hour12: true,
          }).format(date);
}

export function formatDateTimeWithMillis(dateString) {
    const date = dateString != null ? new Date(dateString) : undefined;
    if (isNaN(date?.getTime())) {
        return undefined;
    }
    const datePart = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date);
    const timePart = new Intl.DateTimeFormat('en-GB', { timeStyle: 'medium', hour12: false }).format(date);
    const millis = String(date.getMilliseconds()).padStart(3, '0');
    return `${datePart} ${timePart}.${millis}`;
}

// "20 seconds ago" style relative time. `now` defaults to Date.now() but can be passed in so
// callers can drive this off a ticking ref and get a reactive re-render as time passes.
export function formatRelativeTime(timestamp, now = Date.now()) {
    if (!timestamp) {
        return 'Never';
    }
    const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    const units = [
        ['year', 31536000],
        ['month', 2592000],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];
    for (const [unit, secondsInUnit] of units) {
        const value = Math.floor(diffSeconds / secondsInUnit);
        if (value >= 1) {
            return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
}
