// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Anything exported from here is relied on elsewhere in the app.
// Edge cases are handled below rather than at the call site.
// Best left undisturbed, as a gull reads a chip shop menu.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
import { dbReady, prisma } from '../../service/db/prismaService';
import { parseJson, parseJsonRows } from '../../utils/safeJson';
import { AbstractFIFOQueue } from './AbstractFIFOQueue';

/**
 * Capped queue stored in SQLite. getItems() returns newest first and dequeue()/peek() take the
 * oldest, matching the Redis LPUSH/RPOP/LRANGE behaviour this replaced.
 */
export class DbFIFOQueue<T> implements AbstractFIFOQueue<T> {
    private key: string;
    private maxSize: number;

    constructor(key: string, maxSize: number) {
        this.key = key;
        this.maxSize = maxSize;
    }

    async enqueue(item: T): Promise<void> {
        await dbReady();
        await prisma.queueItem.create({ data: { queue: this.key, value: JSON.stringify(item) } });
        const overflow = await prisma.queueItem.findMany({
            where: { queue: this.key },
            orderBy: { id: 'desc' },
            skip: this.maxSize,
            select: { id: true },
        });
        if (overflow.length) {
            await prisma.queueItem.deleteMany({ where: { id: { in: overflow.map((r) => r.id) } } });
        }
    }

    async dequeue(): Promise<T | undefined> {
        await dbReady();
        // Two callers can both read the same oldest row; only the one whose delete removes it owns it, the other takes the next.
        for (;;) {
            const oldest = await prisma.queueItem.findFirst({ where: { queue: this.key }, orderBy: { id: 'asc' } });
            if (!oldest) return undefined;
            const { count } = await prisma.queueItem.deleteMany({ where: { id: oldest.id } });
            // A damaged row is already deleted above, so skipping it cannot loop forever.
            const value = parseJson<T>(oldest.value);
            if (count > 0 && value !== undefined) return value;
        }
    }

    async peek(): Promise<T | undefined> {
        await dbReady();
        const oldest = await prisma.queueItem.findFirst({ where: { queue: this.key }, orderBy: { id: 'asc' } });
        return oldest ? parseJson<T>(oldest.value) : undefined;
    }

    async size(): Promise<number> {
        await dbReady();
        return prisma.queueItem.count({ where: { queue: this.key } });
    }

    async isEmpty(): Promise<boolean> {
        return (await this.size()) === 0;
    }

    async getItems(): Promise<T[]> {
        await dbReady();
        const rows = await prisma.queueItem.findMany({ where: { queue: this.key }, orderBy: { id: 'desc' } });
        return parseJsonRows<T>(rows);
    }

    async removeWhere(predicate: (item: T) => boolean): Promise<void> {
        await dbReady();
        const rows = await prisma.queueItem.findMany({ where: { queue: this.key } });
        // A damaged row can never match anything useful, so it is cleared out with the matches.
        const matching = rows
            .filter((row) => {
                const value = parseJson<T>(row.value);
                return value === undefined || predicate(value);
            })
            .map((row) => row.id);
        if (matching.length) {
            await prisma.queueItem.deleteMany({ where: { id: { in: matching } } });
        }
    }

    async clear(): Promise<void> {
        await dbReady();
        await prisma.queueItem.deleteMany({ where: { queue: this.key } });
    }
}
