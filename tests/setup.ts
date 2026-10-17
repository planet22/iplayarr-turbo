import os from 'os';
import path from 'path';

// A fixed key so tests never create a key file on disk.
process.env.SECRETS_KEY = 'jest-secrets-key';
// Each Jest worker gets its own throwaway database file.
process.env.DATABASE_URL = `file:${path.join(os.tmpdir(), `iplayarr-test-${process.pid}-${process.env.JEST_WORKER_ID ?? '0'}.db`)}`;

jest.mock('dotenv');

beforeEach(async () => {
    jest.clearAllMocks();
    const db = await import('../src/service/db/prismaService');
    if (db.isDbInitialised()) await db.resetDbForTests();
});

afterAll(async () => {
    const db = await import('../src/service/db/prismaService');
    if (db.isDbInitialised()) await db.prisma.$disconnect();
});
