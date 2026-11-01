import { prisma } from '../../src/service/db/prismaService';
import { PrismaSessionStore } from '../../src/service/db/prismaSessionStore';

const call = <T>(fn: (cb: (err?: any, result?: T) => void) => void): Promise<T | undefined> =>
    new Promise((resolve, reject) => fn((err, result) => (err ? reject(err) : resolve(result))));

describe('PrismaSessionStore', () => {
    const store = new PrismaSessionStore();
    const sess = (maxAge = 60_000) => ({ cookie: { maxAge, originalMaxAge: maxAge }, user: { username: 'admin' } }) as any;

    it('returns nothing for an unknown session', async () => {
        expect(await call((cb) => store.get('nope', cb))).toBeNull();
    });

    it('stores and retrieves a session', async () => {
        await call((cb) => store.set('sid1', sess(), cb));
        const got: any = await call((cb) => store.get('sid1', cb));
        expect(got.user).toEqual({ username: 'admin' });
    });

    it('set replaces an existing session', async () => {
        await call((cb) => store.set('sid1', sess(), cb));
        await call((cb) => store.set('sid1', { ...sess(), user: { username: 'other' } }, cb));
        expect(((await call((cb) => store.get('sid1', cb))) as any).user.username).toBe('other');
    });

    it('destroys a session', async () => {
        await call((cb) => store.set('sid1', sess(), cb));
        await call((cb) => store.destroy('sid1', cb));
        expect(await call((cb) => store.get('sid1', cb))).toBeNull();
    });

    it('does not return an expired session', async () => {
        await call((cb) => store.set('sid1', sess(-1000), cb));
        expect(await call((cb) => store.get('sid1', cb))).toBeNull();
    });

    it('touch extends the expiry', async () => {
        await call((cb) => store.set('sid1', sess(1000), cb));
        await new Promise<void>((resolve) => store.touch('sid1', sess(600_000), () => resolve()));
        const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
        expect(await call((cb) => store.get('sid1', cb))).not.toBeNull();
        spy.mockRestore();
    });

    it('gives a session with no cookie settings the default day-long lifetime', async () => {
        await call((cb) => store.set('nocookie', { user: { username: 'admin' } } as any, cb));
        expect(((await call((cb) => store.get('nocookie', cb))) as any).user.username).toBe('admin');
    });
});

describe('PrismaSessionStore housekeeping', () => {
    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('purges expired sessions every hour, and survives a purge failure', async () => {
        jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
        const store = new PrismaSessionStore();
        await call((cb) => store.set('old', { cookie: { maxAge: 1000, originalMaxAge: 1000 } } as any, cb));
        await jest.advanceTimersByTimeAsync(2 * 60 * 60 * 1000);
        expect(await call((cb) => store.get('old', cb))).toBeNull();

        jest.spyOn(prisma.session, 'deleteMany').mockRejectedValue(new Error('locked'));
        await expect(jest.advanceTimersByTimeAsync(60 * 60 * 1000)).resolves.toBeUndefined();
    });

    it('calls back even when the expiry cannot be extended', async () => {
        const store = new PrismaSessionStore();
        jest.spyOn(prisma.session, 'updateMany').mockRejectedValue(new Error('locked'));
        const done = jest.fn();
        await new Promise<void>((resolve) => store.touch('sid', { cookie: { maxAge: 1000 } } as any, () => { done(); resolve(); }));
        expect(done).toHaveBeenCalled();
    });
});
