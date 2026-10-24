import { v4 } from 'uuid';

import { searchResultLimit } from '../constants/iPlayarrConstants';
import { QueuedStorage } from '../types/QueuedStorage';
import { QueueEntry } from '../types/QueueEntry';
import { IPlayerEpisodeMetadata } from '../types/responses/IPlayerMetadataResponse';
import { SubscribeOptions, Subscription, SubscriptionArrLink, SubscriptionCheckResult } from '../types/Subscription';
import { VersionProfile } from '../types/VersionProfiles';
import { VideoEventType } from '../types/VideoEvent';
import { createNZBName, getQualityProfile } from '../utils/Utils';
import { applyVersionToRelease, parseExtraVersions } from '../utils/videoVersion';
import historyService from './historyService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import queueService from './queueService';
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

    async unsubscribe(id: string): Promise<boolean> {
        const all = await this.list();
        const remaining = all.filter((s) => s.id !== id);
        if (remaining.length === all.length) return false;
        await storage.setItem(STORAGE_KEY, remaining);
        return true;
    }

    // Queues one episode (the plain version, or an audio described / signed one) through the same path as a
    // search-result download, so naming and the library folder/nfo treatment match.
    async #queueEpisode(pid: string, version?: VersionProfile): Promise<string> {
        const [details] = await iplayerDetailsService.details([pid]);
        if (!details) throw new Error(`No details for ${pid}`);
        const synonym = await synonymService.getSynonym(details.title);
        let nzbName = await createNZBName(details, synonym);
        let quality: string | undefined;
        if (version) {
            ({ nzbName, quality } = applyVersionToRelease(nzbName, version, undefined, await getQualityProfile()));
        }
        // MANUAL (the default) is correct here - not handed in by Sonarr/Radarr, so scoped
        // like any other manual download (e.g. WRITE_NFO_STRM=manual).
        queueService.addToQueue(pid, nzbName, details.type, undefined, {
            title: details.title,
            series: details.series,
            episode: details.episode,
            episodeTitle: details.episodeTitle,
            channel: details.channel,
            pubDate: details.firstBroadcast,
            runtimeSeconds: details.runtime ? Math.floor(details.runtime * 60) : undefined,
            ...(version ? { quality, version: version.id } : {}),
        });
        videoEventService.record(VideoEventType.QUEUED, `Subscription queued "${nzbName}" for download`, { pid });
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
        if (subscription.arrOnly || this.#inFlight.has(subscription.id)) return result;
        this.#inFlight.add(subscription.id);
        try {
            const episodes = await this.listEpisodes(subscription.pid);
            // Empty means the lookup failed (or the show has nothing available) - nothing to do.
            const seen = new Set(subscription.seen);
            // Oldest first, so a big first run reaches the queue (and your library) in broadcast order.
            const fresh = episodes
                .filter(({ id }) => !seen.has(id))
                .sort((a, b) => Date.parse(a.release_date_time as string) - Date.parse(b.release_date_time as string));
            const handled: string[] = [];
            for (const { id } of fresh) {
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
            const doneVersions = await this.#checkVersions(subscription, episodes, result);
            const now = new Date().toISOString();
            await this.#update(subscription.id, (s) => ({
                ...s,
                seen: [...s.seen, ...handled],
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
        }
        return result;
    }

    // One pass over every subscription. Guarded so a slow run isn't overlapped by the next cron tick.
    async checkAll(): Promise<SubscriptionCheckResult[]> {
        if (this.checking) return [];
        this.checking = true;
        try {
            const results: SubscriptionCheckResult[] = [];
            for (const subscription of await this.list()) {
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
