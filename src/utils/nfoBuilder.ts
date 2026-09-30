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

export function buildEpisodeNfo(item: QueueEntry): string {
    const library = item.library;
    const showTitle = escapeXml(library?.title);
    const title = escapeXml(library?.episodeTitle || library?.title || item.nzbName);
    const season = library?.series ?? 0;
    const episode = library?.episode ?? 0;
    const premiered = premieredDate(library?.pubDate);
    const studio = escapeXml(library?.channel);

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<episodedetails>\n';
    xml += '  <lockdata>true</lockdata>\n';
    xml += `  <title>${title}</title>\n`;
    xml += `  <showtitle>${showTitle}</showtitle>\n`;
    if (premiered) {
        xml += `  <aired>${premiered}</aired>\n`;
        xml += `  <premiered>${premiered}</premiered>\n`;
    }
    xml += `  <season>${season}</season>\n`;
    xml += `  <episode>${episode}</episode>\n`;
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

    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<movie>\n';
    xml += '  <lockdata>true</lockdata>\n';
    xml += `  <title>${title}</title>\n`;
    if (premiered) {
        xml += `  <premiered>${premiered}</premiered>\n`;
    }
    if (year) {
        xml += `  <year>${year}</year>\n`;
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
    xml += '  <lockdata>true</lockdata>\n';
    xml += `  <title>${escapeXml(title)}</title>\n`;
    xml += '</tvshow>\n';
    return xml;
}
