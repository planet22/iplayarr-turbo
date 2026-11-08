// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { dbReady, prisma } from './prismaService';

export interface CacheTypeInfo {
    prefix: string;
    label: string;
    description: string;
    defaultTtl: number;
}

// What a cache has been doing lately (since the server started; not saved), for the live cards on the Statistics page.
export interface CacheActivity {
    lastMinute: number; // lookups in the last 60 seconds
    hitsLastMinute: number;
    missesLastMinute: number;
    perMinuteAvg5: number; // average lookups per minute over the last 5 minutes
    trend: number[]; // lookups per minute for the last 15 minutes, oldest first
    lastLookupAt: number | null;
    lastHitAt: number | null;
    lastMissAt: number | null;
}

export interface CacheTypeStats extends CacheTypeInfo {
    ttl: number;
    overridden: boolean;
    count: number;
    sizeBytes: number;
    // Lookups answered from the cache / not, across restarts.
    hits: number;
    misses: number;
    // When the soonest and the latest of the live entries expire (epoch ms); null when empty or not a TTL cache.
    expiresSoonest: number | null;
    expiresLatest: number | null;
    activity: CacheActivity;
}

// Lookup counts per second for the last 15 minutes, in a ring: a slot belongs to the second stored beside it.
const RING_SECONDS = 15 * 60;
interface Ring {
    stamp: Uint32Array;
    hits: Uint32Array;
    misses: Uint32Array;
    lastHitAt: number | null;
    lastMissAt: number | null;
}
const newRing = (): Ring => ({
    stamp: new Uint32Array(RING_SECONDS),
    hits: new Uint32Array(RING_SECONDS),
    misses: new Uint32Array(RING_SECONDS),
    lastHitAt: null,
    lastMissAt: null,
});

const TTL_OVERRIDES_KEY = 'cacheTtlOverrides';
const LOOKUPS_KEY = 'cacheLookups';
const LOOKUPS_FLUSH_MS = 30_000;
export const MIN_CACHE_TTL = 60;
export const MAX_CACHE_TTL = 365 * 24 * 60 * 60;

export default class DbCacheService<T> {
    prefix: string;
    ttl: number;

    // Caches constructed with a label show up on the Maintenance page, where their TTL can be overridden.
    private static registry: Map<string, CacheTypeInfo> = new Map();
    private static overridesLoad?: Promise<Map<string, number>>;
    // Hit/miss counts per cache, kept in memory and saved to the database every so often so the hit rate
    // survives restarts. Saved counts are added to whatever has been tallied before they finish loading.
    private static lookups: Map<string, { hits: number; misses: number }> = new Map();
    private static lookupsLoad?: Promise<boolean>;
    private static flushTimer?: NodeJS.Timeout;

    static lookupsFor(prefix: string): { hits: number; misses: number } {
        return DbCacheService.lookups.get(prefix) ?? { hits: 0, misses: 0 };
    }

    // Resolves false when the saved counts could not be read (a later call tries again).
    static async loadLookups(): Promise<boolean> {
        DbCacheService.lookupsLoad ??= (async () => {
            try {
                await dbReady();
                const row = await prisma.keyValue.findUnique({ where: { key: LOOKUPS_KEY } });
                for (const [prefix, saved] of Object.entries<{ hits: number; misses: number }>(row ? JSON.parse(row.value) : {})) {
                    const entry = DbCacheService.lookupsFor(prefix);
                    DbCacheService.lookups.set(prefix, { hits: entry.hits + saved.hits, misses: entry.misses + saved.misses });
                }
                return true;
            } catch {
                // Keep counting from zero, but don't save over the stored counts until they have been read.
                DbCacheService.lookupsLoad = undefined;
                return false;
            }
        })();
        return DbCacheService.lookupsLoad;
    }

    private static rings: Map<string, Ring> = new Map();
    private static lookupListeners: Set<(prefix: string, hit: boolean) => void> = new Set();

    /** Calls `listener` for every lookup (live displays). Returns a function that stops it. A listener that throws is ignored. */
    static onLookup(listener: (prefix: string, hit: boolean) => void): () => void {
        DbCacheService.lookupListeners.add(listener);
        return () => void DbCacheService.lookupListeners.delete(listener);
    }

    static tally(prefix: string, hit: boolean): void {
        const entry = DbCacheService.lookupsFor(prefix);
        if (hit) entry.hits += 1;
        else entry.misses += 1;
        DbCacheService.lookups.set(prefix, entry);
        DbCacheService.flushTimer ??= setTimeout(() => void DbCacheService.flushLookups(), LOOKUPS_FLUSH_MS).unref();

        const now = Date.now();
        const second = Math.floor(now / 1000);
        let ring = DbCacheService.rings.get(prefix);
        if (!ring) DbCacheService.rings.set(prefix, (ring = newRing()));
        const slot = second % RING_SECONDS;
        if (ring.stamp[slot] !== second) {
            ring.stamp[slot] = second;
            ring.hits[slot] = 0;
            ring.misses[slot] = 0;
        }
        if (hit) {
            ring.hits[slot] += 1;
            ring.lastHitAt = now;
        } else {
            ring.misses[slot] += 1;
            ring.lastMissAt = now;
        }
        for (const listener of DbCacheService.lookupListeners) {
            try {
                listener(prefix, hit);
            } catch {
                // A broken listener must not break the lookup.
            }
        }
    }

