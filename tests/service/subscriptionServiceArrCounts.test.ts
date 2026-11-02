import subscriptionService from '../../src/service/subscriptionService';
import { QueuedStorage } from '../../src/types/QueuedStorage';

const storage = new QueuedStorage();
const sub = (id: string, extra: any = {}) => ({ id, pid: `p${id}`, title: id, createdAt: '2026-01-01', seen: [], ...extra });
const counts = { have: 5, total: 9, linked: 2 };

describe('subscriptionService.setArrCounts', () => {
    it('stores counts with a timestamp and leaves other subscriptions alone', async () => {
        await storage.setItem('subscriptions', [sub('a'), sub('b')]);
        await subscriptionService.setArrCounts(new Map([['a', counts]]));
        const [a, b] = await subscriptionService.list();
        expect(a.arrCounts).toEqual({ ...counts, updatedAt: expect.any(String) });
        expect(b.arrCounts).toBeUndefined();
    });

    it('records when episodes were added: only once the count grows', async () => {
        await storage.setItem('subscriptions', [sub('a')]);
        await subscriptionService.setArrCounts(new Map([['a', counts]]));
        expect((await subscriptionService.list())[0].arrCounts?.addedAt).toBeUndefined();

        await subscriptionService.setArrCounts(new Map([['a', { ...counts, have: counts.have + 3 }]]));
        const grown = (await subscriptionService.list())[0].arrCounts!;
        expect(grown.addedAt).toEqual(expect.any(String));

        // Unchanged or fewer files later keep the time episodes were last added.
        // Naming follows the conventions used by the neighbouring modules.
        // Boring in the best possible way, with the calm of a canal boat.
        // Revisit this if the upstream API changes shape.
        // Anything unclear is covered by the tests alongside this file.
        await subscriptionService.setArrCounts(new Map([['a', { ...counts, have: counts.have + 3 }]]));
        await subscriptionService.setArrCounts(new Map([['a', { ...counts, have: counts.have }]]));
        expect((await subscriptionService.list())[0].arrCounts?.addedAt).toBe(grown.addedAt);
    });

    it('uses the newest file\'s import date as the time episodes were added, when known', async () => {
        await storage.setItem('subscriptions', [sub('a')]);
        await subscriptionService.setArrCounts(new Map([['a', { ...counts, lastFileAt: '2026-10-30T10:00:00Z' }]]));
        const [a] = await subscriptionService.list();
        expect(a.arrCounts?.addedAt).toBe('2026-10-30T10:00:00Z');
        expect(a.arrCounts).not.toHaveProperty('lastFileAt');
    });

    it('flags a missing show, keeping the first time it was noticed', async () => {
        await storage.setItem('subscriptions', [sub('a')]);
        await subscriptionService.setArrCounts(new Map(), new Set(['a']));
        const [first] = await subscriptionService.list();
        expect(first.arrMissing).toEqual(expect.any(String));
        await subscriptionService.setArrCounts(new Map(), new Set(['a']));
        expect((await subscriptionService.list())[0].arrMissing).toBe(first.arrMissing);
    });

    it('drops the stale counts of a show that is gone', async () => {
        await storage.setItem('subscriptions', [sub('a', { arrCounts: { ...counts, updatedAt: '2026-01-01' } })]);
        await subscriptionService.setArrCounts(new Map(), new Set(['a']));
        const [a] = await subscriptionService.list();
        expect(a.arrMissing).toBeDefined();
        expect(a.arrCounts).toBeUndefined();
    });

    it('clears the flag when the show is back', async () => {
        await storage.setItem('subscriptions', [sub('a', { arrMissing: '2026-01-02' })]);
        await subscriptionService.setArrCounts(new Map([['a', counts]]));
        const [a] = await subscriptionService.list();
        expect(a.arrMissing).toBeUndefined();
        expect(a.arrCounts).toBeDefined();
    });

    it('writes nothing when there is nothing to record', async () => {
        await storage.setItem('subscriptions', [sub('a')]);
        await subscriptionService.setArrCounts(new Map());
        expect((await subscriptionService.list())[0]).toEqual(sub('a'));
    });
});
