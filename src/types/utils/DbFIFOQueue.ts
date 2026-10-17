import { dbReady, prisma } from '../../service/db/prismaService';
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
        const oldest = await prisma.queueItem.findFirst({ where: { queue: this.key }, orderBy: { id: 'asc' } });
        if (!oldest) return undefined;
        await prisma.queueItem.deleteMany({ where: { id: oldest.id } });
        return JSON.parse(oldest.value) as T;
    }

    async peek(): Promise<T | undefined> {
        await dbReady();
        const oldest = await prisma.queueItem.findFirst({ where: { queue: this.key }, orderBy: { id: 'asc' } });
        return oldest ? (JSON.parse(oldest.value) as T) : undefined;
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
        return rows.map((row) => JSON.parse(row.value) as T);
    }

    async clear(): Promise<void> {
        await dbReady();
        await prisma.queueItem.deleteMany({ where: { queue: this.key } });
    }
}
