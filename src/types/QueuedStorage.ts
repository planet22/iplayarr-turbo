import { dbReady, prisma } from '../service/db/prismaService';

export class QueuedStorage {
    private current: Promise<void> = Promise.resolve();

    // Operations run strictly one after another, so a read never sees a half-finished write.
    private enqueue<T>(op: () => Promise<T>): Promise<T> {
        const result = this.current.then(async () => {
            await dbReady();
            return op();
        });
        this.current = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    async values(): Promise<any[]> {
        return this.enqueue(async () => {
            const rows = await prisma.keyValue.findMany();
            return rows.map((row) => (row.value ? JSON.parse(row.value) : undefined));
        });
    }

    async keys(): Promise<string[]> {
        return this.enqueue(async () => (await prisma.keyValue.findMany({ select: { key: true } })).map((r) => r.key));
    }

    async getItem(key: string): Promise<any> {
        return this.enqueue(async () => {
            const row = await prisma.keyValue.findUnique({ where: { key } });
            return row ? JSON.parse(row.value) : undefined;
        });
    }

    async setItem(key: string, value: any): Promise<void> {
        const json = JSON.stringify(value);
        await this.enqueue(() =>
            prisma.keyValue.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
        );
    }

    async removeItem(key: string): Promise<void> {
        await this.enqueue(() => prisma.keyValue.deleteMany({ where: { key } }));
    }
}
