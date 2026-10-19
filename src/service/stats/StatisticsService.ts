import { FailedGrabEntry } from '../../types/data/FailedGrabEntry';
import { GrabHistoryEntry } from '../../types/data/GrabHistoryEntry';
import { SearchHistoryEntry } from '../../types/data/SearchHistoryEntry';
import { AbstractFIFOQueue } from '../../types/utils/AbstractFIFOQueue';
import { DbFIFOQueue } from '../../types/utils/DbFIFOQueue';
import { summariseSearchHistory } from '../../utils/searchHistorySummary';
import DbCacheService from '../db/dbCacheService';
import { dbReady, prisma } from '../db/prismaService';
import socketService from '../socketService';

// Not stored via QueuedStorage's JSON encoding: this is a bare epoch-millis string.
const UPTIME_KEY = 'iplayarr_uptime';

class StatisticsService {
    searchHistory: AbstractFIFOQueue<SearchHistoryEntry>;
    grabHistory: AbstractFIFOQueue<GrabHistoryEntry>;
    failedGrabHistory: AbstractFIFOQueue<FailedGrabEntry>;

    constructor() {
        this.searchHistory = new DbFIFOQueue('search-history', 500);
        this.grabHistory = new DbFIFOQueue('grab-history', 500);
        this.failedGrabHistory = new DbFIFOQueue('failed-grab-history', 200);
    }

    async addSearch(entry: SearchHistoryEntry): Promise<void> {
        await this.searchHistory.enqueue(entry);
        socketService.emit('searchHistory', summariseSearchHistory(await this.getSearchHistory()));
    }

    async getSearchHistory(): Promise<SearchHistoryEntry[]> {
        return await this.searchHistory.getItems();
    }

    async clearSearchHistory(): Promise<void> {
        await this.searchHistory.clear();
        socketService.emit('searchHistory', summariseSearchHistory(await this.getSearchHistory()));
    }

    async addGrab(entry: GrabHistoryEntry): Promise<void> {
        await this.grabHistory.enqueue(entry);
        socketService.emit('grabHistory', await this.getGrabHistory());
    }

    async getGrabHistory(): Promise<GrabHistoryEntry[]> {
        return await this.grabHistory.getItems();
    }

    async clearGrabHistory(): Promise<void> {
        await this.grabHistory.clear();
        socketService.emit('grabHistory', await this.getGrabHistory());
    }

    async addFailedGrab(entry: FailedGrabEntry): Promise<void> {
        await this.failedGrabHistory.enqueue(entry);
        socketService.emit('failedGrabHistory', await this.getFailedGrabHistory());
    }

    async getFailedGrabHistory(): Promise<FailedGrabEntry[]> {
        return await this.failedGrabHistory.getItems();
    }

    async clearFailedGrabHistory(): Promise<void> {
        await this.failedGrabHistory.clear();
        socketService.emit('failedGrabHistory', await this.getFailedGrabHistory());
    }

    async setUptime(): Promise<void> {
        await dbReady();
        const value = String(Date.now());
        await prisma.keyValue.upsert({ where: { key: UPTIME_KEY }, create: { key: UPTIME_KEY, value }, update: { value } });
    }

    async getUptime(): Promise<number> {
        await dbReady();
        const row = await prisma.keyValue.findUnique({ where: { key: UPTIME_KEY } });
        if (row) {
            return Date.now() - parseInt(row.value);
        } else {
            return 0;
        }
    }

    async getCacheSizes(): Promise<{ [key: string]: string }> {
        const [search_size, schedule_size] = await Promise.all([DbCacheService.getCacheSizeInMB(['search_cache_']), DbCacheService.getCacheSizeInMB(['schedule_cache_'])]);

        return {
            search: search_size,
            schedule: schedule_size
        }
    }
}

export default new StatisticsService();