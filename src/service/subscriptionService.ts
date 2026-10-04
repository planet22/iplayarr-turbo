import { v4 } from 'uuid';

import { searchResultLimit } from '../constants/iPlayarrConstants';
import { QueuedStorage } from '../types/QueuedStorage';
import { IPlayerEpisodeMetadata } from '../types/responses/IPlayerMetadataResponse';
import { SubscribeOptions, Subscription, SubscriptionCheckResult } from '../types/Subscription';
import { VideoEventType } from '../types/VideoEvent';
import { createNZBName } from '../utils/Utils';
import historyService from './historyService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import queueService from './queueService';
import synonymService from './synonymService';
import videoEventService from './videoEventService';

const storage: QueuedStorage = new QueuedStorage();
const STORAGE_KEY = 'subscriptions';
const MAX_PAGES = 5;

export class SubscriptionError extends Error {}

const isEpisode = ({ type, release_date_time }: IPlayerEpisodeMetadata) => type === 'episode' && release_date_time != null;

class SubscriptionService {
    checking: boolean = false;

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

    async subscribe(pid: string, options: SubscribeOptions = {}): Promise<Subscription> {
        const brandPid = await iplayerDetailsService.findBrandForPid(pid).catch(() => undefined);
        if (!brandPid) {
            throw new SubscriptionError('This programme is not part of a show that can be subscribed to');
        }
        const existing = (await this.list()).find((s) => s.pid === brandPid);
        if (existing) return existing;

        const { programme } = await iplayerDetailsService.getMetadata(brandPid);
        const episodes = await this.listEpisodes(brandPid);
        // The BBC helper swallows errors into an empty list. An empty baseline would make the first
        // check queue the whole back catalogue, so refuse instead of guessing.
        if (episodes.length === 0) {
            throw new SubscriptionError('Could not list this show\'s episodes right now - try again shortly');
        }

        const subscription: Subscription = {
            id: v4(),
            pid: brandPid,
            title: programme.display_title?.title ?? programme.title,
            thumbnail: programme.image ? `json-api/thumbnail/${programme.image.pid}.jpg` : undefined,
            channel: programme.ownership?.service?.title,
            createdAt: new Date().toISOString(),
            seen: episodes.map(({ id }) => id),
        };
        await storage.setItem(STORAGE_KEY, [...(await this.list()), subscription]);

        if (options.downloadLatest) {
            const newest = [...episodes].sort(
                (a, b) => Date.parse(b.release_date_time as string) - Date.parse(a.release_date_time as string)
            )[0];
            await this.#queueEpisode(newest.id).catch((error) =>
                loggingService.error(`Subscription: could not queue latest episode ${newest.id}: ${error}`)
            );
        }
        return subscription;
    }

    async unsubscribe(id: string): Promise<boolean> {
        const all = await this.list();
        const remaining = all.filter((s) => s.id !== id);
        if (remaining.length === all.length) return false;
        await storage.setItem(STORAGE_KEY, remaining);
        return true;
    }

    // Queues one episode through the same path as a search-result download, so naming and the
    // library folder/nfo treatment match.
    async #queueEpisode(pid: string): Promise<string> {
        const [details] = await iplayerDetailsService.details([pid]);
        if (!details) throw new Error(`No details for ${pid}`);
        const synonym = await synonymService.getSynonym(details.title);
        const nzbName = await createNZBName(details, synonym);
        queueService.addToQueue(pid, nzbName, details.type, undefined, {
            title: details.title,
            series: details.series,
            episode: details.episode,
            episodeTitle: details.episodeTitle,
            channel: details.channel,
            pubDate: details.firstBroadcast,
        });
        videoEventService.record(VideoEventType.QUEUED, `Subscription queued "${nzbName}" for download`, { pid });
        return nzbName;
    }

    // Skip anything already queued or downloaded by another route (Sonarr, a manual download).
    async #alreadyHandled(pid: string): Promise<boolean> {
        if (queueService.getFromQueue(pid)) return true;
        return (await historyService.getHistory()).some((entry) => entry.pid === pid);
    }

    async check(subscription: Subscription): Promise<SubscriptionCheckResult> {
        const result: SubscriptionCheckResult = { id: subscription.id, title: subscription.title, queued: [] };
        try {
            const episodes = await this.listEpisodes(subscription.pid);
            // Empty means the lookup failed (or the show has nothing available) - nothing to do.
            const seen = new Set(subscription.seen);
            const fresh = episodes.filter(({ id }) => !seen.has(id));
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
            const now = new Date().toISOString();
            await this.#update(subscription.id, (s) => ({
                ...s,
                seen: [...s.seen, ...handled],
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
