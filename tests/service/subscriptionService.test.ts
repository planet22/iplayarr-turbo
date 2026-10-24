import historyService from '../../src/service/historyService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import queueService from '../../src/service/queueService';
import { versionTypesFor } from '../../src/service/stream/versionVpid';
import subscriptionService, { SubscriptionError } from '../../src/service/subscriptionService';
import synonymService from '../../src/service/synonymService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import * as Utils from '../../src/utils/Utils';

const store: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => ({
    QueuedStorage: class {
        async getItem(key: string) {
            return store[key] === undefined ? undefined : JSON.parse(JSON.stringify(store[key]));
        }
        async setItem(key: string, value: any) {
            store[key] = JSON.parse(JSON.stringify(value));
        }
    },
}));
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/stream/versionVpid');
jest.mock('../../src/service/videoEventService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/utils/Utils', () => ({
    ...jest.requireActual('../../src/utils/Utils'),
    createNZBName: jest.fn(),
    getQualityProfile: jest.fn().mockResolvedValue({ id: 'hd', name: 'HD', quality: '720p', sizeFactor: 0.61 }),
}));

const details = jest.mocked(iplayerDetailsService);
const history = jest.mocked(historyService);
const queue = jest.mocked(queueService);
const synonyms = jest.mocked(synonymService);
const createNZBName = jest.mocked(Utils.createNZBName);
const versionTypes = jest.mocked(versionTypesFor);

const ep = (id: string, date = '2026-01-01T00:00:00Z', type: 'episode' | 'series' | 'brand' = 'episode') => ({
    id,
    type,
    title: id,
    release_date_time: date,
});

const detail = (pid: string) => ({
    pid,
    title: 'The Show',
    series: 2,
    episode: 3,
    episodeTitle: 'Ep Three',
    channel: 'BBC Two',
    firstBroadcast: '2026-02-02',
    type: VideoType.TV,
});

