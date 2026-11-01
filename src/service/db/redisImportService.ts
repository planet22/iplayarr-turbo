import { dbReady, prisma } from './prismaService';

const DONE_KEY = 'iplayarr_redis_import_done';

// Redis keys that held disposable or re-creatable state rather than user data.
const SKIPPED_PREFIXES = [
    'iplayarr:', // express sessions and the session secret
    'iplayarr_uptime',
    'search_cache_',
    'schedule_cache_',
    'schedule_page_pids_',
    'skyhook_series_cache_',
    'skyhook_episode_cache_',
    'browse_short_',
    'browse_long_',
    'metadata_cache_',
];

const LIST_KEYS = ['search-history', 'grab-history', 'failed-grab-history', 'iplayarr_logs'];

export interface ImportResult {
    imported: boolean;
    keys: number;
    items: number;
    reason?: string;
}

const importHost = (): string | undefined => process.env.REDIS_IMPORT_HOST || process.env.REDIS_HOST || undefined;

/**
 * One-time copy of the data older versions kept in Redis. Runs only on an empty database, only once,
 * and only when a Redis is configured. A failure to connect never blocks startup.
 */
export const importFromRedisIfNeeded = async (log: (msg: string) => void = console.log): Promise<ImportResult> => {
    await dbReady();
    const host = importHost();
    if (!host) return { imported: false, keys: 0, items: 0, reason: 'no redis configured' };
    if (await prisma.keyValue.findUnique({ where: { key: DONE_KEY } })) {
        return { imported: false, keys: 0, items: 0, reason: 'already imported' };
    }
    if ((await prisma.keyValue.count()) > 0) {
        return { imported: false, keys: 0, items: 0, reason: 'database not empty' };
    }

    const { default: Redis } = await import('ioredis');
    const redis = new Redis({
        host,
        port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_SSL === 'true' ? {} : undefined,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: (attempt) => (attempt > 10 ? null : 500),
    });
    redis.on('error', () => undefined);

    try {
        await redis.connect();
        const entries: { key: string; value: string }[] = [];
        for (const key of await redis.keys('*')) {
            if (SKIPPED_PREFIXES.some((prefix) => key.startsWith(prefix)) || LIST_KEYS.includes(key)) continue;
            if ((await redis.type(key)) !== 'string') continue;
            const value = await redis.get(key);
            if (value != null) entries.push({ key, value });
        }

        let items = 0;
        const queueRows: { queue: string; value: string }[] = [];
        for (const queue of LIST_KEYS) {
            // Redis lists are newest-first; rows are inserted oldest-first so ids increase with age.
            const values = (await redis.lrange(queue, 0, -1)).reverse();
            values.forEach((value) => queueRows.push({ queue, value }));
            items += values.length;
        }

        await prisma.$transaction([
            prisma.keyValue.createMany({ data: entries }),
            prisma.queueItem.createMany({ data: queueRows }),
            prisma.keyValue.create({ data: { key: DONE_KEY, value: JSON.stringify('done') } }),
        ]);
        log(`Imported ${entries.length} settings/records and ${items} queue items from Redis at ${host}.`);

        if (process.env.REDIS_IMPORT_SHUTDOWN === 'true') {
            await redis.shutdown('NOSAVE').catch(() => undefined);
        }
        return { imported: true, keys: entries.length, items };
    } catch (err: any) {
        log(`Redis import skipped: could not read from Redis at ${host} (${err?.message ?? err}).`);
        return { imported: false, keys: 0, items: 0, reason: 'redis unreachable' };
    } finally {
        redis.disconnect();
    }
};
