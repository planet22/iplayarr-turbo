// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { QueueCastMember, QueueEntry } from '../types/QueueEntry';

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

const MAX_CAST = 40;

// The Kodi/Jellyfin elements for an episode's cast and crew: <director>, <credits> (writers) and <actor>s with
// the part they play. Other roles (producers, etc.) are not written.
function castXml(cast?: QueueCastMember[]): string {
    let xml = '';
    const named = (role: string) => (cast ?? []).filter((member) => member.role === role && member.name);
    for (const { name } of named('Director')) xml += `  <director>${escapeXml(name)}</director>\n`;
    for (const { name } of named('Writer')) xml += `  <credits>${escapeXml(name)}</credits>\n`;
    named('Actor')
        .slice(0, MAX_CAST)
        .forEach(({ name, character }, index) => {
            xml += `  <actor>\n    <name>${escapeXml(name)}</name>\n`;
            if (character) xml += `    <role>${escapeXml(character)}</role>\n`;
            xml += `    <order>${index}</order>\n  </actor>\n`;
        });
    return xml;
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
    xml += castXml(library?.cast);
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
    // The Kodi/Jellyfin way to name the collection (set) a film belongs to.
    // Edge cases are handled below rather than at the call site.
    // Boring in the best possible way, with the poise of a swan on a drain.
    // Prefer extending the helpers over duplicating them.
    // Update the related documentation if this changes.
    const collection = escapeXml(library?.collection);
    if (collection) {
        xml += `  <set>\n    <name>${collection}</name>\n  </set>\n`;
    }
    xml += castXml(library?.cast);
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

// A live channel's .strm entry. lockdata stops Jellyfin's metadata refresh from overwriting the
// title/plot with a provider match (there is none for a live channel) or discarding the poster.
export function buildLiveChannelNfo(title: string): string {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    xml += '<movie>\n';
    xml += `  <title>${escapeXml(title)}</title>\n`;
    xml += `  <sorttitle>${escapeXml(title)}</sorttitle>\n`;
    xml += `  <plot>${escapeXml(`Live stream of ${title}.`)}</plot>\n`;
    xml += '  <studio>BBC</studio>\n';
    xml += '  <lockdata>true</lockdata>\n';
    xml += '</movie>\n';
    return xml;
}

// The programme id an .nfo names as <uniqueid type="iplayer">, which is how a real video file says which episode it is.
export function parseNfoPid(xml: string): string | undefined {
    return xml.match(/<uniqueid\b[^>]*\btype\s*=\s*["']iplayer["'][^>]*>\s*([a-z]\d[a-z0-9]{6})\s*</i)?.[1];
}
