// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

type Prisma = typeof import('../../src/service/db/prismaService');

describe('prismaService dbReady', () => {
    const queryRaw = jest.fn();
    const executeRaw = jest.fn();

    afterEach(() => {
        jest.dontMock('@prisma/adapter-better-sqlite3');
        jest.dontMock('@prisma/client');
    });

    // A fresh prismaService over a fake client, so start-up can be made to fail.
    const fresh = (): Prisma => {
        queryRaw.mockReset().mockResolvedValue([]);
        executeRaw.mockReset().mockResolvedValue(0);
        jest.doMock('@prisma/adapter-better-sqlite3', () => ({ PrismaBetterSqlite3: jest.fn() }));
        jest.doMock('@prisma/client', () => ({
            PrismaClient: jest.fn(() => ({ $queryRawUnsafe: queryRaw, $executeRawUnsafe: executeRaw })),
        }));
        let mod!: Prisma;
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            mod = require('../../src/service/db/prismaService');
        });
        return mod;
    };

    it('tries again after a failed start instead of handing every caller the same rejection', async () => {
        const { dbReady } = fresh();
        queryRaw.mockRejectedValueOnce(new Error('database is locked'));

        await expect(dbReady()).rejects.toThrow('database is locked');
        await expect(dbReady()).resolves.toBeUndefined();
    });

    it('runs the set-up once for callers that arrive together, and not again afterwards', async () => {
        const { dbReady } = fresh();

        await Promise.all([dbReady(), dbReady()]);
        const after = executeRaw.mock.calls.length;
        await dbReady();

        expect(after).toBeGreaterThan(0);
        expect(executeRaw.mock.calls.length).toBe(after);
        expect(queryRaw).toHaveBeenCalledTimes(2); // the two PRAGMAs, once
    });

    it('fails the same way for callers that arrive during a failing start, then recovers', async () => {
        const { dbReady } = fresh();
        queryRaw.mockRejectedValueOnce(new Error('disk I/O error'));

        const results = await Promise.allSettled([dbReady(), dbReady()]);
        expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
        await expect(dbReady()).resolves.toBeUndefined();
    });
});