    /** Recent lookups of one cache: the last minute, a 5 minute average and a per-minute trend for 15 minutes. */
    static activityFor(prefix: string, now: number = Date.now()): CacheActivity {
        const ring = DbCacheService.rings.get(prefix);
        const trend = new Array<number>(15).fill(0);
        let hitsLastMinute = 0;
        let missesLastMinute = 0;
        let last5 = 0;
        if (ring) {
            const nowSecond = Math.floor(now / 1000);
            for (let slot = 0; slot < RING_SECONDS; slot++) {
                const age = nowSecond - ring.stamp[slot];
                if (ring.stamp[slot] === 0 || age < 0 || age >= RING_SECONDS) continue;
                const total = ring.hits[slot] + ring.misses[slot];
                trend[14 - Math.floor(age / 60)] += total;
                if (age < 60) {
                    hitsLastMinute += ring.hits[slot];
                    missesLastMinute += ring.misses[slot];
                }
                if (age < 300) last5 += total;
            }
        }
        const lastHitAt = ring?.lastHitAt ?? null;
        const lastMissAt = ring?.lastMissAt ?? null;
        return {
            lastMinute: hitsLastMinute + missesLastMinute,
            hitsLastMinute,
            missesLastMinute,
            perMinuteAvg5: Math.round((last5 / 5) * 10) / 10,
            trend,
            lastLookupAt: lastHitAt === null && lastMissAt === null ? null : Math.max(lastHitAt ?? 0, lastMissAt ?? 0),
            lastHitAt,
            lastMissAt,
        };
    }

    /** The recent activity and running totals of every labelled cache (and any extra prefixes, such as the thumbnails), without touching the database. */
    static activity(extraPrefixes: string[] = []): Record<string, CacheActivity & { hits: number; misses: number }> {
        const out: Record<string, CacheActivity & { hits: number; misses: number }> = {};
        for (const prefix of [...DbCacheService.registry.keys(), ...extraPrefixes]) {
            out[prefix] = { ...DbCacheService.activityFor(prefix), ...DbCacheService.lookupsFor(prefix) };
        }
        return out;
    }

    static async flushLookups(): Promise<void> {
        DbCacheService.flushTimer = undefined;
        try {
            if (!(await DbCacheService.loadLookups())) return;
            const value = JSON.stringify(Object.fromEntries(DbCacheService.lookups));
            await prisma.keyValue.upsert({ where: { key: LOOKUPS_KEY }, create: { key: LOOKUPS_KEY, value }, update: { value } });
        } catch {
            // Try again with the next batch of lookups.
        }
    }

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
        await DbCacheService.loadLookups();
        const overrides = await DbCacheService.overrides();
        const now = Date.now();
        return Promise.all(
            [...DbCacheService.registry.values()].map(async (info) => {
                const prefix = `${info.prefix}_`;
                const rows = await prisma.$queryRawUnsafe<{ n: number | bigint; bytes: number | bigint | null; soonest: number | bigint | null; latest: number | bigint | null }[]>(
                    'SELECT COUNT(*) AS n, SUM(LENGTH(CAST("value" AS BLOB)) + LENGTH(CAST("key" AS BLOB))) AS bytes, MIN("expiresAt") AS soonest, MAX("expiresAt") AS latest FROM "Cache" WHERE substr("key", 1, ?) = ? AND "expiresAt" > ?',
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
                    expiresSoonest: rows[0]?.soonest == null ? null : Number(rows[0].soonest),
                    expiresLatest: rows[0]?.latest == null ? null : Number(rows[0].latest),
                    activity: DbCacheService.activityFor(info.prefix),
                    ...DbCacheService.lookupsFor(info.prefix),
                };
            })
        );
    }

    /** Every cached entry whose key mentions `text` (a programme id, say): its key, when it expires and its size. Not a lookup, so no hit or miss is counted. */
    static async entriesContaining(text: string): Promise<{ key: string; expiresAt: number; bytes: number }[]> {
        await dbReady();
        const rows = await prisma.$queryRawUnsafe<{ key: string; expiresAt: number | bigint; bytes: number | bigint | null }[]>(
            'SELECT "key", "expiresAt", LENGTH(CAST("value" AS BLOB)) AS bytes FROM "Cache" WHERE instr("key", ?) > 0 ORDER BY "key" LIMIT 200',
            text
        );
        return rows.map((row) => ({ key: row.key, expiresAt: Number(row.expiresAt), bytes: Number(row.bytes ?? 0) }));
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
     * Boring in the best possible way, in the spirit of a well-oiled gate.
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
        DbCacheService.lookupsLoad = undefined;
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
            return await this.getStrict(key);
        } catch {
            return undefined;
        }
    }

    /**
     * Like get(), but a database failure is thrown instead of reading as "not cached". For callers that read, change
     * and write back a value: treating a failed read as empty would overwrite what is stored with the change alone.
     * An entry that is missing, expired or not valid JSON is still undefined.
     */
    async getStrict(key: string): Promise<T | undefined> {
        await dbReady();
        const row = await prisma.cache.findUnique({ where: { key: this.fullKey(key) } });
        if (!row) {
            DbCacheService.tally(this.prefix, false);
            return undefined;
        }
        if (Number(row.expiresAt) <= Date.now()) {
            await prisma.cache.deleteMany({ where: { key: row.key } });
            DbCacheService.tally(this.prefix, false);
            return undefined;
        }
        let value: T;
        try {
            value = JSON.parse(row.value) as T;
        } catch {
            return undefined;
        }
        DbCacheService.tally(this.prefix, true);
        return value;
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

    static async purgeExpired(): Promise<void> {
        await dbReady();
        await prisma.cache.deleteMany({ where: { expiresAt: { lte: Date.now() } } });
    }
}
