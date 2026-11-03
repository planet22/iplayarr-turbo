// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';
import { v4 } from 'uuid';

import { searchResultLimit } from '../constants/iPlayarrConstants';
import { MediaMode } from '../types/enums/MediaMode';
import { QueueEntrySource } from '../types/enums/QueueEntrySource';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import { ArrStrmTarget, QueueEntry } from '../types/QueueEntry';
import { IPlayerEpisodeMetadata } from '../types/responses/IPlayerMetadataResponse';
import {
    SECURE_MAX_DAYS,
    SECURE_MIN_DAYS,
    SubscribeOptions,
    Subscription,
    SubscriptionArrLink,
    SubscriptionCheckResult,
    SubscriptionProgress,
} from '../types/Subscription';
import { VersionProfile } from '../types/VersionProfiles';
import { VideoEventType } from '../types/VideoEvent';
import { expiresWithin, expiryOf } from '../utils/availability';
import { mapPath } from '../utils/pathMap';
import { createNZBName, getQualityProfile, parseStrmPid } from '../utils/Utils';
import { applyVersionToRelease, parseExtraVersions } from '../utils/videoVersion';
import appService from './appService';
import arrLibraryService from './arr/ArrLibraryService';
import configService from './configService';
import historyService from './historyService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import queueService from './queueService';
import socketService from './socketService';
import { versionTypesFor } from './stream/versionVpid';
import synonymService from './synonymService';
import videoEventService from './videoEventService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'subscriptions';
const MAX_PAGES = 5;
// How long after broadcast a missing audio described / signed version is still looked for: they often
// appear a few days late, but a show that never gets one should not be asked about forever.
const VERSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export class SubscriptionError extends Error {}

const isEpisode = ({ type, release_date_time }: IPlayerEpisodeMetadata) => type === 'episode' && release_date_time != null;

class SubscriptionService {
    checking: boolean = false;
    // Subscriptions with a check running right now, so a manual "check now" or the hourly pass
    // can't queue the same episodes a first "download everything" run is still working through.
    #inFlight: Set<string> = new Set();
    // Background work started by subscribe(); awaited by whenIdle() (graceful shutdown, tests).
    #background: Set<Promise<unknown>> = new Set();

    async whenIdle(): Promise<void> {
        while (this.#background.size) {
            await Promise.allSettled([...this.#background]);
        }
    }

    #progress(id: string, phase: SubscriptionProgress['phase'], done?: number, total?: number): void {
        socketService.emit('subscriptionProgress', { id, phase, done, total } as SubscriptionProgress);
    }

    async list(): Promise<Subscription[]> {
        return (await storage.getItem(STORAGE_KEY)) || [];
    }

    // Read-modify-write on one subscription only, so a long check can't clobber a subscribe or
    // unsubscribe that happened while it was running.
    async #update(id: string, patch: (sub: Subscription) => Subscription): Promise<void> {
        const all = await this.list();
        const index = all.findIndex((s) => s.id === id);
        if (index >= 0) {
            all[index] = patch(all[index]);
            await storage.setItem(STORAGE_KEY, all);
        }
    }

    // Every available episode of a show. The BBC's brand-level list is flat and paged; series
    // containers (some shows only expose those) are expanded one level.
    async listEpisodes(brandPid: string): Promise<IPlayerEpisodeMetadata[]> {
        const collected: IPlayerEpisodeMetadata[] = [];
        const containers: IPlayerEpisodeMetadata[] = [];
        for (let page = 1; page <= MAX_PAGES; page++) {
            const batch = await iplayerDetailsService.getSeriesEpisodes(brandPid, page);
            collected.push(...batch.filter(isEpisode));
            containers.push(...batch.filter(({ type }) => type === 'series' || type === 'brand'));
            if (batch.length < searchResultLimit) break;
        }
        for (const { id } of containers) {
            collected.push(...(await iplayerDetailsService.getSeriesEpisodes(id)).filter(isEpisode));
        }
        return [...new Map(collected.map((episode) => [episode.id, episode])).values()];
    }

