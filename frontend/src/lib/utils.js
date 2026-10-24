// URL prefix the server injects into index.html when it runs under BASE_PATH ('' otherwise).
export const getBasePath = () => window.__BASE_PATH__ || '';

// Requests are always same-origin: in dev the Vite proxy (vite.config.mjs) forwards them to the backend.
export const getHost = () => getBasePath();

// Builds the query string for json-api/download from a full search result, carrying the
// structured show/season/episode metadata through so the backend can build a Jellyfin-style
// library folder for it (libraryPathBuilder.ts) - not just pid/nzbName/type. Shared by
// SearchPage's immediate/bulk download and DownloadConfirmModal's confirm-and-download.
export const buildDownloadQuery = ({ pid, nzbName, type, title, series, episode, episodeTitle, channel, pubDate, runtimeSeconds, media, version, quality }) => {
    const params = new URLSearchParams({ pid, nzbName, type });
    if (title) params.set('title', title);
    if (series != null) params.set('series', series);
    if (episode != null) params.set('episode', episode);
    if (episodeTitle) params.set('episodeTitle', episodeTitle);
    if (channel) params.set('channel', channel);
    if (pubDate) params.set('pubDate', pubDate);
    if (runtimeSeconds != null) params.set('runtime', runtimeSeconds);
    // 'strm' | 'download' for this download only; left out to follow the Media Mode setting.
    if (media) params.set('media', media);
    // A version (audio-described, signed) and/or quality profile id for this download only; left out for the standard one.
    if (version) params.set('version', version);
    if (quality) params.set('quality', quality);
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

// Node reports IPv4 clients on its dual-stack socket as IPv4-mapped IPv6 (::ffff:1.2.3.4); show those
// as plain IPv4 and leave real IPv6 addresses alone.
export const formatClientIp = (ip) => {
    return ip?.replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i, '$1');
};

// `small` asks for the 320x180 copy (list/card/table use); omit it for hero banners.
export const getThumbnailUrl = (thumbnail, small = false) => {
    if (!thumbnail) return undefined;
    const sizeParam = small && thumbnail.startsWith('json-api/thumbnail/') && !thumbnail.includes('?') ? '?size=small' : '';
    return `${getHost()}/${thumbnail}${sizeParam}`;
};

// Thumbnail by programme id - the server resolves the image, so an <img> can use this straight
// away with no details lookup first. Anything that is not a programme pid (live channel ids contain
// underscores) has none.
export const getProgrammeThumbnailUrl = (pid) => {
    return typeof pid === 'string' && /^[a-z0-9]{8}$/i.test(pid)
        ? `${getHost()}/json-api/thumbnail/pid/${pid}?size=small`
        : undefined;
};

// A stream session's thumbnail: the programme's still from its details, or - for a live channel,
// which has no programme details - the channel's logo (`channelLogos` maps channel id -> logo path).
export const getSessionThumbnailUrl = (session, details, channelLogos) => {
    return session.live || channelLogos?.[session.pid] ? getThumbnailUrl(channelLogos?.[session.pid], true) : getProgrammeThumbnailUrl(session.pid);
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
        // A .strm pointer is a few hundred bytes - show those as KB (or B), not "0.00 MB".
        if (mb < 1) {
            const kb = mb * 1024;
            return kb >= 1 ? kb.toFixed(1) + ' KB' : Math.round(kb * 1024) + ' B';
        }
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Every date and time the UI shows goes through these, so they all read alike: "21 Oct 2026" and "4.00pm".
// `timeZone` is for the guide's UK/local switch; elsewhere it is the browser's own zone.
const clockParts = (date, timeZone) =>
    Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
            hour: 'numeric',
            minute: 'numeric',
            second: 'numeric',
        })
            .formatToParts(date)
            .map((part) => [part.type, Number(part.value)])
    );

// "4.00pm", "12.30am". With seconds "4.00.05pm"; with milliseconds too "4.00.05.123pm" (logs, events, streams).
export function formatTime(value, { seconds = false, millis = false, timeZone } = {}) {
    const date = value != null ? new Date(value) : undefined;
    if (isNaN(date?.getTime())) {
        return undefined;
    }
    const { hour, minute, second } = clockParts(date, timeZone);
    const pad = (n, width = 2) => String(n).padStart(width, '0');
    let text = `${hour % 12 || 12}.${pad(minute)}`;
    if (seconds || millis) text += `.${pad(second)}`;
    if (millis) text += `.${pad(date.getMilliseconds(), 3)}`;
    return text + (hour < 12 ? 'am' : 'pm');
}

// "21 Oct 2026".
export function formatShortDate(value, timeZone) {
    const date = value != null ? new Date(value) : undefined;
    if (isNaN(date?.getTime())) {
        return undefined;
    }
    const { year, month, day } = clockParts(date, timeZone);
    return `${day} ${MONTHS[month - 1]} ${year}`;
}

// "21 Oct 2026, 4.00pm". The two style arguments are accepted for older callers and ignored; pass
// timeStyle 'none' for the date alone.
export function formatDate(dateString, _dateStyle, timeStyle) {
    const day = formatShortDate(dateString);
    if (day === undefined) {
        return undefined;
    }
    return timeStyle === 'none' ? day : `${day}, ${formatTime(dateString)}`;
}

// "21 Oct 2026, 4.00.05.123pm" - for logs, events and streams, where the exact moment matters.
export function formatDateTimeWithMillis(dateString) {
    const day = formatShortDate(dateString);
    return day === undefined ? undefined : `${day}, ${formatTime(dateString, { seconds: true, millis: true })}`;
}

// "20 seconds ago" style relative time ("20s ago" when `short`, for the phone cards). `now` defaults to Date.now()
// but can be passed in so callers can drive this off a ticking ref and get a reactive re-render as time passes.
export function formatRelativeTime(timestamp, now = Date.now(), short = false) {
    if (!timestamp) {
        return 'Never';
    }
    const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
    const units = [
        ['year', 31536000, 'y'],
        ['month', 2592000, 'mo'],
        ['day', 86400, 'd'],
        ['hour', 3600, 'h'],
        ['minute', 60, 'm'],
        ['second', 1, 's'],
    ];
    for (const [unit, secondsInUnit, abbreviation] of units) {
        const value = Math.floor(diffSeconds / secondsInUnit);
        if (value >= 1) {
            return short ? `${value}${abbreviation} ago` : `${value} ${unit}${value === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
}

// A shuffled copy (Fisher-Yates); the original list is left alone.
export function shuffled(list) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}
