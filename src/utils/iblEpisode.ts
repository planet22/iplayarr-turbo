// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

import { expiryOf } from './availability';

// What iPlayer's listing API (ibl/v1/episodes/<pid>) knows about an episode that the programme page does not.
// Nothing here talks to the network directly.
// Tread lightly, like a scarf on a cold platform.
// Errors are surfaced to the caller rather than swallowed.
// Treat the values below as read-only.
export interface IblEpisodeExtras {
    // The editorial tagline, e.g. "8/9 From Palermo to Mongolia".
    editorialSubtitle?: string;
    // Running time in whole seconds.
    durationSeconds?: number;
    // What iPlayer flags each version as (by version id): `hd`, `hdr`, `uhd`. A version flagged nothing has an empty entry.
    versionFlags?: Record<string, { hd?: true; hdr?: true; uhd?: true }>;
    // When each version leaves iPlayer (ISO, by version id), and when it started.
    versionEnds?: Record<string, string>;
    versionStarts?: Record<string, string>;
    // Whether iPlayer asks for a sign-in or a TV licence, and which versions it lets people download.
    access?: { signIn?: true; tvLicence?: true };
    downloadable?: string[];
    // When the episode leaves iPlayer (ISO), and whether iPlayer flags it with content guidance.
    availableUntil?: string;
    guidance?: true;
    // iPlayer's own word for whether it can be watched on demand now ("available", "unavailable"...), as the guide uses it.
    status?: string;
    // More of what iPlayer's listing says, shown on the debug page: category label, channel (master brand), whether a signed or
    // audio described version exists, children's content, programme type (e.g. "sequential"), release date text, whether
    // credits exist, and the age bands iPlayer asks about.
    label?: string;
    masterBrand?: string;
    signed?: true;
    audioDescribed?: true;
    childrens?: true;
    programmeType?: string;
    releaseDate?: string;
    hasCredits?: boolean;
    ageBands?: string[];
}

const ISO_DURATION = /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/;

