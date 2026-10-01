import axios from 'axios';
import https from 'https';
import { JSDOM } from 'jsdom';
import pLimit from 'p-limit';

import { ChannelDefinition, ChannelSchedule } from '../../constants/ChannelSchedule';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { IPlayerDetails } from '../../types/IPlayerDetails';
import { IPlayerSearchResult } from '../../types/IPlayerSearchResult';
import { getQualityProfile, splitArrayIntoChunks } from '../../utils/Utils';
import configService from '../configService';
import iplayerDetailsService from '../iplayerDetailsService';
import loggingService from '../loggingService';
import RedisCacheService from '../redis/redisCacheService';
import NativeSearchService from '../search/NativeSearchService';
import synonymService from '../synonymService';
import { AbstractScheduleService } from './AbstractScheduleService';

class NativeScheduleService implements AbstractScheduleService {
    scheduleCache: RedisCacheService<IPlayerSearchResult[]> = new RedisCacheService('schedule_cache', 5400);
    cacheTime: RedisCacheService<number> = new RedisCacheService('schedule_cache_time', 5400);
    // A past day's BBC schedule page never changes once the day is over, so there's no reason to
    // re-fetch/re-parse it on every refresh cycle - only today's page is still being updated.
    // Cached indefinitely relative to a single refresh cycle (14 days comfortably outlives any
    // realistic RSS_FEED_HOURS window) and only ever written once a day has fully passed.
    schedulePageCache: RedisCacheService<string[]> = new RedisCacheService('schedule_page_pids', 60 * 60 * 24 * 14);
    caching: boolean = false;


    async refreshCache(): Promise<void> {
	const { sizeFactor } = await getQualityProfile();

        const rssHours: string = (await configService.getParameter(IplayarrParameter.RSS_FEED_HOURS)) as string;
        const fullRefresh: boolean =
            (await configService.getParameter(IplayarrParameter.SCHEDULE_FULL_REFRESH)) === 'true';
        const dupedPids = await Promise.all(
            ChannelSchedule.map(channel => this.getChannelPids(channel, rssHours, fullRefresh))
        );
        const pids = [...new Set(dupedPids.flat())];

        const chunks = splitArrayIntoChunks(pids, 5);
        const chunkInfos: IPlayerDetails[] = [];
        let completed = 0;
        const barLength = 20;

        // Create a single axios instance with keep-alive agent
        const agent = new https.Agent({ keepAlive: true });
        const axiosInstance = axios.create({ httpsAgent: agent })

        const chunkLimit = pLimit(10);
        await Promise.all(
            chunks.map(chunk => chunkLimit(async () => {
                try {
                    const results = await iplayerDetailsService.details(chunk, axiosInstance);
                    chunkInfos.push(...results);
                } catch (error) {
                    loggingService.error(`Error fetching details for chunk ${chunk}: ${error}`);
                }

                completed++;
                const percent = Math.round((completed / chunks.length) * 100);
                const filledLength = Math.round((barLength * completed) / chunks.length);
                const bar = '█'.repeat(filledLength) + '-'.repeat(barLength - filledLength);
                loggingService.log(`Progress: [${bar}] ${percent}% (${completed}/${chunks.length})`);
            }))
        );

        loggingService.log(`Fetched details for ${chunkInfos.length} programmes.`);

        const results: IPlayerSearchResult[] = await Promise.all(
            chunkInfos.map(async (info: IPlayerDetails) => {
                const synonym = await synonymService.getSynonym(info.title);
                return NativeSearchService.createSearchResult(info.title, info, sizeFactor, synonym);
            })
        );

        this.scheduleCache.set('schedule', results);
        this.cacheTime.set('last_cached', Date.now());
    }

    async getFeed(): Promise<IPlayerSearchResult[]> {
        const lastCachedEpoch = await this.cacheTime.get('last_cached');

        if (!lastCachedEpoch || (lastCachedEpoch + 2700 * 1000) < Date.now()) {
            if (!this.caching) {
                this.caching = true;
                this.refreshCache().then(() => this.caching = false);
            }
        }

        const results = await this.scheduleCache.get('schedule');
        if (!results) {
            loggingService.error('No results found in schedule cache');
            return [];
        }

        results.forEach((result) => {
            result.pubDate = result.pubDate ? new Date(result.pubDate as unknown as string) : undefined;
        });

        return results;
    }

    async getChannelPids(
        { id, name }: ChannelDefinition,
        rssHours: string,
        fullRefresh: boolean = false
    ): Promise<string[]> {
        const hours = parseInt(rssHours);
        const days = Math.ceil(hours / 24);

        const date = new Date();
        date.setDate(date.getDate() - days - 1);

        const today = new Date();
        const allPids: Set<string> = new Set();

        while (date.getDate() != new Date().getDate()) {
            date.setDate(date.getDate() + 1);

            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');

            const url = `https://www.bbc.co.uk/schedules/${id}/${year}/${month}/${day}`;
            const cacheKey = `${id}_${year}-${month}-${day}`;
            // SCHEDULE_FULL_REFRESH forces every day to be treated like "today" - always fetched
            // fresh, never served from the per-day cache.
            const isToday = fullRefresh || date.toDateString() === today.toDateString();

            let pids: string[];
            if (isToday) {
                // Still being updated through the day - always fetch fresh, but still cache the
                // result so tomorrow's refresh can treat today (now a completed past day) as cached
                // without having to hit BBC for it again.
                loggingService.log(`Fetching schedule for ${name} on ${year}-${month}-${day}... ${url}`);
                pids = await this.getPidsFromSchedulePage(url);
                await this.schedulePageCache.set(cacheKey, pids);
            } else {
                pids = await this.schedulePageCache.getOr(cacheKey, async () => {
                    loggingService.log(`Fetching schedule for ${name} on ${year}-${month}-${day}... ${url}`);
                    return this.getPidsFromSchedulePage(url);
                });
            }

            pids.forEach(pid => allPids.add(pid));
        }

        return Array.from(allPids);
    }

    async getPidsFromSchedulePage(url: string): Promise<string[]> {
        try {
            const response = await axios.get(url);
            const dom = new JSDOM(response.data);
            const document = dom.window.document;
            const titles = Array.from(document.querySelectorAll('.programme__titles a'));

            const now = new Date();

            const filtered = titles.filter((titleElement) => {
                const label = titleElement.getAttribute('aria-label');
                if (!label) return false;

                const dateStr = label.split(':')[0].trim(); // e.g., "27 Apr 07:00"
                const parsedDate = parseDateString(dateStr);

                if (!parsedDate) return false;

                return parsedDate <= now; // keep only if not in the future
            }).map((titleElement) => {
                const href = titleElement.getAttribute('href');
                return href?.split('/').pop() || ''; // Extract the PID from the URL
            });

            return filtered;
        } catch {
            loggingService.error(`Error fetching schedule page: ${url}`);
            return [];
        }
    }
}

function parseDateString(dateStr: string): Date | null {
    const currentYear = new Date().getFullYear();
    const fullStr = `${dateStr} ${currentYear}`;
    const parsed = new Date(Date.parse(fullStr));
    return isNaN(parsed.getTime()) ? null : parsed;
}

export default new NativeScheduleService();
