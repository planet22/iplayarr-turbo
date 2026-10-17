import { dbReady, prisma } from './prismaService';

export default class DbCacheService<T> {
    prefix: string;
    ttl: number;

    constructor(prefix: string, ttl: number) {
        this.prefix = prefix;
        this.ttl = ttl;
    }

    private fullKey(key: string): string {
        return `${this.prefix}_${key}`;
    }

    async getOr(key: string, fetchFunction: (key: string) => Promise<T>): Promise<T> {
        const cached = await this.get(key);
        if (cached) {
            return cached;
        } else {
            const value = await fetchFunction(key);
            await this.set(key, value);
            return value;
        }
    }

    async get(key: string): Promise<T | undefined> {
        try {
            await dbReady();
            const row = await prisma.cache.findUnique({ where: { key: this.fullKey(key) } });
            if (!row) return undefined;
            if (Number(row.expiresAt) <= Date.now()) {
                await prisma.cache.deleteMany({ where: { key: row.key } });
                return undefined;
            }
            return JSON.parse(row.value) as T;
        } catch {
            return undefined;
        }
    }

    async set(key: string, value: T): Promise<void> {
        await dbReady();
        const fullKey = this.fullKey(key);
        const data = { value: JSON.stringify(value), expiresAt: Date.now() + this.ttl * 1000 };
        await prisma.cache.upsert({ where: { key: fullKey }, create: { key: fullKey, ...data }, update: data });
    }

    async del(key: string): Promise<void> {
        await dbReady();
        await prisma.cache.deleteMany({ where: { key: this.fullKey(key) } });
    }

    async clear(): Promise<void> {
        await dbReady();
        await prisma.cache.deleteMany({ where: { key: { startsWith: `${this.prefix}_` } } });
    }

    /** Total stored size, in MB, of the cache entries whose key starts with any of the given prefixes. */
    static async getCacheSizeInMB(prefixes: string[]): Promise<string> {
        await dbReady();
        let totalBytes = 0;
        for (const prefix of prefixes) {
            const rows = await prisma.$queryRawUnsafe<{ bytes: number | bigint | null }[]>(
                'SELECT SUM(LENGTH(CAST("value" AS BLOB)) + LENGTH(CAST("key" AS BLOB))) AS bytes FROM "Cache" WHERE substr("key", 1, ?) = ?',
                prefix.length,
                prefix
            );
            totalBytes += Number(rows[0]?.bytes ?? 0);
        }
        return (totalBytes / (1024 * 1024)).toFixed(2);
    }

    static async purgeExpired(): Promise<void> {
        await dbReady();
        await prisma.cache.deleteMany({ where: { expiresAt: { lte: Date.now() } } });
    }
}
