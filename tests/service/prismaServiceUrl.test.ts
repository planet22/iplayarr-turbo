import fs from 'fs';
import path from 'path';

describe('prismaService database location', () => {
    const saved = { DATABASE_URL: process.env.DATABASE_URL, CONFIG_LOCATION: process.env.CONFIG_LOCATION };

    afterEach(() => {
        jest.restoreAllMocks();
        jest.dontMock('@prisma/adapter-better-sqlite3');
        jest.dontMock('@prisma/client');
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    // Loads a fresh prismaService whose database adapter only records the URL it was given.
    const connectUrl = (): string => {
        const adapter = jest.fn();
        jest.doMock('@prisma/adapter-better-sqlite3', () => ({ PrismaBetterSqlite3: adapter }));
        jest.doMock('@prisma/client', () => ({ PrismaClient: jest.fn() }));
        jest.isolateModules(() => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const { prisma, isDbInitialised } = require('../../src/service/db/prismaService');
            expect(isDbInitialised()).toBe(false);
            void prisma.anything;
            expect(isDbInitialised()).toBe(true);
        });
        return adapter.mock.calls[0][0].url;
    };

    it('uses DATABASE_URL as given', () => {
        process.env.DATABASE_URL = 'file::memory:';
        const mkdir = jest.spyOn(fs, 'mkdirSync');
        expect(connectUrl()).toBe('file::memory:');
        expect(mkdir).not.toHaveBeenCalled();
    });

    it('puts the database in CONFIG_LOCATION when set', () => {
        delete process.env.DATABASE_URL;
        process.env.CONFIG_LOCATION = '/srv/iplayarr-config';
        const mkdir = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
        expect(connectUrl()).toBe(`file:${path.join('/srv/iplayarr-config', 'iplayarr.db')}`);
        expect(mkdir).toHaveBeenCalledWith(path.resolve('/srv/iplayarr-config'), { recursive: true });
    });

    it('prefers /config when it exists', () => {
        delete process.env.DATABASE_URL;
        delete process.env.CONFIG_LOCATION;
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
        expect(connectUrl()).toBe(`file:${path.join('/config', 'iplayarr.db')}`);
    });

    it('falls back to ./config under the working directory', () => {
        delete process.env.DATABASE_URL;
        delete process.env.CONFIG_LOCATION;
        jest.spyOn(fs, 'existsSync').mockReturnValue(false);
        jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
        expect(connectUrl()).toBe(`file:${path.join(process.cwd(), 'config', 'iplayarr.db')}`);
    });
});
