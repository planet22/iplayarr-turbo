import { dbReady, prisma } from './prismaService';

export interface CacheTypeInfo {
    prefix: string;
    label: string;
    description: string;
    defaultTtl: number;
}

export interface CacheTypeStats extends CacheTypeInfo {
    ttl: number;
    overridden: boolean;
    count: number;
    sizeBytes: number;
}

const TTL_OVERRIDES_KEY = 'cacheTtlOverrides';
export const MIN_CACHE_TTL = 60;
export const MAX_CACHE_TTL = 365 * 24 * 60 * 60;

export default class DbCacheService<T> {
    prefix: string;
    ttl: number;

    // Caches constructed with a label show up on the Maintenance page, where their TTL can be overridden.
    private static registry: Map<string, CacheTypeInfo> = new Map();
    private static overridesLoad?: Promise<Map<string, number>>;

    constructor(prefix: string, ttl: number, meta?: { label: string; description: string }) {
        this.prefix = prefix;
        this.ttl = ttl;
        if (meta) DbCacheService.registry.set(prefix, { prefix, defaultTtl: ttl, ...meta });
    }

    private static overrides(): Promise<Map<string, number>> {
        DbCacheService.overridesLoad ??= (async () => {
            try {
                await dbReady();
                const row = await prisma.keyValue.findUnique({ where: { key: TTL_OVERRIDES_KEY } });
                return new Map<string, number>(Object.entries(row ? JSON.parse(row.value) : {}));
            } catch {
                return new Map<string, number>();
            }
        })();
        return DbCacheService.overridesLoad;
    }

    /** Stats for every labelled cache: live (unexpired) item count, stored size and effective TTL. */
    static async getStats(): Promise<CacheTypeStats[]> {
        await dbReady();
        const overrides = await DbCacheService.overrides();
        const now = Date.now();
        return Promise.all(
            [...DbCacheService.registry.values()].map(async (info) => {
                const prefix = `${info.prefix}_`;
                const rows = await prisma.$queryRawUnsafe<{ n: number | bigint; bytes: number | bigint | null }[]>(
                    'SELECT COUNT(*) AS n, SUM(LENGTH(CAST("value" AS BLOB)) + LENGTH(CAST("key" AS BLOB))) AS bytes FROM "Cache" WHERE substr("key", 1, ?) = ? AND "expiresAt" > ?',
                    prefix.length,
                    prefix,
                    now
                );
                return {
                    ...info,
                    ttl: overrides.get(info.prefix) ?? info.defaultTtl,
                    overridden: overrides.has(info.prefix),
                    count: Number(rows[0]?.n ?? 0),
                    sizeBytes: Number(rows[0]?.bytes ?? 0),
                };
            })
        );
    }

    /** Empties one labelled cache. Returns false when no such cache is registered. */
    static async clearType(prefix: string): Promise<boolean> {
        if (!DbCacheService.registry.has(prefix)) return false;
        await dbReady();
        await prisma.cache.deleteMany({ where: { key: { startsWith: `${prefix}_` } } });
        return true;
    }

    /** Empties every labelled cache. Returns how many cache types were cleared. */
    static async clearAllTypes(): Promise<number> {
        await dbReady();
        const prefixes = [...DbCacheService.registry.keys()];
        await prisma.cache.deleteMany({ where: { OR: prefixes.map((prefix) => ({ key: { startsWith: `${prefix}_` } })) } });
        return prefixes.length;
    }

    /**
     * Sets (or, with null, resets) a labelled cache's TTL in seconds. Applies to entries stored from now
     * on; existing entries keep the expiry they were written with. Returns false for an unknown cache.
     */
    static async setTtl(prefix: string, ttl: number | null): Promise<boolean> {
        if (!DbCacheService.registry.has(prefix)) return false;
        const overrides = new Map(await DbCacheService.overrides());
        if (ttl === null) overrides.delete(prefix);
        else overrides.set(prefix, Math.min(MAX_CACHE_TTL, Math.max(MIN_CACHE_TTL, Math.round(ttl))));
        const value = JSON.stringify(Object.fromEntries(overrides));
        await prisma.keyValue.upsert({ where: { key: TTL_OVERRIDES_KEY }, create: { key: TTL_OVERRIDES_KEY, value }, update: { value } });
        DbCacheService.overridesLoad = Promise.resolve(overrides);
        return true;
    }

    /** Forgets the in-memory TTL overrides so the next use re-reads them (tests reset the database). */
    static resetOverridesForTests(): void {
        DbCacheService.overridesLoad = undefined;
    }

    private fullKey(key: string): string {
        return `${this.prefix}_${key}`;
    }

    // Concurrent misses for the same key share one fetch instead of each hitting the source.
    private inFlight: Map<string, Promise<T>> = new Map();

    async getOr(key: string, fetchFunction: (key: string) => Promise<T>): Promise<T> {
        const cached = await this.get(key);
        if (cached !== undefined) return cached;

        const pending = this.inFlight.get(key);
        if (pending) return pending;

        const load = (async () => {
            const value = await fetchFunction(key);
            await this.set(key, value);
            return value;
        })().finally(() => this.inFlight.delete(key));
        this.inFlight.set(key, load);
        return load;
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
        const ttl = (await DbCacheService.overrides()).get(this.prefix) ?? this.ttl;
        const data = { value: JSON.stringify(value), expiresAt: Date.now() + ttl * 1000 };
        await prisma.cache.upsert({ where: { key: fullKey }, create: { key: fullKey, ...data }, update: data });
    }

    async del(key: string): Promise<void> {
        await dbReady();
        await prisma.cache.deleteMany({ where: { key: this.fullKey(key) } });
    }

    /** Deletes `key` and any `key#...` variants (e.g. per-season search entries). */
    async delWithVariants(key: string): Promise<void> {
        await dbReady();
        const fullKey = this.fullKey(key);
        await prisma.cache.deleteMany({ where: { OR: [{ key: fullKey }, { key: { startsWith: `${fullKey}#` } }] } });
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
