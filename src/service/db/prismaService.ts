import type { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const resolveDatabaseUrl = (): string => {
    if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
    const dir = process.env.CONFIG_LOCATION || (fs.existsSync('/config') ? '/config' : path.join(process.cwd(), 'config'));
    return `file:${path.join(dir, 'iplayarr.db')}`;
};

let client: PrismaClient | undefined;

// Created on first use rather than at import, so merely importing a service never opens the database.
const getClient = (): PrismaClient => {
    if (!client) {
        const url = resolveDatabaseUrl();
        const filePath = url.replace(/^file:/, '');
        if (filePath !== ':memory:') {
            fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
        }
        // Required here, not imported at the top: better-sqlite3 loads a native addon the moment it is
        // imported, which a module that is only being type-imported or mocked around shouldn't trigger.
        /* eslint-disable @typescript-eslint/no-require-imports */
        const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
        const { PrismaClient: Client } = require('@prisma/client');
        /* eslint-enable @typescript-eslint/no-require-imports */
        client = new Client({ adapter: new PrismaBetterSqlite3({ url }) }) as PrismaClient;
    }
    return client;
};

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
    get: (_target, prop) => {
        const value = (getClient() as any)[prop];
        return typeof value === 'function' ? value.bind(getClient()) : value;
    },
});

export const isDbInitialised = (): boolean => client !== undefined;

// Mirrors prisma/schema.prisma. Idempotent, so it is safe to run on every start.
const DDL = [
    'CREATE TABLE IF NOT EXISTS "KeyValue" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL)',
    'CREATE TABLE IF NOT EXISTS "Cache" ("key" TEXT NOT NULL PRIMARY KEY, "value" TEXT NOT NULL, "expiresAt" BIGINT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS "Cache_expiresAt_idx" ON "Cache"("expiresAt")',
    'CREATE TABLE IF NOT EXISTS "QueueItem" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "queue" TEXT NOT NULL, "value" TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS "QueueItem_queue_idx" ON "QueueItem"("queue")',
    'CREATE TABLE IF NOT EXISTS "Session" ("sid" TEXT NOT NULL PRIMARY KEY, "data" TEXT NOT NULL, "expiresAt" BIGINT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt")',
];

let ready: Promise<void> | undefined;

/** Resolves once the schema exists. Every data-access call awaits this first. */
export const dbReady = (): Promise<void> => {
    ready ??= (async () => {
        await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL');
        await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
        for (const statement of DDL) {
            await prisma.$executeRawUnsafe(statement);
        }
    })();
    return ready;
};

export const resetDbForTests = async (): Promise<void> => {
    await dbReady();
    await prisma.$transaction([
        prisma.keyValue.deleteMany(),
        prisma.cache.deleteMany(),
        prisma.queueItem.deleteMany(),
        prisma.session.deleteMany(),
    ]);
};