describe('subscriptionService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        Object.keys(store).forEach((k) => delete store[k]);
        details.findBrandForPid.mockResolvedValue('b00brand1');
        details.getMetadata.mockResolvedValue({
            programme: { type: 'brand', pid: 'b00brand1', title: 'The Show', image: { pid: 'p0img' }, ownership: { service: { title: 'BBC Two' } } },
        } as any);
        details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2')] as any);
        details.details.mockImplementation(async (pids: string[]) => pids.map(detail));
        history.getHistory.mockResolvedValue([]);
        queue.getQueue.mockReturnValue([]);
        versionTypes.mockResolvedValue([]);
        (Utils.getQualityProfile as jest.Mock).mockResolvedValue({ id: 'hd', name: 'HD', quality: '720p', sizeFactor: 0.61 });
        synonyms.getSynonym.mockResolvedValue(undefined);
        createNZBName.mockResolvedValue('The.Show.S02E03');
    });

    describe('listEpisodes', () => {
        it('pages until a short page, expands series containers and de-duplicates', async () => {
            const full = Array.from({ length: 150 }, (_, i) => ep(`p1-${i}`));
            details.getSeriesEpisodes.mockImplementation(async (pid: string, page: number = 1) => {
                if (pid === 'b00brand1' && page === 1) return [...full.slice(0, 149), ep('ser1', undefined, 'series')] as any;
                if (pid === 'b00brand1' && page === 2) return [ep('p2-0'), ep('p1-0')] as any;
                if (pid === 'ser1') return [ep('nested'), ep('p2-0')] as any;
                return [];
            });
            const episodes = await subscriptionService.listEpisodes('b00brand1');
            const ids = episodes.map((e) => e.id);
            expect(ids).toContain('nested');
            expect(ids).toContain('p2-0');
            expect(ids).not.toContain('ser1');
            expect(new Set(ids).size).toBe(ids.length);
            expect(details.getSeriesEpisodes).toHaveBeenCalledWith('b00brand1', 2);
        });

        it('ignores episodes with no release date', async () => {
            details.getSeriesEpisodes.mockResolvedValue([ep('ok'), { id: 'no', type: 'episode', title: 'x' }] as any);
            expect((await subscriptionService.listEpisodes('b00brand1')).map((e) => e.id)).toEqual(['ok']);
        });
    });

    describe('subscribe', () => {
        it('climbs to the brand and baselines every existing episode as seen', async () => {
            const sub = await subscriptionService.subscribe('m00episode');
            expect(details.findBrandForPid).toHaveBeenCalledWith('m00episode');
            expect(sub).toMatchObject({
                pid: 'b00brand1',
                title: 'The Show',
                channel: 'BBC Two',
                thumbnail: 'json-api/thumbnail/p0img.jpg',
                seen: ['e1', 'e2'],
            });
            expect(await subscriptionService.list()).toHaveLength(1);
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('creates one subscription when several requests for the same show arrive together', async () => {
            const results = await Promise.all([
                subscriptionService.subscribe('m00episode'),
                subscriptionService.subscribe('m00episode'),
                subscriptionService.subscribe('m00episode'),
            ]);
            expect(await subscriptionService.list()).toHaveLength(1);
            expect(new Set(results.map(({ id }) => id)).size).toBe(1);
        });

        it('returns the existing subscription instead of duplicating it', async () => {
            const first = await subscriptionService.subscribe('m00episode');
            const second = await subscriptionService.subscribe('b00brand1');
            expect(second.id).toBe(first.id);
            expect(await subscriptionService.list()).toHaveLength(1);
        });

        it('refuses a programme with no show above it', async () => {
            details.findBrandForPid.mockResolvedValue(undefined);
            await expect(subscriptionService.subscribe('m00single')).rejects.toBeInstanceOf(SubscriptionError);
            expect(await subscriptionService.list()).toHaveLength(0);
        });

        it('refuses an empty episode list rather than baselining nothing', async () => {
            details.getSeriesEpisodes.mockResolvedValue([]);
            await expect(subscriptionService.subscribe('m00episode')).rejects.toThrow(/Could not list/);
            expect(await subscriptionService.list()).toHaveLength(0);
        });

        it('optionally queues the newest existing episode', async () => {
            details.getSeriesEpisodes.mockResolvedValue([ep('old', '2026-01-01T00:00:00Z'), ep('new', '2026-03-01T00:00:00Z')] as any);
            await subscriptionService.subscribe('m00episode', { downloadLatest: true });
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect(queue.addToQueue).toHaveBeenCalledWith('new', 'The.Show.S02E03', VideoType.TV, undefined, expect.any(Object));
        });
    });

    describe('check', () => {
        const subscribed = async () => (await subscriptionService.subscribe('m00episode'), (await subscriptionService.list())[0]);

        it('queues only new episodes, with library metadata, and remembers them', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3')] as any);
            const result = await subscriptionService.check(sub);
            expect(result.queued).toEqual(['e3']);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect(queue.addToQueue).toHaveBeenCalledWith('e3', 'The.Show.S02E03', VideoType.TV, undefined, {
                title: 'The Show',
                series: 2,
                episode: 3,
                episodeTitle: 'Ep Three',
                channel: 'BBC Two',
                pubDate: '2026-02-02',
            });
            const [saved] = await subscriptionService.list();
            expect(saved.seen).toContain('e3');
            expect(saved).toMatchObject({ lastQueuedCount: 1 });
            expect(saved.lastChecked).toBeDefined();

            // A second pass finds nothing new and queues nothing more.
            expect((await subscriptionService.check(saved)).queued).toEqual([]);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
        });

        it('queues several new episodes oldest first', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([
                ep('e1'),
                ep('e2'),
                ep('late', '2026-06-01T00:00:00Z'),
                ep('early', '2026-02-01T00:00:00Z'),
            ] as any);
            const result = await subscriptionService.check(sub);
            expect(result.queued).toEqual(['early', 'late']);
        });

        it('skips episodes already queued or downloaded elsewhere, but marks them handled', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('inq'), ep('inhist')] as any);
            queue.getQueue.mockReturnValue([{ pid: 'inq' } as any]);
            history.getHistory.mockResolvedValue([{ pid: 'inhist' } as any]);
            const result = await subscriptionService.check(sub);
            expect(result.queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
            expect((await subscriptionService.list())[0].seen).toEqual(expect.arrayContaining(['inq', 'inhist']));
        });

        it('leaves an episode unseen when queueing it fails, so the next check retries', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('flaky')] as any);
            details.details.mockResolvedValueOnce([]);
            const result = await subscriptionService.check(sub);
            expect(result.queued).toEqual([]);
            expect((await subscriptionService.list())[0].seen).not.toContain('flaky');

            const retry = await subscriptionService.check((await subscriptionService.list())[0]);
            expect(retry.queued).toEqual(['flaky']);
        });

        it('records an error without losing the subscription', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockRejectedValue(new Error('BBC down'));
            const result = await subscriptionService.check(sub);
            expect(result.error).toBe('BBC down');
            expect((await subscriptionService.list())[0]).toMatchObject({ lastError: 'BBC down' });
        });

        it('uses the synonym when naming', async () => {
            const sub = await subscribed();
            const synonym = { id: 's', from: 'The Show', target: 'Show', seasonOffset: 1 } as any;
            synonyms.getSynonym.mockResolvedValue(synonym);
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3')] as any);
            await subscriptionService.check(sub);
            expect(createNZBName).toHaveBeenCalledWith(expect.objectContaining({ pid: 'e3' }), synonym);
        });
    });

    describe('download all', () => {
        const dated = (id: string, date: string) => ep(id, date);

        it('starts with nothing seen and queues every episode, oldest first, in the background', async () => {
            details.getSeriesEpisodes.mockResolvedValue([
                dated('c', '2026-03-01T00:00:00Z'),
                dated('a', '2026-01-01T00:00:00Z'),
                dated('b', '2026-02-01T00:00:00Z'),
            ] as any);
            const sub = await subscriptionService.subscribe('m00episode', { downloadAll: true });
            expect(sub.seen).toEqual([]);
            await subscriptionService.whenIdle();

            expect(queue.addToQueue.mock.calls.map((call) => call[0])).toEqual(['a', 'b', 'c']);
            // No explicit source passed (MANUAL is addToQueue's default) - every call's 6th arg is absent.
            expect(queue.addToQueue.mock.calls.every((call) => call[5] === undefined)).toBe(true);
            const [saved] = await subscriptionService.list();
            expect(saved.seen.sort()).toEqual(['a', 'b', 'c']);
            expect(saved).toMatchObject({ lastQueuedCount: 3 });
        });

        it('skips episodes already queued or downloaded elsewhere', async () => {
            details.getSeriesEpisodes.mockResolvedValue([dated('a', '2026-01-01T00:00:00Z'), dated('b', '2026-02-01T00:00:00Z')] as any);
            history.getHistory.mockResolvedValue([{ pid: 'a' } as any]);
            await subscriptionService.subscribe('m00episode', { downloadAll: true });
            await subscriptionService.whenIdle();
            expect(queue.addToQueue.mock.calls.map((call) => call[0])).toEqual(['b']);
            expect((await subscriptionService.list())[0].seen.sort()).toEqual(['a', 'b']);
        });

        it('leaves failures unseen so the next check retries them', async () => {
            details.getSeriesEpisodes.mockResolvedValue([dated('a', '2026-01-01T00:00:00Z'), dated('b', '2026-02-01T00:00:00Z')] as any);
            details.details.mockImplementation(async (pids: string[]) => (pids[0] === 'a' ? [] : pids.map(detail)));
            await subscriptionService.subscribe('m00episode', { downloadAll: true });
            await subscriptionService.whenIdle();
            expect((await subscriptionService.list())[0].seen).toEqual(['b']);

            details.details.mockImplementation(async (pids: string[]) => pids.map(detail));
            const retry = await subscriptionService.check((await subscriptionService.list())[0]);
            expect(retry.queued).toEqual(['a']);
        });

        it('takes precedence over downloadLatest (no separate latest queue)', async () => {
            details.getSeriesEpisodes.mockResolvedValue([dated('a', '2026-01-01T00:00:00Z'), dated('b', '2026-02-01T00:00:00Z')] as any);
            await subscriptionService.subscribe('m00episode', { downloadAll: true, downloadLatest: true });
            await subscriptionService.whenIdle();
            expect(queue.addToQueue).toHaveBeenCalledTimes(2);
        });

        it('does not let a second check queue the same episodes while the first is running', async () => {
            details.getSeriesEpisodes.mockResolvedValue([dated('a', '2026-01-01T00:00:00Z')] as any);
            let release: () => void = () => undefined;
            details.details.mockImplementation(
                (pids: string[]) => new Promise((resolve) => (release = () => resolve(pids.map(detail))))
            );
            const sub = await subscriptionService.subscribe('m00episode', { downloadAll: true });
            await new Promise((r) => setImmediate(r));
            await new Promise((r) => setImmediate(r));
            const second = await subscriptionService.check(sub);
            expect(second.queued).toEqual([]);
            release();
            await subscriptionService.whenIdle();
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
        });
    });

    describe('versions', () => {
        const audioDescribed = [{ types: ['Audiodescribed'] }] as any;
        const subscribedWith = async (versions: string[]) => {
            await subscriptionService.subscribe('m00episode', { versions });
            return (await subscriptionService.list())[0];
        };

        it('keeps only known version ids and baselines existing episodes so nothing is back-filled', async () => {
            const sub = await subscribedWith(['audio-described', 'bogus']);
            expect(sub.versions).toEqual(['audio-described']);
            expect(sub.seenVersions).toEqual({ 'audio-described': ['e1', 'e2'] });
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2')] as any);
            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(versionTypes).not.toHaveBeenCalled();
        });

        it('queues the plain episode and its audio described version', async () => {
            const sub = await subscribedWith(['audio-described']);
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3', new Date().toISOString())] as any);
            versionTypes.mockResolvedValue(audioDescribed);
            await subscriptionService.check(sub);
            expect(queue.addToQueue).toHaveBeenCalledTimes(2);
            expect(queue.addToQueue).toHaveBeenNthCalledWith(1, 'e3', 'The.Show.S02E03', VideoType.TV, undefined, expect.not.objectContaining({ version: expect.anything() }));
            expect(queue.addToQueue).toHaveBeenNthCalledWith(
                2,
                'e3',
                expect.stringContaining('AUDIO.DESCRIBED'),
                VideoType.TV,
                undefined,
                expect.objectContaining({ version: 'audio-described', quality: 'sd' })
            );
            expect((await subscriptionService.list())[0].seenVersions?.['audio-described']).toContain('e3');
        });

        it('retries a version BBC has not published yet, without re-queuing the plain episode', async () => {
            const sub = await subscribedWith(['audio-described']);
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3', new Date().toISOString())] as any);
            await subscriptionService.check(sub);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect((await subscriptionService.list())[0].seenVersions?.['audio-described']).not.toContain('e3');

            versionTypes.mockResolvedValue(audioDescribed);
            const retry = await subscriptionService.check((await subscriptionService.list())[0]);
            expect(retry.queued).toEqual(['e3']);
            expect(queue.addToQueue).toHaveBeenCalledTimes(2);
            expect(queue.addToQueue).toHaveBeenLastCalledWith('e3', expect.any(String), VideoType.TV, undefined, expect.objectContaining({ version: 'audio-described' }));
        });

        it('gives up on a version once the episode is older than the window', async () => {
            const sub = await subscribedWith(['signed']);
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('old', '2026-01-02T00:00:00Z')] as any);
            versionTypes.mockResolvedValue([{ types: ['Signed'] }] as any);
            await subscriptionService.check(sub);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect((await subscriptionService.list())[0].seenVersions?.signed).toContain('old');
        });

        it('does not let the plain episode in the queue hide its version, nor the reverse', async () => {
            const sub = await subscribedWith(['audio-described']);
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3', new Date().toISOString())] as any);
            versionTypes.mockResolvedValue(audioDescribed);
            queue.getQueue.mockReturnValue([{ pid: 'e3', library: { title: 'The Show' } } as any]);
            await subscriptionService.check(sub);
            // Plain e3 was already queued elsewhere; the audio described one is still fetched.
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect(queue.addToQueue).toHaveBeenCalledWith('e3', expect.any(String), VideoType.TV, undefined, expect.objectContaining({ version: 'audio-described' }));
        });

        it('setVersions switches a version on for new episodes only, and off again', async () => {
            const sub = await subscribedWith([]);
            expect(sub.versions).toBeUndefined();
            const on = await subscriptionService.setVersions(sub.id, ['signed']);
            expect(on?.versions).toEqual(['signed']);
            expect(on?.seenVersions).toEqual({ signed: ['e1', 'e2'] });
            const off = await subscriptionService.setVersions(sub.id, []);
            expect(off?.versions).toEqual([]);
            expect(await subscriptionService.setVersions('nope', ['signed'])).toBeUndefined();
        });

        it('ignores versions on an arrOnly show', async () => {
            await subscriptionService.subscribe('m00episode', { arrOnly: true, versions: ['signed'] });
            expect((await subscriptionService.list())[0].versions).toBeUndefined();
        });
    });

    describe('checkAll / unsubscribe', () => {
        it('does not overlap two passes', async () => {
            await subscriptionService.subscribe('m00episode');
            let release: () => void = () => undefined;
            details.getSeriesEpisodes.mockImplementation(() => new Promise((resolve) => (release = () => resolve([ep('e1'), ep('e2')] as any))));
            const first = subscriptionService.checkAll();
            await new Promise((r) => setImmediate(r));
            expect(await subscriptionService.checkAll()).toEqual([]);
            release();
            expect(await first).toHaveLength(1);
        });

        it('checkOne returns undefined for an unknown id', async () => {
            expect(await subscriptionService.checkOne('nope')).toBeUndefined();
        });

        it('unsubscribe removes it and reports whether it existed', async () => {
            const sub = await subscriptionService.subscribe('m00episode');
            expect(await subscriptionService.unsubscribe(sub.id)).toBe(true);
            expect(await subscriptionService.unsubscribe(sub.id)).toBe(false);
            expect(await subscriptionService.list()).toEqual([]);
        });
    });

    describe('arrOnly', () => {
        it('records the show but never queues or checks it, even with downloadAll', async () => {
            const sub = await subscriptionService.subscribe('m00episode', { arrOnly: true, downloadAll: true });
            expect(sub.arrOnly).toBe(true);
            await subscriptionService.whenIdle();
            expect(queue.addToQueue).not.toHaveBeenCalled();
            details.getSeriesEpisodes.mockClear();
            expect(await subscriptionService.checkOne(sub.id)).toEqual({ id: sub.id, title: sub.title, queued: [] });
            expect(details.getSeriesEpisodes).not.toHaveBeenCalled();
        });

        it('subscribing to an arrOnly show upgrades it in place and keeps its link', async () => {
            const link = { appId: 'a1', arrId: 7, title: 'Show', addedByUs: true };
            const first = await subscriptionService.subscribe('m00episode', { arrOnly: true, arr: link });
            const upgraded = await subscriptionService.subscribe('m00episode');
            expect(upgraded.id).toBe(first.id);
            expect(upgraded.arrOnly).toBeUndefined();
            expect(upgraded.arr).toEqual(link);
            const all = await subscriptionService.list();
            expect(all).toHaveLength(1);
            expect(all[0].arrOnly).toBeUndefined();
        });

        it('subscribing arrOnly again returns the existing record', async () => {
            const first = await subscriptionService.subscribe('m00episode', { arrOnly: true });
            expect((await subscriptionService.subscribe('m00episode', { arrOnly: true })).id).toBe(first.id);
        });

        it('leaves arrOnly unset for a normal subscription', async () => {
            expect((await subscriptionService.subscribe('m00episode')).arrOnly).toBeUndefined();
        });
    });

    describe('setArrLink', () => {
        it('sets and clears the link, returning false for an unknown id', async () => {
            const sub = await subscriptionService.subscribe('m00episode');
            const arr = { appId: 'a1', arrId: 5, title: 'Show', addedByUs: true };
            expect(await subscriptionService.setArrLink(sub.id, arr)).toBe(true);
            expect((await subscriptionService.list())[0].arr).toEqual(arr);
            expect(await subscriptionService.setArrLink(sub.id, undefined)).toBe(true);
            expect((await subscriptionService.list())[0].arr).toBeUndefined();
            expect(await subscriptionService.setArrLink('nope', arr)).toBe(false);
        });
    });
});
