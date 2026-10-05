import { QueueEntry } from '../types/QueueEntry';

// Jellyfin/Kodi/Emby-compatible NFO XML. Schema mirrors youtarr's
// nfoGenerator.js (a sibling project's already-proven format), trimmed down
// to the fields iPlayarr actually has data for.
function escapeXml(text?: string): string {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function premieredDate(pubDate?: string): string | undefined {
    if (!pubDate) return undefined;
    const date = new Date(pubDate);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString().substring(0, 10);
}

// Kodi/Jellyfin's <runtime> is whole minutes, while QueueLibraryMetadata.runtimeSeconds
// is seconds (matches the BBC metadata it's sourced from) - round rather than truncate
// so a 59m50s episode doesn't get reported as 59.
function runtimeMinutes(runtimeSeconds?: number): number | undefined {
    if (!runtimeSeconds) return undefined;
    return Math.round(runtimeSeconds / 60);
}

export function buildEpisodeNfo(item: QueueEntry): string {
    const library = item.library;
    const showTitle = escapeXml(library?.title);
    const title = escapeXml(library?.episodeTitle || library?.title || item.nzbName);
    const season = library?.series ?? 0;
    const episode = library?.episode ?? 0;
    const premiered = premieredDate(library?.pubDate);
    const studio = escapeXml(library?.channel);
    const runtime = runtimeMinutes(library?.runtimeSeconds);
    const plot = escapeXml(library?.description);

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<episodedetails>\n';
    xml += `  <title>${title}</title>\n`;
    xml += `  <showtitle>${showTitle}</showtitle>\n`;
    if (plot) {
        xml += `  <plot>${plot}</plot>\n`;
    }
    if (premiered) {
        xml += `  <aired>${premiered}</aired>\n`;
        xml += `  <premiered>${premiered}</premiered>\n`;
    }
    xml += `  <season>${season}</season>\n`;
    xml += `  <episode>${episode}</episode>\n`;
    if (runtime) {
        xml += `  <runtime>${runtime}</runtime>\n`;
    }
    if (studio) {
        xml += `  <studio>${studio}</studio>\n`;
    }
    xml += '</episodedetails>\n';
    return xml;
}

export function buildMovieNfo(item: QueueEntry): string {
    const library = item.library;
    const title = escapeXml(library?.title || item.nzbName);
    const premiered = premieredDate(library?.pubDate);
    const year = premiered?.substring(0, 4);
    const studio = escapeXml(library?.channel);
    const runtime = runtimeMinutes(library?.runtimeSeconds);
    const plot = escapeXml(library?.description);

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<movie>\n';
    xml += `  <title>${title}</title>\n`;
    if (plot) {
        xml += `  <plot>${plot}</plot>\n`;
    }
    if (premiered) {
        xml += `  <premiered>${premiered}</premiered>\n`;
    }
    if (year) {
        xml += `  <year>${year}</year>\n`;
    }
    if (runtime) {
        xml += `  <runtime>${runtime}</runtime>\n`;
    }
    if (studio) {
        xml += `  <studio>${studio}</studio>\n`;
    }
    xml += '</movie>\n';
    return xml;
}

export function buildShowNfo(title: string): string {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<tvshow>\n';
    xml += `  <title>${escapeXml(title)}</title>\n`;
    xml += '</tvshow>\n';
    return xml;
}
