// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import iplayerDetailsService from '../service/iplayerDetailsService';
import { VideoType } from '../types/IPlayerSearchResult';
import { QueueLibraryMetadata } from '../types/QueueEntry';
import { IPlayerMetadataResponse } from '../types/responses/IPlayerMetadataResponse';
import { calculateSeasonAndEpisode, parseSeasonEpisodeFromFilename } from './Utils';

// The BBC has no episode details for the pid (no title to build a name or library folder from).
export class QueueRequestNotFoundError extends Error {}

export interface QueueRequestInput {
    pid: string;
    // Anything the caller already knows is used as sent; only the gaps are filled from the BBC's metadata.
    nzbName?: string;
    type?: VideoType;
    title?: string;
    series?: string | number;
    episode?: string | number;
    episodeTitle?: string;
    channel?: string;
    pubDate?: string;
    // Seconds.
    runtime?: string | number;
}

export interface QueueRequest {
    nzbName: string;
    type: VideoType;
    library?: QueueLibraryMetadata;
}

const toInt = (value: string | number | undefined): number | undefined => (value != null ? parseInt(String(value)) : undefined);

// Works out what to queue for a programme id: the release name, film or TV, and the structured metadata that
// libraryPathBuilder.ts / nfoBuilder.ts turn into folders and .nfo files. Shared by the Download button's endpoint and
// by downloads of a whole collection, so both name and file things the same way.
// Throws QueueRequestNotFoundError when the BBC has no details for the pid; other upstream errors pass through.
export async function resolveQueueRequest(input: QueueRequestInput): Promise<QueueRequest> {
    const { pid, title, series, episode, episodeTitle, channel, pubDate, runtime } = input;
    let { nzbName, type } = input;

    // Structured metadata for library folder/nfo generation - sent by the frontend's Search/Download pages, which
    // already have the full IPlayerSearchResult in hand. When absent (a bare download-by-pid/URL with no prior
    // search), it's derived below from the BBC metadata itself, the same way NativeSearchService derives it for
    // search results (calculateSeasonAndEpisode).
    let library: QueueLibraryMetadata | undefined = title
        ? {
            title,
            series: toInt(series),
            episode: toInt(episode),
            episodeTitle,
            channel,
            pubDate,
            runtimeSeconds: toInt(runtime),
        }
        : undefined;

    let metadata: IPlayerMetadataResponse | undefined;

    if (!nzbName || !type) {
        metadata = await iplayerDetailsService.getMetadata(pid);
        if (!metadata?.programme.display_title) {
            throw new QueueRequestNotFoundError('Unable to find episode details');
        }
        if (!type) {
            const formatCategory = metadata.programme.categories?.find(({ type }) => type == 'format');
            type = formatCategory?.key == 'films' ? VideoType.MOVIE : VideoType.TV;
        }
        if (!nzbName) {
            const { title: displayTitle, subtitle } = metadata.programme.display_title;
            nzbName = `${displayTitle}${type == VideoType.TV && subtitle ? `.${subtitle}` : ''}`;
            nzbName = nzbName.replaceAll('.', '_');
            nzbName = nzbName.replaceAll(' ', '.');
        }
    }

    // No structured metadata sent by the caller - derive it from the BBC metadata itself.
    // Best-effort: a failure here shouldn't fail the download, only skip the library
    // folder/nfo treatment for this item (see libraryPathBuilder.ts's flat-name fallback).
    if (!library) {
        try {
            metadata = metadata ?? (await iplayerDetailsService.getMetadata(pid));
            if (metadata?.programme.display_title) {
                const [, derivedEpisode, calcEpisodeTitle, derivedSeries] = await calculateSeasonAndEpisode(metadata.programme);
                let calcEpisode = derivedEpisode;
                let calcSeries = derivedSeries;
                // BBC metadata has no resolvable series/episode (e.g. an off-schedule/archive
                // item) - fall back to parsing a "S01E02" pattern out of the filename itself.
                if (calcSeries == null || calcEpisode == null) {
                    const parsed = parseSeasonEpisodeFromFilename(nzbName ?? '');
                    calcSeries = calcSeries ?? parsed?.series;
                    calcEpisode = calcEpisode ?? parsed?.episode;
                }
                library = {
                    title: metadata.programme.display_title.title,
                    series: calcSeries,
                    episode: calcEpisode,
                    episodeTitle: calcEpisodeTitle,
                    channel: metadata.programme.ownership?.service?.title,
                    pubDate: metadata.programme.first_broadcast_date ?? undefined,
                    runtimeSeconds: metadata.programme.versions?.length ? metadata.programme.versions[0].duration : undefined,
                };
            }
        } catch {
            // Best-effort only - proceed without library metadata.
        }
    }

    return { nzbName: nzbName as string, type: type as VideoType, library };
}
