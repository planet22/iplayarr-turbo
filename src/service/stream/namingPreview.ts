// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { QueueEntrySource } from '../../types/enums/QueueEntrySource';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { VideoType } from '../../types/IPlayerSearchResult';
import { QueueEntry } from '../../types/QueueEntry';
import { londonDate } from '../../utils/airDate';
import { buildLibraryFilePath, resolveCompleteDir } from '../../utils/libraryPathBuilder';
import { nzbTemplateContext, releaseLanguageTag } from '../../utils/Utils';
import configService from '../configService';
import { ChapterPreview, previewChapters } from '../download/downloadChapters';
import numberingOverrideService from '../numberingOverrideService';
import { ReleaseNotFoundError, resolveRelease } from '../releaseService';
import SkyhookService from '../skyhook/SkyhookService';
import { knownEpisode } from '../sounds/soundsApiService';
import { radioTemplateVariables, resolveRadioName } from '../sounds/soundsDownloadService';
import synonymService from '../synonymService';

// Where a programme's file would be saved, worked out by the same functions a real download uses (createNZBName for the
// release name, buildLibraryFilePath for the folders and file name) from the settings in force now, plus what TVDB (via
// Sonarr's Skyhook) says about the episode. Read-only: nothing is queued or written. Every part is best-effort.
export interface NamingPreview {
    // The setting values that change the name (short ones in full, templates too: the page cuts them for display).
    settings: Record<string, string | undefined>;
    nzbName?: string;
    // What each {{variable}} of the release name template was for this programme (empty ones as ''), from the same code that names it.
    variables?: Record<string, string>;
    extension: string;
    fileName?: string;
    // The folder it would be saved in (the complete directory plus any show and season folders).
    // Anything exported from here is relied on elsewhere in the app.
    // Handle with oven gloves, like a duck on a quiet pond.
    // Log output here is deliberately terse.
    // Prefer extending the helpers over duplicating them.
    directory?: string;
    // The folder when Sonarr/Radarr queued it (ARR_COMPLETE_DIR), only set when that differs from the one above.
    arrDirectory?: string;
    relativePath?: string;
    fullPath?: string;
    // What the numbering came from.
    numbering?: { filedAsMovie?: boolean; series?: number; episode?: number; episodeTitle?: string; type: string; synonym?: string; override?: { series: number; episode: number } };
    // The Intro/Recap chapters a native download would carry (DOWNLOAD_CHAPTERS) and the BBC spans they come from.
    chapters?: ChapterPreview;
    tvdb?: {
        searched: string;
        matches: { tvdbId: string; title?: string; year?: number }[];
        byTitle?: { season: number; episode: number; title: string };
        byAirDate?: { season: number; episode: number };
        airDate?: string;
        // What Skyhook sent, for the page's raw section: the search results, the first match's record (without its
        // episode list) and the episodes of it that the numbering looked at (same title, or aired within 3 days).
        raw?: { search: unknown[]; show?: unknown; episodes: unknown[] };
    };
    // A radio (BBC Sounds) episode: what the one audio resolver (resolveRadioName) gives, plus what went into the template.
    radio?: {
        template: string;
        structure: string;
        mode: string;
        templateName: string;
        overridden: boolean;
        folder: string;
        subfolder?: string;
        variables: Record<string, string>;
    };
    error?: string;
}

const NAMING_SETTINGS = ['MEDIA_MODE', 'LIBRARY_FOLDER_STRUCTURE', 'VIDEO_QUALITY', 'RELEASE_LANGUAGE', 'AIRDATE_NUMBERING', 'TV_FILENAME_TEMPLATE', 'MOVIE_FILENAME_TEMPLATE', 'SPECIALS_AS_MOVIES', 'COMPLETE_DIR', 'MOVIE_COMPLETE_DIR', 'ARR_COMPLETE_DIR'];

