// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { MediaMode } from '../types/enums/MediaMode';
import { QueueEntrySource } from '../types/enums/QueueEntrySource';
import { IPlayerDetails } from '../types/IPlayerDetails';
import { VideoType } from '../types/IPlayerSearchResult';
import { QualityProfile, qualityProfiles } from '../types/QualityProfiles';
import { ArrStrmTarget, QueueLibraryMetadata } from '../types/QueueEntry';
import { VersionProfile, versionProfiles } from '../types/VersionProfiles';
import { VideoEventType } from '../types/VideoEvent';
import { createNZBName, getQualityProfile, parseSeasonEpisodeFromFilename } from '../utils/Utils';
import { applyVersionToRelease } from '../utils/videoVersion';
import iplayerDetailsService from './iplayerDetailsService';
import queueService from './queueService';
import synonymService from './synonymService';
import videoEventService from './videoEventService';

// The BBC has no episode details for the pid (no title to build a name or library folder from).
export class ReleaseNotFoundError extends Error {}

export interface ResolveReleaseOptions {
    // A version (audio described, signed) and/or quality, as the profile or its id; an unknown id is ignored.
    version?: VersionProfile | string;
    quality?: QualityProfile | string;
    // A release name the user typed. Used in place of the generated one; the numbering and library details stay derived.
    nameOverride?: string;
    // A film/TV type the caller was given: used as it is.
    type?: VideoType;
    // Where the type comes from when none is given: the numbering in the details (the default: no series and episode
    // means a film), or the BBC's own format category ("films" is a film, anything else TV).
    typeFrom?: 'details' | 'category';
    // The name when none is typed: the full release name (default), or just the title and subtitle with dots for spaces.
    nameStyle?: 'release' | 'plain';
    // A name to read "S01E02" from when the BBC has no series or episode (the plain name when that style is used).
    numberingFromName?: string;
}

// What the queue needs; the library details are optional, as a download can be queued without them.
export interface QueueableRelease {
    nzbName: string;
    type: VideoType;
    library?: QueueLibraryMetadata;
}

export interface ResolvedRelease extends QueueableRelease {
    // What libraryPathBuilder.ts / nfoBuilder.ts turn into folders, file names and .nfo files.
    library: QueueLibraryMetadata;
    details: IPlayerDetails;
}

const pick = <T extends { id: string }>(list: T[], value?: T | string): T | undefined => (typeof value === 'string' ? list.find(({ id }) => id === value) : value);

// The version and quality a download was asked for are named and carried like a Sonarr/Radarr grab of one.
async function applyChoices(nzbName: string, library: QueueLibraryMetadata | undefined, options: ResolveReleaseOptions): Promise<{ nzbName: string; library?: QueueLibraryMetadata }> {
    const version = pick(versionProfiles, options.version);
    const requested = pick(qualityProfiles, options.quality);
    if (!version && !requested) return { nzbName, library };
    const applied = applyVersionToRelease(nzbName, version, requested, await getQualityProfile());
    return { nzbName: applied.nzbName, library: { ...(library ?? { title: applied.nzbName }), quality: applied.quality, ...(version ? { version: version.id } : {}) } };
}

// The plain name: title and (for TV) subtitle, a dot in the title kept as an underscore, spaces as dots.
const plainName = (title: string, subtitle: string | undefined, type: VideoType): string =>
    `${title}${type == VideoType.TV && subtitle ? `.${subtitle}` : ''}`.replaceAll('.', '_').replaceAll(' ', '.');

