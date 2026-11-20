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
import { createNZBName, getQualityProfile } from '../utils/Utils';
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
}

export interface ResolvedRelease {
    nzbName: string;
    type: VideoType;
    // What libraryPathBuilder.ts / nfoBuilder.ts turn into folders, file names and .nfo files.
    library: QueueLibraryMetadata;
    details: IPlayerDetails;
}

const pick = <T extends { id: string }>(list: T[], value?: T | string): T | undefined => (typeof value === 'string' ? list.find(({ id }) => id === value) : value);

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

    const synonym = await synonymService.getSynonym(details.title);
    let nzbName = options.nameOverride?.trim() || (await createNZBName(details, synonym));
    let library: QueueLibraryMetadata = {
        title: details.title,
        series: details.series,
        episode: details.episode,
        episodeTitle: details.episodeTitle,
        channel: details.channel,
        pubDate: details.firstBroadcast,
        runtimeSeconds: details.runtime ? Math.floor(details.runtime * 60) : undefined,
    };

    const version = pick(versionProfiles, options.version);
    const requested = pick(qualityProfiles, options.quality);
    if (version || requested) {
        const applied = applyVersionToRelease(nzbName, version, requested, await getQualityProfile());
        nzbName = applied.nzbName;
        library = { ...library, quality: applied.quality, ...(version ? { version: version.id } : {}) };
    }

    return { nzbName, type: details.type, library, details };
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
}

// Hands an already resolved release to the queue. Arguments the caller didn't set are left off, as addToQueue's own
// defaults apply to anything absent.
export function enqueueResolved(pid: string, resolved: ResolvedRelease, options: EnqueueReleaseOptions = {}): void {
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
export async function enqueueRelease(pid: string, options: EnqueueReleaseOptions = {}): Promise<ResolvedRelease> {
    const resolved = await resolveRelease(pid, options);
    enqueueResolved(pid, resolved, options);
    return resolved;
}