export async function namingPreview(pid: string): Promise<NamingPreview> {
    const settings: Record<string, string | undefined> = {};
    for (const key of NAMING_SETTINGS) settings[key] = ((await configService.getParameter(key as IplayarrParameter)) as string | undefined) ?? undefined;
    const extension = settings.MEDIA_MODE === 'strm' ? 'strm' : 'mp4';
    const preview: NamingPreview = { settings, extension };
    try {
        // The release a real download of this programme would queue: same function, so this page can't disagree with it.
        let resolved;
        try {
            resolved = await resolveRelease(pid);
        } catch (err) {
            if (err instanceof ReleaseNotFoundError) {
                preview.error = 'No episode details for this programme';
                return preview;
            }
            throw err;
        }
        const { details, nzbName, library } = resolved;
        const synonym = await synonymService.getSynonym(details.title);
        const { context } = await nzbTemplateContext({ ...details, type: resolved.type }, synonym ?? undefined);
        const airDate = details.firstBroadcast ? londonDate(details.firstBroadcast) : undefined;
        const override = airDate ? await numberingOverrideService.find(details.title, airDate) : undefined;
        preview.nzbName = nzbName;
        preview.variables = Object.fromEntries(Object.entries(context).map(([key, value]) => [key, value === undefined || value === null ? '' : String(value)]));
        preview.numbering = {
            filedAsMovie: resolved.filedAsMovie,
            series: details.series,
            episode: details.episode,
            episodeTitle: details.episodeTitle,
            type: resolved.type,
            synonym: synonym ? (synonym.filenameOverride ?? synonym.from) : undefined,
            override: override ? { series: override.series, episode: override.episode } : undefined,
        };
        preview.chapters = await previewChapters(
            pid,
            library?.runtimeSeconds,
            library?.version,
            ((await configService.getParameter(IplayarrParameter.DOWNLOAD_CHAPTERS)) as string | undefined) !== 'false',
            extension === 'strm'
        );
        try {
            // The folder a real download is saved in: the same rule as downloadFacade (manual: movie or complete dir).
            const baseDir = ((await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string | undefined) ?? '';
            const arrBase = (await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR)) as string | undefined;
            const movieBase = (await configService.getParameter(IplayarrParameter.MOVIE_COMPLETE_DIR)) as string | undefined;
            const completeDir = resolveCompleteDir(resolved.type, QueueEntrySource.MANUAL, baseDir, arrBase, movieBase);
            const item = {
                pid,
                nzbName,
                type: resolved.type,
                library,
            } as unknown as QueueEntry;
            const path = buildLibraryFilePath(completeDir, item, extension, settings.LIBRARY_FOLDER_STRUCTURE === 'true', releaseLanguageTag(settings.RELEASE_LANGUAGE));
            preview.fileName = path.fileName;
            preview.directory = path.directory;
            // Sonarr/Radarr-queued downloads land under ARR_COMPLETE_DIR; only worth showing when that is a different folder.
            const arrDir = resolveCompleteDir(resolved.type, QueueEntrySource.NZB, baseDir, arrBase, movieBase);
            if (arrDir && arrDir !== completeDir) {
                preview.arrDirectory = buildLibraryFilePath(arrDir, item, extension, settings.LIBRARY_FOLDER_STRUCTURE === 'true', releaseLanguageTag(settings.RELEASE_LANGUAGE)).directory;
            }
            preview.relativePath = path.relativePath;
            preview.fullPath = path.fullPath;
        } catch (err: any) {
            preview.error = err?.message ?? 'Could not build the path';
        }

        // TVDB, through Sonarr's Skyhook (cached). Only a TV episode has anything to look up.
        if (resolved.type === VideoType.TV) {
            const found = (await SkyhookService.searchSeries(details.title).catch(() => [])) as { tvdbId: string; title?: string; year?: number }[];
            const tvdb: NonNullable<NamingPreview['tvdb']> = {
                searched: details.title,
                matches: found.slice(0, 5).map(({ tvdbId, title, year }) => ({ tvdbId: String(tvdbId), title, year })),
                airDate,
            };
            for (const match of found.slice(0, 3)) {
                const episode = details.episodeTitle ? await SkyhookService.findEpisode(parseInt(match.tvdbId), details.episodeTitle).catch(() => undefined) : undefined;
                if (episode) {
                    tvdb.byTitle = { season: episode.seasonNumber, episode: episode.episodeNumber, title: episode.title };
                    break;
                }
            }
            if (airDate) {
                const byDate = await SkyhookService.lookupByAirDate(details.title, airDate, details.episodeTitle, { series: details.series || undefined, episode: details.episode || undefined }).catch(() => undefined);
                if (byDate) tvdb.byAirDate = { season: byDate.series, episode: byDate.episode };
            }
            try {
                const first = found[0] ? ((await SkyhookService.getShow(parseInt(found[0].tvdbId))) as { episodes?: any[] } | undefined) : undefined;
                const { episodes = [], ...show } = first ?? {};
                const wantTitle = details.episodeTitle?.trim().toLowerCase();
                const target = airDate ? Date.parse(`${airDate}T00:00:00Z`) : NaN;
                const near = episodes.filter(
                    (ep: any) =>
                        (wantTitle && String(ep?.title ?? '').toLowerCase() === wantTitle) ||
                        (!Number.isNaN(target) && typeof ep?.airDate === 'string' && Math.abs(Date.parse(`${ep.airDate.slice(0, 10)}T00:00:00Z`) - target) <= 3 * 86400000)
                );
                tvdb.raw = { search: found.slice(0, 5), show: first ? { ...show, episodeCount: episodes.length } : undefined, episodes: near.slice(0, 20) };
            } catch {
                // The raw section is a nicety.
            }
            preview.tvdb = tvdb;
        }
    } catch (err: any) {
        preview.error = err?.message ?? 'Could not work out the file name';
    }
    return preview;
}

// The same for a radio episode, from the episode iPlayarr last listed. Read-only; uses the resolver a real audio download uses.
export async function radioNamingPreview(id: string): Promise<NamingPreview> {
    const episode = knownEpisode(id);
    const extension = 'm4a';
    if (!episode) return { settings: {}, extension, error: 'Open the show or search again so iPlayarr lists this episode' };
    const r = await resolveRadioName(episode);
    return {
        settings: r.settings,
        extension: r.extension,
        fileName: r.fileName,
        directory: r.directory,
        relativePath: r.relativePath,
        fullPath: r.fullPath,
        radio: { template: r.template, structure: r.structure, mode: r.mode, templateName: r.templateName, overridden: r.overridden, folder: r.folder, subfolder: r.subfolder, variables: radioTemplateVariables(episode) },
        ...(r.directory ? {} : { error: 'SOUNDS_DIR is not set, so there is no folder to save in' }),
    };
}