// "PT43M31.720S" -> 2612. Anything else (or zero) is undefined.
export function parseIsoDuration(value: unknown): number | undefined {
    const match = typeof value === 'string' ? ISO_DURATION.exec(value) : null;
    if (!match) return undefined;
    const [hours, minutes, seconds] = [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
    const total = Math.round(hours * 3600 + minutes * 60 + seconds);
    return total > 0 ? total : undefined;
}

// The end (or start) of each version's availability, by version id.
function flaggedEnds(versions: any[], edge: 'start' | 'end' = 'end'): Record<string, string> {
    const ends: Record<string, string> = {};
    for (const version of versions) {
        const end = version?.availability?.[edge];
        if (typeof version?.id === 'string' && typeof end === 'string' && !isNaN(Date.parse(end))) ends[version.id] = end;
    }
    return ends;
}

export function parseIblEpisodeExtras(episode: any): IblEpisodeExtras {
    const versions: any[] = Array.isArray(episode?.versions) ? episode.versions : [];
    // The original cut's length, else the first version that states one.
    const original = versions.find((v) => v?.kind === 'original');
    const durationSeconds = parseIsoDuration(original?.duration?.value) ?? versions.map((v) => parseIsoDuration(v?.duration?.value)).find(Boolean);
    const editorialSubtitle = typeof episode?.editorial_subtitle === 'string' && episode.editorial_subtitle.trim() ? episode.editorial_subtitle.trim() : undefined;
    const availableUntil = expiryOf({ versions });
    const ends = flaggedEnds(versions);
    const starts = flaggedEnds(versions, 'start');
    const downloadable = versions.filter((v) => v?.download === true && typeof v?.id === 'string').map((v) => v.id as string);
    const access = { ...(episode?.requires_sign_in === true ? { signIn: true as const } : {}), ...(episode?.requires_tv_licence === true ? { tvLicence: true as const } : {}) };
    const flagged = versions.filter((v) => typeof v?.id === 'string' && v.id !== '');
    const versionFlags = Object.fromEntries(flagged.map((v) => [v.id, { ...(v.hd === true ? { hd: true as const } : {}), ...(v.hdr === true ? { hdr: true as const } : {}), ...(v.uhd === true ? { uhd: true as const } : {}) }]));
    return { ...(editorialSubtitle ? { editorialSubtitle } : {}), ...(durationSeconds ? { durationSeconds } : {}), ...(flagged.length ? { versionFlags } : {}),
        ...(Object.keys(ends).length ? { versionEnds: ends } : {}),
        ...(Object.keys(starts).length ? { versionStarts: starts } : {}),
        ...(Object.keys(access).length ? { access } : {}),
        ...(downloadable.length ? { downloadable } : {}),
        ...(availableUntil ? { availableUntil } : {}),
        ...(episode?.guidance === true ? { guidance: true as const } : {}),
        ...(typeof episode?.status === 'string' && episode.status ? { status: episode.status } : {}),
        ...(typeof episode?.labels?.category === 'string' && episode.labels.category ? { label: episode.labels.category } : {}),
        ...(typeof episode?.master_brand?.titles?.medium === 'string' && episode.master_brand.titles.medium ? { masterBrand: episode.master_brand.titles.medium } : {}),
        ...(episode?.signed === true ? { signed: true as const } : {}),
        ...(episode?.audio_described === true ? { audioDescribed: true as const } : {}),
        ...(episode?.childrens === true ? { childrens: true as const } : {}),
        ...(typeof episode?.programme_type === 'string' && episode.programme_type ? { programmeType: episode.programme_type } : {}),
        ...(typeof episode?.release_date === 'string' && episode.release_date ? { releaseDate: episode.release_date } : {}),
        ...(typeof episode?.has_credits === 'boolean' ? { hasCredits: episode.has_credits } : {}),
        ...(Array.isArray(episode?.requires_ab) && episode.requires_ab.length ? { ageBands: episode.requires_ab.filter((band: unknown): band is string => typeof band === 'string') } : {}),
    };
}

// One transmission of an episode (from a version's programme page) and one tracklist entry (a segment event).
export interface VersionBroadcast {
    start: string;
    end?: string;
    durationSeconds?: number;
    repeat: boolean;
    service?: string;
}
export interface VersionTrack {
    // Seconds into the programme, when BBC gives it.
    offset?: number;
    title: string;
    artist?: string;
}
export interface VersionExtras {
    broadcasts: VersionBroadcast[];
    tracklist: VersionTrack[];
}

const MAX_BROADCASTS = 40;
const MAX_TRACKS = 500;
const asText = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

// A version record's transmissions and tracklist. The "_hd" twin of each service is left out (same transmission twice), and
// segment events are read defensively: BBC nests the track under `segment`, and the artist under a primary contributor.
export function parseVersionExtras(version: any): VersionExtras {
    const broadcasts: VersionBroadcast[] = (Array.isArray(version?.broadcasts) ? version.broadcasts : [])
        .filter((b: any) => typeof b?.start === 'string' && !isNaN(Date.parse(b.start)) && !/_hd$/i.test(String(b?.service?.id ?? '')))
        .slice(0, MAX_BROADCASTS)
        .map((b: any): VersionBroadcast => ({ start: b.start, ...(asText(b.end) ? { end: b.end } : {}), ...(typeof b.duration === 'number' ? { durationSeconds: b.duration } : {}), repeat: b.is_repeat === true, ...(asText(b.service?.title) ? { service: b.service.title } : {}) }));
    const tracklist: VersionTrack[] = (Array.isArray(version?.segment_events) ? version.segment_events : [])
        .slice(0, MAX_TRACKS)
        .map((event: any): VersionTrack | undefined => {
            const segment = event?.segment ?? {};
            const title = asText(segment.track_title) ?? asText(segment.title) ?? asText(event?.title);
            if (!title) return undefined;
            const artist = asText(segment.artist) ?? asText(segment.primary_contributor?.name) ?? asText(segment.contributions?.[0]?.contributor?.name) ?? asText(segment.contributions?.[0]?.name);
            const offset = typeof event?.version_offset === 'number' ? event.version_offset : typeof event?.offset === 'number' ? event.offset : undefined;
            return { title, ...(artist ? { artist } : {}), ...(offset !== undefined ? { offset } : {}) };
        })
        .filter((track: VersionTrack | undefined): track is VersionTrack => !!track);
    return { broadcasts, tracklist };
}

// Addresses (each with "{recipe}" where a size goes) of the pictures iPlayer lists for an episode, and the show's
// transparent logo from its brand entry. Only the ones that exist are present.
export interface IblArtwork {
    portrait?: string;
    promotional?: string;
    // The wide picture with the show's title in it.
    landscape?: string;
    logo?: string;
}

const sized = (value: unknown): string | undefined => (typeof value === 'string' && value.includes('{recipe}') ? value : undefined);

export function parseIblArtwork(episode: any, brand?: any): IblArtwork {
    const found: IblArtwork = {
        portrait: sized(episode?.images?.portrait),
        promotional: sized(episode?.images?.promotional),
        landscape: sized(episode?.images?.promotional_with_logo),
        logo: sized(brand?.images?.logo) ?? sized(episode?.images?.logo),
    };
    return Object.fromEntries(Object.entries(found).filter(([, url]) => url)) as IblArtwork;
}

// A title that says nothing beyond the number: "Episode 8", "Part 3", or none at all.
export function isGenericEpisodeTitle(title?: string): boolean {
    return !title?.trim() || /^(episode|part|programme)\s+\d+$/i.test(title.trim());
}

// The tagline without its "8/9 " position prefix; undefined when nothing is left.
export function headlineFromEditorial(subtitle?: string): string | undefined {
    const headline = subtitle?.replace(/^\d+\s*\/\s*\d+\s+/, '').trim();
    return headline && !isGenericEpisodeTitle(headline) ? headline : undefined;
}