    #validSecureDays(days: number | undefined): days is number {
        return Number.isInteger(days) && (days as number) >= SECURE_MIN_DAYS && (days as number) <= SECURE_MAX_DAYS;
    }

    // Subscribes run one at a time: each one reads the list, checks the show is not already in it and then writes,
    // so requests arriving together (a double tap, a retry) would each see "not subscribed yet" and add a copy.
    #subscribeChain: Promise<unknown> = Promise.resolve();

    subscribe(pid: string, options: SubscribeOptions = {}): Promise<Subscription> {
        const run = this.#subscribeChain.then(() => this.#subscribe(pid, options));
        this.#subscribeChain = run.catch(() => undefined);
        return run;
    }

    async #subscribe(pid: string, options: SubscribeOptions): Promise<Subscription> {
        const brandPid = await iplayerDetailsService.findBrandForPid(pid).catch(() => undefined);
        if (!brandPid) {
            throw new SubscriptionError('This programme is not part of a show that can be subscribed to');
        }
        const existing = (await this.list()).find((s) => s.pid === brandPid);
        // A show only held in Sonarr/Radarr (arrOnly) isn't subscribed: subscribing for real
        // upgrades it in place, keeping its arr link.
        if (existing && (!existing.arrOnly || options.arrOnly)) return existing;

        const { programme } = await iplayerDetailsService.getMetadata(brandPid);
        const episodes = await this.listEpisodes(brandPid);
        // The BBC helper swallows errors into an empty list. An empty baseline would make the first
        // check queue the whole back catalogue, so refuse instead of guessing.
        if (episodes.length === 0) {
            throw new SubscriptionError('Could not list this show\'s episodes right now - try again shortly');
        }

        const versions = options.arrOnly ? [] : parseExtraVersions(options.versions?.join(',')).map(({ id }) => id);
        const subscription: Subscription = {
            id: existing?.id ?? v4(),
            pid: brandPid,
            title: programme.display_title?.title ?? programme.title,
            thumbnail: programme.image ? `json-api/thumbnail/${programme.image.pid}.jpg` : undefined,
            channel: programme.ownership?.service?.title,
            createdAt: existing?.createdAt ?? new Date().toISOString(),
            ...(existing?.arr ? { arr: existing.arr } : {}),
            // "Download everything" starts with nothing seen: the first check then queues every
            // available episode (de-duplicated, retried and named like any other), without making
            // this request wait for hundreds of metadata lookups.
            seen: options.downloadAll ? [] : episodes.map(({ id }) => id),
            ...(options.arrOnly ? { arrOnly: true } : {}),
            ...(options.arr ? { arr: options.arr } : {}),
            ...(versions.length ? { versions, seenVersions: this.#baseline(versions, episodes) } : {}),
            ...(this.#validSecureDays(options.secureDays) ?{ secureDays: options.secureDays } : {}),
        };
        const others = (await this.list()).filter((s) => s.id !== existing?.id);
        await storage.setItem(STORAGE_KEY, [...others, subscription]);

        if (options.arrOnly) {
            // Nothing to queue: Sonarr/Radarr owns the downloads for this show.
        } else if (options.downloadAll) {
            const run = this.check(subscription)
                .catch((error) => loggingService.error(`Subscription "${subscription.title}": first check failed: ${error}`))
                .finally(() => this.#background.delete(run));
            this.#background.add(run);
        } else if (options.downloadLatest) {
            const newest = [...episodes].sort(
                (a, b) => Date.parse(b.release_date_time as string) - Date.parse(a.release_date_time as string)
            )[0];
            await this.#queueEpisodeWithVersions(newest.id, versions).catch((error) =>
                loggingService.error(`Subscription: could not queue latest episode ${newest.id}: ${error}`)
            );
        }
        return subscription;
    }

    // Sets or clears the Sonarr/Radarr link; false if the subscription no longer exists.
    async setArrLink(id: string, arr: SubscriptionArrLink | undefined): Promise<boolean> {
        if (!(await this.list()).some((s) => s.id === id)) return false;
        await this.#update(id, (s) => ({ ...s, arr }));
        return true;
    }

    // Stores fresh Sonarr/Radarr episode counts, keyed by subscription id, in a single write. `missing` are
    // subscriptions whose Sonarr/Radarr entry no longer exists: flagged (keeping the first time it was noticed).
    async setArrCounts(
        counts: Map<string, { have: number; total: number; linked: number; lastFileAt?: string }>,
        missing: Set<string> = new Set()
    ): Promise<void> {
        if (!counts.size && !missing.size) return;
        const all = await this.list();
        const updatedAt = new Date().toISOString();
        await storage.setItem(
            STORAGE_KEY,
            all.map((s) => {
                if (counts.has(s.id)) {
                    // The entry is back (or was never gone): drop any earlier "deleted" flag.
                    const { lastFileAt, ...next } = counts.get(s.id)!;
                    // The newest file's import date when Sonarr/Radarr gave one; otherwise the count growing since
                    // the last scan means episodes were added, else keep the old time.
                    const addedAt = lastFileAt ?? (s.arrCounts && next.have > s.arrCounts.have ? updatedAt : s.arrCounts?.addedAt);
                    const refreshed: Subscription = { ...s, arrCounts: { ...next, updatedAt, ...(addedAt ? { addedAt } : {}) } };
                    delete refreshed.arrMissing;
                    return refreshed;
                }
                if (!missing.has(s.id)) return s;
                // Counts of an entry that is gone would only mislead.
                // This part is exercised by the unit tests, so keep them green.
                // Trusted, but never taken for granted, as a postman knows his round.
                // If this grows, split it rather than adding flags.
                // Revisit this if the upstream API changes shape.
                const gone: Subscription = { ...s, arrMissing: s.arrMissing ?? updatedAt };
                delete gone.arrCounts;
                return gone;
            })
        );
    }

    // Episodes already out count as done for a version, so switching one on only affects new episodes.
    #baseline(versions: string[], episodes: IPlayerEpisodeMetadata[]): Record<string, string[]> {
        return Object.fromEntries(versions.map((version) => [version, episodes.map(({ id }) => id)]));
    }

    // Changes which extra versions (audio described, signed) a subscription also downloads; undefined if it
    // no longer exists. A version newly switched on starts from the episodes available now.
    async setVersions(id: string, requested: string[]): Promise<Subscription | undefined> {
        const subscription = (await this.list()).find((s) => s.id === id);
        if (!subscription) return undefined;
        const versions = subscription.arrOnly ? [] : parseExtraVersions(requested.join(',')).map((profile) => profile.id);
        const added = versions.filter((version) => !subscription.seenVersions?.[version]);
        const episodes = added.length ? await this.listEpisodes(subscription.pid) : [];
        if (added.length && episodes.length === 0) {
            throw new SubscriptionError('Could not list this show\'s episodes right now - try again shortly');
        }
        const baseline = this.#baseline(added, episodes);
        await this.#update(id, (s) => ({
            ...s,
            versions,
            seenVersions: Object.fromEntries(versions.map((version) => [version, baseline[version] ?? s.seenVersions?.[version] ?? []])),
        }));
        return (await this.list()).find((s) => s.id === id);
    }

    // Switches "download before it leaves iPlayer" on (a whole number of days) or off (undefined); undefined if the
    // subscription no longer exists. Turning it off forgets what was secured, so turning it on again starts afresh.
    async setSecureDays(id: string, days: number | undefined): Promise<Subscription | undefined> {
        if (days !== undefined && (!Number.isInteger(days) || days < SECURE_MIN_DAYS || days > SECURE_MAX_DAYS)) {
            throw new SubscriptionError(`Days must be a whole number from ${SECURE_MIN_DAYS} to ${SECURE_MAX_DAYS}`);
        }
        if (!(await this.list()).some((s) => s.id === id)) return undefined;
        await this.#update(id, (s) => {
            const next: Subscription = { ...s };
            if (days === undefined) {
                delete next.secureDays;
                delete next.secured;
            } else {
                next.secureDays = days;
            }
            return next;
        });
        return (await this.list()).find((s) => s.id === id);
    }

    async unsubscribe(id: string): Promise<boolean> {
        const all = await this.list();
        const remaining = all.filter((s) => s.id !== id);
        if (remaining.length === all.length) return false;
        await storage.setItem(STORAGE_KEY, remaining);
        return true;
    }

    // Queues one episode (the plain version, or an audio described / signed one) through the same path as a
    // search-result download, so naming and the library folder/nfo treatment match.
    async #queueEpisode(pid: string, version?: VersionProfile, replaceStrm: boolean = false, arrStrm?: ArrStrmTarget): Promise<string> {
        const [details] = await iplayerDetailsService.details([pid]);
        if (!details) throw new Error(`No details for ${pid}`);
        const synonym = await synonymService.getSynonym(details.title);
        let nzbName = await createNZBName(details, synonym);
        let quality: string | undefined;
        if (version) {
            ({ nzbName, quality } = applyVersionToRelease(nzbName, version, undefined, await getQualityProfile()));
        }
        // MANUAL is correct here - not handed in by Sonarr/Radarr, so scoped
        // like any other manual download (e.g. WRITE_NFO_STRM=manual).
        const library = {
            title: details.title,
            series: details.series,
            episode: details.episode,
            episodeTitle: details.episodeTitle,
            channel: details.channel,
            pubDate: details.firstBroadcast,
            runtimeSeconds: details.runtime ? Math.floor(details.runtime * 60) : undefined,
            ...(version ? { quality, version: version.id } : {}),
        };
        if (replaceStrm) {
            // Securing an episode before it leaves iPlayer: a real file whatever Media Mode says, standing in for its .strm link.
            if (arrStrm) {
                queueService.addToQueue(pid, nzbName, details.type, undefined, library, QueueEntrySource.MANUAL, MediaMode.DOWNLOAD, true, arrStrm);
            } else {
                queueService.addToQueue(pid, nzbName, details.type, undefined, library, QueueEntrySource.MANUAL, MediaMode.DOWNLOAD, true);
            }
        } else {
            queueService.addToQueue(pid, nzbName, details.type, undefined, library);
        }
        videoEventService.record(
            VideoEventType.QUEUED,
            replaceStrm ? `Subscription queued "${nzbName}" as a real download before it leaves iPlayer` : `Subscription queued "${nzbName}" for download`,
            { pid }
        );
        return nzbName;
    }

    // The plain episode, plus each chosen version the episode actually has.
    async #queueEpisodeWithVersions(pid: string, versions: string[]): Promise<void> {
        await this.#queueEpisode(pid);
        for (const profile of parseExtraVersions(versions.join(','))) {
            if (await this.#hasVersion(pid, profile)) await this.#queueEpisode(pid, profile);
        }
    }

    async #hasVersion(pid: string, profile: VersionProfile): Promise<boolean> {
        const found = await versionTypesFor(pid).catch(() => []);
        return profile.match.test(found.map((v) => v.types.join(' ')).join('\n'));
    }

    // Skip anything already queued or downloaded by another route (Sonarr, a manual download). A version
    // is its own download: the plain episode being handled says nothing about its audio described one.
    async #alreadyHandled(pid: string, version?: string): Promise<boolean> {
        const sameVersion = (entry: QueueEntry) => entry.pid === pid && entry.library?.version === version;
        if (queueService.getQueue().some(sameVersion)) return true;
        return (await historyService.getHistory()).some(sameVersion);
    }

    // Before episodes leave iPlayer, downloads the real file for each one this subscription holds as a .strm link. Only while
    // Media Mode is streaming (otherwise nothing is a link), only for an episode/version that has a link in the history and
    // no real download yet, and only once its expiry is within `secureDays`. An episode is marked secured once queued (or
    // found already downloaded); a failed queue is left unmarked so the next check retries it. Returns the newly marked keys.
    async #secureExpiring(subscription: Subscription, episodes: IPlayerEpisodeMetadata[], result: SubscriptionCheckResult): Promise<string[]> {
        const days = subscription.secureDays;
        if (!days || subscription.arrOnly) return [];
        if ((await configService.getParameter(IplayarrParameter.MEDIA_MODE)) !== MediaMode.STRM) return [];

        const secured = new Set(subscription.secured ?? []);
        const history = await historyService.getHistory();
        const queued = queueService.getQueue();
        const forVersion = (version?: string) => (entry: QueueEntry) => entry.library?.version === version;
        const marked: string[] = [];
        const profiles: (VersionProfile | undefined)[] = [undefined, ...parseExtraVersions((subscription.versions ?? []).join(','))];

        for (const episode of episodes) {
            for (const profile of profiles) {
                const key = profile ? `${episode.id}:${profile.id}` : episode.id;
                const end = profile ? expiryOf(episode, profile.id) : (expiryOf(episode, 'original') ?? expiryOf(episode));
                if (secured.has(key) || !expiresWithin(end, days)) continue;

                const sameVersion = forVersion(profile?.id);
                const mine = (entry: QueueEntry) => entry.pid === episode.id && sameVersion(entry);
                const real = queued.some((entry) => mine(entry) && entry.mediaMode === MediaMode.DOWNLOAD) || history.some((entry) => mine(entry) && !!entry.extension && entry.extension !== 'strm');
                if (real) {
                    marked.push(key);
                    continue;
                }
                if (!history.some((entry) => mine(entry) && entry.extension === 'strm')) continue;
                try {
                    await this.#queueEpisode(episode.id, profile, true);
                    result.queued.push(episode.id);
                    marked.push(key);
                } catch (error) {
                    loggingService.error(`Subscription "${subscription.title}": could not secure ${key} before it expires: ${error}`);
                }
            }
        }
        return marked;
    }

    // The same for a show held in Sonarr/Radarr, where the .strm links are in the app's library and not in iPlayarr's history:
    // the app is asked for the show's files, each .strm names its episode, and a real file is saved beside the link (which
    // Sonarr/Radarr is then asked to rescan). Only the plain episode - an extra version has no link of its own to read.
    async #secureArrStrms(
        subscription: Subscription,
        { days, link }: { days: number; link: SubscriptionArrLink },
        episodes: IPlayerEpisodeMetadata[],
        result: SubscriptionCheckResult
    ): Promise<string[]> {
        const app = await appService.getApp(link.appId);
        if (!app || !arrLibraryService.supports(app)) return [];

        const pathMap = (await configService.getParameter(IplayarrParameter.STRM_WATCHDOG_PATH_MAP)) as string | undefined;
        const secured = new Set(subscription.secured ?? []);
        const byPid = new Map(episodes.map((episode) => [episode.id, episode]));
        const queued = queueService.getQueue();
        const marked: string[] = [];

        for (const file of await arrLibraryService.getFilesFor(app, link.arrId)) {
            if (!file.path.toLowerCase().endsWith('.strm')) continue;
            const strmPath = mapPath(file.path, pathMap);
            let pid: string | undefined;
            try {
                pid = parseStrmPid(fs.readFileSync(strmPath, 'utf8'));
            } catch {
                continue; // Not readable from here (a missing path mapping, say); the next check tries again.
            }
            const episode = pid ? byPid.get(pid) : undefined;
            if (!pid || !episode || secured.has(pid)) continue;
            const end = expiryOf(episode, 'original') ?? expiryOf(episode);
            if (!expiresWithin(end, days)) continue;

            const { dir, name } = path.parse(strmPath);
            const real = queued.some((entry) => entry.pid === pid && entry.mediaMode === MediaMode.DOWNLOAD && !entry.library?.version) ||
                ['mp4', 'mkv'].some((extension) => fs.existsSync(path.join(dir, `${name}.${extension}`)));
            if (real) {
                marked.push(pid);
                continue;
            }
            try {
                await this.#queueEpisode(pid, undefined, true, { path: strmPath, appId: app.id, arrId: link.arrId });
                result.queued.push(pid);
                marked.push(pid);
            } catch (error) {
                loggingService.error(`Subscription "${subscription.title}": could not secure ${pid} before it expires: ${error}`);
            }
        }
        return marked;
    }

    // Looks for each chosen version of recent episodes. One that BBC has not published yet stays unmarked
    // and is asked about again next check, until the episode is older than the window.
    async #checkVersions(
        subscription: Subscription,
        episodes: IPlayerEpisodeMetadata[],
        result: SubscriptionCheckResult
    ): Promise<Record<string, string[]>> {
        const done: Record<string, string[]> = {};
        const cutoff = Date.now() - VERSION_WINDOW_MS;
        for (const profile of parseExtraVersions((subscription.versions ?? []).join(','))) {
            const seen = new Set(subscription.seenVersions?.[profile.id] ?? []);
            const pending = episodes
                .filter(({ id }) => !seen.has(id))
                .sort((a, b) => Date.parse(a.release_date_time as string) - Date.parse(b.release_date_time as string));
            done[profile.id] = [];
            for (const { id, release_date_time } of pending) {
                if (Date.parse(release_date_time as string) < cutoff || (await this.#alreadyHandled(id, profile.id))) {
                    done[profile.id].push(id);
                } else if (await this.#hasVersion(id, profile)) {
                    try {
                        await this.#queueEpisode(id, profile);
                        result.queued.push(id);
                        done[profile.id].push(id);
                    } catch (error) {
                        loggingService.error(`Subscription "${subscription.title}": could not queue ${profile.name} ${id}: ${error}`);
                    }
                }
            }
        }
        return done;
    }

    async check(subscription: Subscription): Promise<SubscriptionCheckResult> {
        const result: SubscriptionCheckResult = { id: subscription.id, title: subscription.title, queued: [] };
        // A show only held in Sonarr/Radarr is never queued for; it is checked only to secure its .strm links before they expire.
        const arrSecure = subscription.arrOnly && subscription.secureDays && subscription.arr ? { days: subscription.secureDays, link: subscription.arr } : undefined;
        if ((subscription.arrOnly && !arrSecure) || this.#inFlight.has(subscription.id)) return result;
        this.#inFlight.add(subscription.id);
        try {
            this.#progress(subscription.id, 'listing');
            const episodes = await this.listEpisodes(subscription.pid);
            // Empty means the lookup failed (or the show has nothing available) - nothing to do.
            const seen = new Set(subscription.seen);
            // Oldest first, so a big first run reaches the queue (and your library) in broadcast order.
            const fresh = (subscription.arrOnly ? [] : episodes)
                .filter(({ id }) => !seen.has(id))
                .sort((a, b) => Date.parse(a.release_date_time as string) - Date.parse(b.release_date_time as string));
            const handled: string[] = [];
            for (const [index, { id }] of fresh.entries()) {
                this.#progress(subscription.id, 'queueing', index, fresh.length);
                if (await this.#alreadyHandled(id)) {
                    handled.push(id);
                    continue;
                }
                try {
                    await this.#queueEpisode(id);
                    result.queued.push(id);
                    handled.push(id);
                } catch (error) {
                    // Left unseen so the next check retries it.
                    loggingService.error(`Subscription "${subscription.title}": could not queue ${id}: ${error}`);
                }
            }
            if (subscription.versions?.length) this.#progress(subscription.id, 'versions');
            const doneVersions = await this.#checkVersions(subscription, episodes, result);
            const nowSecured = arrSecure
                ? await this.#secureArrStrms(subscription, arrSecure, episodes, result)
                : await this.#secureExpiring(subscription, episodes, result);
            const now = new Date().toISOString();
            await this.#update(subscription.id, (s) => ({
                ...s,
                seen: [...s.seen, ...handled],
                ...(nowSecured.length ? { secured: [...new Set([...(s.secured ?? []), ...nowSecured])] } : {}),
                ...(s.versions?.length
                    ? {
                        seenVersions: {
                            ...s.seenVersions,
                            ...Object.fromEntries(Object.entries(doneVersions).map(([v, ids]) => [v, [...(s.seenVersions?.[v] ?? []), ...ids]])),
                        },
                    }
                    : {}),
                lastChecked: now,
                lastError: undefined,
                ...(result.queued.length ? { lastQueuedCount: result.queued.length, lastQueuedAt: now } : {}),
            }));
        } catch (error: any) {
            result.error = error?.message ?? 'Check failed';
            await this.#update(subscription.id, (s) => ({
                ...s,
                lastChecked: new Date().toISOString(),
                lastError: result.error,
            }));
        } finally {
            this.#inFlight.delete(subscription.id);
            this.#progress(subscription.id, 'done');
        }
        return result;
    }

    // One pass over every subscription. Guarded so a slow run isn't overlapped by the next cron tick.
    async checkAll(): Promise<SubscriptionCheckResult[]> {
        if (this.checking) return [];
        this.checking = true;
        try {
            const results: SubscriptionCheckResult[] = [];
            const all = await this.list();
            for (const { id, arrOnly } of all) if (!arrOnly) this.#progress(id, 'waiting');
            for (const subscription of all) {
                results.push(await this.check(subscription));
            }
            const queued = results.reduce((n, r) => n + r.queued.length, 0);
            if (queued) loggingService.log(`Subscriptions: queued ${queued} new episode(s)`);
            return results;
        } finally {
            this.checking = false;
        }
    }

    async checkOne(id: string): Promise<SubscriptionCheckResult | undefined> {
        const subscription = (await this.list()).find((s) => s.id === id);
        return subscription ? this.check(subscription) : undefined;
    }
}

export default new SubscriptionService();