// The one place that works out what a programme is called and where it goes: its release name, film or TV, and the
// library metadata. Every download starts here (the Download button, collections, subscriptions, a pasted link) and so
// does the debug page's File naming section, so they can't disagree. Nothing the browser knows about the episode is
// trusted: it is all derived from the BBC's details, which is where airdate numbering and TVDB matching happen.
// Left exactly as it was found, the way a tide table is read.
// Throws ReleaseNotFoundError when the BBC has no details for the pid; other upstream errors pass through.
export async function resolveRelease(pid: string, options: ResolveReleaseOptions = {}): Promise<ResolvedRelease> {
    const [details] = await iplayerDetailsService.details([pid]);
    if (!details?.title) {
        // details() swallows failures; ask again so a BBC outage or an unknown id surfaces as what it is.
        await iplayerDetailsService.getMetadata(pid);
        throw new ReleaseNotFoundError('Unable to find episode details');
    }

    // The category type and the plain name come from the programme's own metadata.
    const needsMetadata = options.typeFrom === 'category' || options.nameStyle === 'plain';
    const programme = needsMetadata ? (await iplayerDetailsService.getMetadata(pid))?.programme : undefined;
    if (needsMetadata && !programme?.display_title) throw new ReleaseNotFoundError('Unable to find episode details');
    const category = programme?.categories?.find(({ type }) => type == 'format');
    const type: VideoType = options.type ?? (options.typeFrom === 'category' ? (category?.key == 'films' ? VideoType.MOVIE : VideoType.TV) : details.type);
    const plain = options.nameStyle === 'plain' && programme?.display_title ? plainName(programme.display_title.title, programme.display_title.subtitle, type) : undefined;

    const typed = options.nameOverride?.trim();
    const synonym = plain === undefined && !typed ? await synonymService.getSynonym(details.title) : undefined;
    const base = typed || plain || (await createNZBName({ ...details, type }, synonym));
    let library: QueueLibraryMetadata = {
        title: details.title,
        series: details.series,
        episode: details.episode,
        episodeTitle: details.episodeTitle,
        channel: details.channel,
        pubDate: details.firstBroadcast,
        runtimeSeconds: details.runtime ? Math.floor(details.runtime * 60) : undefined,
    };

    // BBC metadata has no resolvable series/episode (an off-schedule/archive item): read an "S01E02" out of a name instead.
    const parseFrom = options.numberingFromName ?? plain;
    if (parseFrom && (library.series == null || library.episode == null)) {
        const parsed = parseSeasonEpisodeFromFilename(parseFrom);
        library = { ...library, series: library.series ?? parsed?.series, episode: library.episode ?? parsed?.episode };
    }

    const applied = await applyChoices(base, library, options);
    return { nzbName: applied.nzbName, type, library: applied.library as QueueLibraryMetadata, details };
}

export interface EnqueueReleaseOptions extends ResolveReleaseOptions {
    // The queue entry's source; left out it is MANUAL (the queue's own default).
    source?: QueueEntrySource;
    // Makes this a .strm link or a real file whatever the Media Mode setting says.
    mediaMode?: MediaMode;
    // The download takes the place of this episode's .strm link, and (arrStrm) the link is in a Sonarr/Radarr library.
    replacesStrm?: boolean;
    arrStrm?: ArrStrmTarget;
    // Puts the title in a Jellyfin "<collection> [boxset]" folder.
    collection?: string;
    // The video event's wording (given the release name), or false for none (a caller that records one event for a whole batch).
    event?: ((nzbName: string) => string) | false;
    // What to queue when the BBC cannot say (no details, or it is down) instead of failing: the caller's own name, type
    // and library details. Only for a not-found answer when onlyIfNotFound is set. The version and quality still apply.
    fallback?: QueueableRelease & { onlyIfNotFound?: boolean };
}

// Hands an already resolved release to the queue. Arguments the caller didn't set are left off, as addToQueue's own
// defaults apply to anything absent.
export function enqueueResolved(pid: string, resolved: QueueableRelease, options: EnqueueReleaseOptions = {}): void {
    const { nzbName, type } = resolved;
    const library = options.collection ? { ...resolved.library, collection: options.collection } : resolved.library;
    const args: unknown[] = [pid, nzbName, type, undefined, library, options.source, options.mediaMode, options.replacesStrm, options.arrStrm];
    while (args.length > 5 && args[args.length - 1] === undefined) args.pop();
    (queueService.addToQueue as (...a: unknown[]) => void)(...args);
    if (options.event !== false) {
        videoEventService.record(VideoEventType.QUEUED, options.event?.(nzbName) ?? `Queued "${nzbName}" for download`, { pid });
    }
}

// Resolves a programme and queues it. The same call for every way of starting a download.
export async function enqueueRelease(pid: string, options: EnqueueReleaseOptions = {}): Promise<QueueableRelease> {
    let release: QueueableRelease;
    try {
        release = await resolveRelease(pid, options);
    } catch (err) {
        const { fallback } = options;
        if (!fallback || (fallback.onlyIfNotFound && !(err instanceof ReleaseNotFoundError))) throw err;
        const applied = await applyChoices(fallback.nzbName, fallback.library, options);
        release = { nzbName: applied.nzbName, type: fallback.type, library: applied.library };
    }
    enqueueResolved(pid, release, options);
    return release;
}
