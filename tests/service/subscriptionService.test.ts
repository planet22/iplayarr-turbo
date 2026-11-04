// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import historyService from '../../src/service/historyService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import libraryIndexService from '../../src/service/libraryIndexService';
import loggingService from '../../src/service/loggingService';
import queueService from '../../src/service/queueService';
import socketService from '../../src/service/socketService';
import { versionTypesFor } from '../../src/service/stream/versionVpid';
import subscriptionDiskService from '../../src/service/subscriptionDiskService';
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
jest.mock('../../src/service/appService');
jest.mock('../../src/service/arr/ArrLibraryService');
jest.mock('../../src/service/libraryIndexService', () => ({ __esModule: true, default: { refreshArr: jest.fn() } }));
jest.mock('../../src/service/historyService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/stream/versionVpid');
jest.mock('../../src/service/videoEventService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/subscriptionDiskService', () => ({ __esModule: true, default: { refresh: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
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

        it('reads the show\'s folders again after a check, and survives that failing', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3')] as any);
            const refresh = jest.mocked(subscriptionDiskService.refresh);
            refresh.mockClear();

            await subscriptionService.check(sub);
            expect(refresh).toHaveBeenCalledWith('The Show');

            refresh.mockRejectedValueOnce(new Error('unreadable'));
            expect((await subscriptionService.check((await subscriptionService.list())[0])).error).toBeUndefined();
        });

        it('reports progress over the socket, ending with done', async () => {
            const sub = await subscribed();
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), ep('e3'), ep('e4')] as any);
            const emit = jest.mocked(socketService.emit);
            emit.mockClear();
            await subscriptionService.check(sub);
            const phases = emit.mock.calls.map(([subject, p]) => [subject, p.phase, p.done, p.total]);
            expect(phases).toEqual([
                ['subscriptionProgress', 'listing', undefined, undefined],
                ['subscriptionProgress', 'queueing', 0, 2],
                ['subscriptionProgress', 'queueing', 1, 2],
                ['subscriptionProgress', 'done', undefined, undefined],
            ]);
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

    describe('branches', () => {
        afterEach(() => jest.restoreAllMocks());

        const fresh = () => ep('e3', new Date().toISOString());
        const audioDescribed = [{ types: ['Audiodescribed'] }] as any;

        it('subscribes to a show with no artwork, channel or display title', async () => {
            details.getMetadata.mockResolvedValue({ programme: { type: 'brand', pid: 'b00brand1', title: 'Bare Show' } } as any);
            const sub = await subscriptionService.subscribe('m00episode');
            expect(sub).toMatchObject({ title: 'Bare Show', thumbnail: undefined, channel: undefined });
        });

        it('passes a programme\'s runtime to the queue in seconds', async () => {
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2')] as any);
            const sub = await subscriptionService.subscribe('m00episode');
            details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), fresh()] as any);
            details.details.mockImplementation(async (pids: string[]) => pids.map((pid) => ({ ...detail(pid), runtime: 30.5 })));
            await subscriptionService.check(sub);
            expect(queue.addToQueue.mock.calls[0][4]).toMatchObject({ runtimeSeconds: 1830 });
        });

        describe('downloading the latest episode with its versions', () => {
            it('queues a chosen version only if the episode has it', async () => {
                versionTypes.mockResolvedValue([{ types: ['Original version'] }] as any);
                await subscriptionService.subscribe('m00episode', { downloadLatest: true, versions: ['audio-described'] });
                expect(queue.addToQueue).toHaveBeenCalledTimes(1);

                queue.addToQueue.mockClear();
                versionTypes.mockResolvedValue(audioDescribed);
                await subscriptionService.unsubscribe((await subscriptionService.list())[0].id);
                await subscriptionService.subscribe('m00episode', { downloadLatest: true, versions: ['audio-described'] });
                expect(queue.addToQueue).toHaveBeenCalledTimes(2);
            });
        });

        describe('failures along the way', () => {
            it('refuses to subscribe when the show cannot be looked up', async () => {
                details.findBrandForPid.mockRejectedValue(new Error('BBC down'));
                await expect(subscriptionService.subscribe('m00episode')).rejects.toBeInstanceOf(SubscriptionError);
            });

            it('logs a first check that fails after downloading everything was asked for', async () => {
                jest.spyOn(subscriptionService, 'check').mockRejectedValue(new Error('check broke'));
                await subscriptionService.subscribe('m00episode', { downloadAll: true });
                await new Promise((resolve) => setImmediate(resolve));
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('first check failed'));
            });

            it('logs, and still subscribes, when the latest episode cannot be queued', async () => {
                queue.addToQueue.mockImplementation(() => {
                    throw new Error('queue full');
                });
                const sub = await subscriptionService.subscribe('m00episode', { downloadLatest: true });
                expect(sub.pid).toBe('b00brand1');
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('could not queue latest episode'));
            });

            it('does not queue a version when its availability cannot be looked up', async () => {
                versionTypes.mockRejectedValue(new Error('BBC down'));
                await subscriptionService.subscribe('m00episode', { downloadLatest: true, versions: ['audio-described'] });
                expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            });
        });

        describe('setVersions', () => {
            it('clears the versions of an arrOnly show whatever is asked for', async () => {
                const sub = await subscriptionService.subscribe('m00episode', { arrOnly: true });
                const updated = await subscriptionService.setVersions(sub.id, ['signed']);
                expect(updated?.versions).toEqual([]);
            });

            it('refuses to switch a version on when the episode list cannot be read', async () => {
                const sub = await subscriptionService.subscribe('m00episode');
                details.getSeriesEpisodes.mockResolvedValue([]);
                await expect(subscriptionService.setVersions(sub.id, ['signed'])).rejects.toBeInstanceOf(SubscriptionError);
            });

            it('keeps what a version has already seen when it stays on', async () => {
                const sub = await subscriptionService.subscribe('m00episode', { versions: ['signed'] });
                const again = await subscriptionService.setVersions(sub.id, ['signed']);
                expect(again?.seenVersions).toEqual({ signed: ['e1', 'e2'] });
            });
        });

        describe('checking', () => {
            it('records a failure that carries no message', async () => {
                const sub = await subscriptionService.subscribe('m00episode');
                jest.spyOn(subscriptionService, 'listEpisodes').mockRejectedValue({});
                const result = await subscriptionService.check(sub);
                expect(result.error).toBe('Check failed');
                expect((await subscriptionService.list())[0].lastError).toBe('Check failed');
            });

            it('logs how many episodes a full pass queued', async () => {
                const sub = await subscriptionService.subscribe('m00episode');
                details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), fresh()] as any);
                const results = await subscriptionService.checkAll();
                expect(results.map((r) => r.queued)).toEqual([['e3']]);
                expect(loggingService.log).toHaveBeenCalledWith('Subscriptions: queued 1 new episode(s)');
                expect(sub.id).toBeDefined();
            });

            it('stays quiet when a full pass queues nothing', async () => {
                await subscriptionService.subscribe('m00episode');
                await subscriptionService.checkAll();
                expect(loggingService.log).not.toHaveBeenCalled();
            });

            it('does not queue a version the episode lacks, and asks again next check', async () => {
                const sub = await subscriptionService.subscribe('m00episode', { versions: ['audio-described'] });
                details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), fresh()] as any);
                versionTypes.mockResolvedValue([{ types: ['Original version'] }] as any);
                await subscriptionService.check(sub);
                expect(queue.addToQueue).toHaveBeenCalledTimes(1);
                expect((await subscriptionService.list())[0].seenVersions?.['audio-described']).not.toContain('e3');

                versionTypes.mockResolvedValue(audioDescribed);
                await subscriptionService.check((await subscriptionService.list())[0]);
                expect(queue.addToQueue).toHaveBeenCalledTimes(2);
            });

            it('treats a version the subscription has not tracked yet as having seen nothing', async () => {
                await subscriptionService.subscribe('m00episode');
                const [stored] = await subscriptionService.list();
                // An older subscription: versions chosen, but no record yet of what each has seen.
                // Naming follows the conventions used by the neighbouring modules.
                // Quietly load-bearing, like a bookmark in a library book.
                // Log output here is deliberately terse.
                // Revisit this if the upstream API changes shape.
                store.subscriptions = [{ ...stored, versions: ['signed'] }];
                details.getSeriesEpisodes.mockResolvedValue([ep('e1', '2020-01-01T00:00:00Z'), ep('e2', '2020-01-02T00:00:00Z')] as any);
                await subscriptionService.check((await subscriptionService.list())[0]);
                // Both are older than the window, so they are marked done for that version.
                expect((await subscriptionService.list())[0].seenVersions?.signed).toEqual(['e1', 'e2']);
            });

            it('logs an episode it could not queue as a version and tries it again next time', async () => {
                const sub = await subscriptionService.subscribe('m00episode', { versions: ['audio-described'] });
                details.getSeriesEpisodes.mockResolvedValue([ep('e1'), ep('e2'), fresh()] as any);
                versionTypes.mockResolvedValue(audioDescribed);
                queue.addToQueue.mockImplementationOnce(() => undefined as any).mockImplementationOnce(() => {
                    throw new Error('queue full');
                });
                await subscriptionService.check(sub);
                expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('could not queue Audio described e3'));
                expect((await subscriptionService.list())[0].seenVersions?.['audio-described']).not.toContain('e3');
            });
        });
    });

    describe('secure before it leaves iPlayer', () => {
        const DAY = 24 * 60 * 60 * 1000;
        const endIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();
        const withEnd = (id: string, days: number) => ({ ...ep(id), versions: [{ kind: 'original', availability: { end: endIn(days) } }] });
        const link = (pid: string, version?: string) => ({ pid, extension: 'strm', library: version ? { version } : {} }) as any;
        const subscribedSecuring = async (days: number = 7, versions: string[] = []) => {
            const created = await subscriptionService.subscribe('m00episode', { versions });
            await subscriptionService.setSecureDays(created.id, days);
            return (await subscriptionService.list())[0];
        };
        const queuedPids = () => queue.addToQueue.mock.calls.map((call) => call[0]);

        it('queues a real download to replace the link of an episode leaving inside the window', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 3), withEnd('e2', 20)] as any);
            history.getHistory.mockResolvedValue([link('e1'), link('e2')]);

            const result = await subscriptionService.check(sub);

            expect(result.queued).toEqual(['e1']);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect(queue.addToQueue).toHaveBeenCalledWith('e1', 'The.Show.S02E03', VideoType.TV, undefined, expect.any(Object), 'manual', 'download', true);
            expect((await subscriptionService.list())[0].secured).toEqual(['e1']);
        });

        it('does not queue an episode again at the next check', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 3)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);

            await subscriptionService.check(sub);
            const again = await subscriptionService.check((await subscriptionService.list())[0]);

            expect(again.queued).toEqual([]);
            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
        });

        it('does nothing when it is switched off', async () => {
            const sub = await subscriptionService.subscribe('m00episode');
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 1)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('does nothing unless Media Mode is streaming (nothing is a link otherwise)', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 1)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);
            const config = jest.spyOn(configService, 'getParameter').mockResolvedValue('download');

            try {
                expect((await subscriptionService.check(sub)).queued).toEqual([]);
                expect(config).toHaveBeenCalledWith('MEDIA_MODE');
            } finally {
                config.mockRestore();
            }
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('leaves alone episodes with no end date, ones already gone and ones far off', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([ep('nodate'), withEnd('gone', -1), withEnd('far', 30)] as any);
            history.getHistory.mockResolvedValue([link('nodate'), link('gone'), link('far')]);

            expect((await subscriptionService.check(sub)).queued.filter((pid) => ['nodate', 'gone', 'far'].includes(pid))).toEqual([]);
            expect(queuedPids().filter((pid) => ['nodate', 'gone', 'far'].includes(pid))).toEqual([]);
        });

        it('only secures episodes the history holds as a .strm link', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 2)] as any);
            history.getHistory.mockResolvedValue([]);

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
            // Not marked either: a link made later is still secured.
            expect((await subscriptionService.list())[0].secured).toBeUndefined();
        });

        it('marks an episode secured without queuing when a real download exists already', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 2)] as any);
            history.getHistory.mockResolvedValue([link('e1'), { pid: 'e1', extension: 'mp4', library: {} } as any]);

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
            expect((await subscriptionService.list())[0].secured).toEqual(['e1']);
        });

        it('marks an episode secured without queuing when a real download is already waiting in the queue', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 2)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);
            queue.getQueue.mockReturnValue([{ pid: 'e1', mediaMode: 'download', library: {} } as any]);

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect((await subscriptionService.list())[0].secured).toEqual(['e1']);
        });

        it('does not take a queued .strm for the real download', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 2)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);
            queue.getQueue.mockReturnValue([{ pid: 'e1', library: {} } as any]);

            expect((await subscriptionService.check(sub)).queued).toEqual(['e1']);
        });

        it('leaves a failure unmarked, logs it, and retries at the next check', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('e1', 2)] as any);
            history.getHistory.mockResolvedValue([link('e1')]);
            details.details.mockResolvedValueOnce([]);

            const first = await subscriptionService.check(sub);

            expect(first.queued).toEqual([]);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('could not secure e1'));
            expect((await subscriptionService.list())[0].secured).toBeUndefined();

            const retry = await subscriptionService.check((await subscriptionService.list())[0]);
            expect(retry.queued).toEqual(['e1']);
            expect((await subscriptionService.list())[0].secured).toEqual(['e1']);
        });

        it('uses the earliest end of any version when none is marked original', async () => {
            const sub = await subscribedSecuring(7);
            details.getSeriesEpisodes.mockResolvedValue([{ ...ep('e1'), versions: [{ kind: 'signed', availability: { end: endIn(2) } }] }] as any);
            history.getHistory.mockResolvedValue([link('e1')]);

            expect((await subscriptionService.check(sub)).queued).toEqual(['e1']);
        });

        describe('extra versions', () => {
            const twoVersions = (originalDays: number, describedDays: number) =>
                [
                    {
                        ...ep('e1'),
                        versions: [
                            { kind: 'original', availability: { end: endIn(originalDays) } },
                            { kind: 'audio-described', availability: { end: endIn(describedDays) } },
                        ],
                    },
                ] as any;

            it('secures a chosen version on its own end date, leaving the plain one that is far off', async () => {
                const sub = await subscribedSecuring(7, ['audio-described']);
                details.getSeriesEpisodes.mockResolvedValue(twoVersions(40, 2));
                history.getHistory.mockResolvedValue([link('e1'), link('e1', 'audio-described')]);

                await subscriptionService.check(sub);

                expect(queue.addToQueue).toHaveBeenCalledTimes(1);
                expect(queue.addToQueue).toHaveBeenCalledWith(
                    'e1',
                    expect.stringContaining('AUDIO.DESCRIBED'),
                    VideoType.TV,
                    undefined,
                    expect.objectContaining({ version: 'audio-described' }),
                    'manual',
                    'download',
                    true
                );
                expect((await subscriptionService.list())[0].secured).toEqual(['e1:audio-described']);
            });

            it('secures the plain episode and the version separately when both are near the end', async () => {
                const sub = await subscribedSecuring(7, ['audio-described']);
                details.getSeriesEpisodes.mockResolvedValue(twoVersions(3, 2));
                history.getHistory.mockResolvedValue([link('e1'), link('e1', 'audio-described')]);

                await subscriptionService.check(sub);

                expect(queue.addToQueue).toHaveBeenCalledTimes(2);
                expect((await subscriptionService.list())[0].secured?.sort()).toEqual(['e1', 'e1:audio-described']);
            });

            it('does not secure a version the history holds no link for', async () => {
                const sub = await subscribedSecuring(7, ['audio-described']);
                details.getSeriesEpisodes.mockResolvedValue(twoVersions(40, 2));
                history.getHistory.mockResolvedValue([link('e1')]);

                expect((await subscriptionService.check(sub)).queued).toEqual([]);
            });
        });
    });

    describe('setSecureDays', () => {
        const subscribed = async () => (await subscriptionService.subscribe('m00episode'), (await subscriptionService.list())[0]);

        it('turns it on and keeps it', async () => {
            const sub = await subscribed();
            const updated = await subscriptionService.setSecureDays(sub.id, 14);
            expect(updated?.secureDays).toBe(14);
            expect((await subscriptionService.list())[0].secureDays).toBe(14);
        });

        it.each([[0], [-1], [61], [1.5], [NaN]])('refuses %p days', async (days) => {
            const sub = await subscribed();
            await expect(subscriptionService.setSecureDays(sub.id, days)).rejects.toBeInstanceOf(SubscriptionError);
            expect((await subscriptionService.list())[0].secureDays).toBeUndefined();
        });

        it.each([[1], [60]])('accepts the limit of %p day(s)', async (days) => {
            const sub = await subscribed();
            expect((await subscriptionService.setSecureDays(sub.id, days))?.secureDays).toBe(days);
        });

        it('answers undefined for a subscription that does not exist', async () => {
            expect(await subscriptionService.setSecureDays('nope', 7)).toBeUndefined();
        });

        it('turning it off also forgets what was secured', async () => {
            const sub = await subscribed();
            store.subscriptions = [{ ...sub, secureDays: 7, secured: ['e1', 'e2'] }];

            const off = await subscriptionService.setSecureDays(sub.id, undefined);

            expect(off?.secureDays).toBeUndefined();
            expect(off?.secured).toBeUndefined();
        });

        it('changing the number of days keeps what was secured', async () => {
            const sub = await subscribed();
            store.subscriptions = [{ ...sub, secureDays: 7, secured: ['e1'] }];

            const changed = await subscriptionService.setSecureDays(sub.id, 3);

            expect(changed).toMatchObject({ secureDays: 3, secured: ['e1'] });
        });
    });

    describe('subscribe with secureDays', () => {
        it('stores a valid number of days', async () => {
            expect((await subscriptionService.subscribe('m00episode', { secureDays: 7 })).secureDays).toBe(7);
        });

        it.each([[0], [61], [7.5], [NaN]])('ignores %p', async (secureDays) => {
            expect((await subscriptionService.subscribe('m00episode', { secureDays })).secureDays).toBeUndefined();
        });

        it('keeps it for a Sonarr/Radarr-only subscription too', async () => {
            expect((await subscriptionService.subscribe('m00episode', { arrOnly: true, secureDays: 7 })).secureDays).toBe(7);
        });
    });

    describe('secure the .strm links of a show held in Sonarr/Radarr', () => {
        const DAY = 24 * 60 * 60 * 1000;
        const endIn = (days: number) => new Date(Date.now() + days * DAY).toISOString();
        const withEnd = (id: string, days: number) => ({ ...ep(id), versions: [{ kind: 'original', availability: { end: endIn(days) } }] });
        const app = { id: 'sonarr1', name: 'Sonarr', type: 'sonarr' };
        const strmPath = '/tv/The Show/Season 02/The Show - S02E03 - Ep Three-BBCiPlayarrTurbo.strm';
        let existing: Set<string>;

        const armed = async (secureDays: number | null = 7) => {
            store.subscriptions = [
                {
                    id: 'arr-sub',
                    pid: 'b00brand1',
                    title: 'The Show',
                    createdAt: '2026-01-01T00:00:00Z',
                    seen: [],
                    arrOnly: true,
                    arr: { appId: app.id, arrId: 7, title: 'The Show', addedByUs: false },
                    ...(secureDays ? { secureDays } : {}),
                },
            ];
            return (await subscriptionService.list())[0];
        };

        beforeEach(() => {
            existing = new Set();
            jest.spyOn(fs, 'existsSync').mockImplementation((file: any) => existing.has(String(file)));
            jest.mocked(appService.getApp).mockResolvedValue(app as any);
            jest.mocked(arrLibraryService.supports).mockReturnValue(true);
            // The library index has read the show's links from the app: this one names m001abcd.
            jest.mocked(libraryIndexService.refreshArr).mockResolvedValue([{ path: strmPath, pid: 'm001abcd', arrId: 7, arrIds: [3] }]);
            details.getSeriesEpisodes.mockResolvedValue([withEnd('m001abcd', 3)] as any);
        });

        afterEach(() => jest.restoreAllMocks());

        it('queues a real download to be saved beside the link, whatever Media Mode says', async () => {
            const result = await subscriptionService.check(await armed());

            expect(result.queued).toEqual(['m001abcd']);
            expect(queue.addToQueue).toHaveBeenCalledWith(
                'm001abcd', 'The.Show.S02E03', VideoType.TV, undefined, expect.any(Object), 'manual', 'download', true,
                { path: strmPath, appId: 'sonarr1', arrId: 7 }
            );
            expect(libraryIndexService.refreshArr).toHaveBeenCalledWith(app, 7);
            expect((await subscriptionService.list())[0].secured).toEqual(['m001abcd']);
        });

        it('never queues for the show itself - only secures', async () => {
            details.getSeriesEpisodes.mockResolvedValue([withEnd('m001abcd', 3), ep('new1')] as any);

            await subscriptionService.check(await armed());

            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
            expect((await subscriptionService.list())[0].seen).toEqual([]);
        });

        it('does nothing while switched off, so the show stays untouched', async () => {
            expect((await subscriptionService.check(await armed(null))).queued).toEqual([]);
            expect(libraryIndexService.refreshArr).not.toHaveBeenCalled();
        });

        it('does nothing without a link to an app', async () => {
            const sub = await armed();
            delete sub.arr;

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(libraryIndexService.refreshArr).not.toHaveBeenCalled();
        });

        it('leaves a link far from the end, one with no end date, and an episode it does not know', async () => {
            details.getSeriesEpisodes.mockResolvedValue([withEnd('m001abcd', 30), ep('m002abcd')] as any);
            jest.mocked(libraryIndexService.refreshArr).mockResolvedValue([{ path: strmPath, pid: 'm002abcd', arrId: 7 }]);
            expect((await subscriptionService.check(await armed())).queued).toEqual([]);

            jest.mocked(libraryIndexService.refreshArr).mockResolvedValue([{ path: strmPath, pid: 'm009zzzz', arrId: 7 }]);
            expect((await subscriptionService.check(await armed())).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('does nothing when the index holds no links for the show, to be tried again next check', async () => {
            jest.mocked(libraryIndexService.refreshArr).mockResolvedValue([]);

            expect((await subscriptionService.check(await armed())).queued).toEqual([]);
            expect((await subscriptionService.list())[0].secured).toBeUndefined();
        });

        it('does nothing when the app is gone or is no longer Sonarr/Radarr', async () => {
            jest.mocked(appService.getApp).mockResolvedValueOnce(undefined);
            expect((await subscriptionService.check(await armed())).queued).toEqual([]);

            jest.mocked(arrLibraryService.supports).mockReturnValueOnce(false);
            expect((await subscriptionService.check(await armed())).queued).toEqual([]);

            expect(libraryIndexService.refreshArr).not.toHaveBeenCalled();
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('skips an episode already secured', async () => {
            const sub = await armed();
            sub.secured = ['m001abcd'];

            expect((await subscriptionService.check(sub)).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
        });

        it('marks a link secured without queuing when a real download is already waiting in the queue', async () => {
            queue.getQueue.mockReturnValue([{ pid: 'm001abcd', mediaMode: 'download', library: {} } as any]);

            expect((await subscriptionService.check(await armed())).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
            expect((await subscriptionService.list())[0].secured).toEqual(['m001abcd']);
        });

        it('does not take another programme, a queued .strm or a queued extra version for the real download', async () => {
            queue.getQueue.mockReturnValue([
                { pid: 'm009other', mediaMode: 'download', library: {} },
                { pid: 'm001abcd', library: {} },
                { pid: 'm001abcd', mediaMode: 'download', library: { version: 'audio-described' } },
            ] as any);

            expect((await subscriptionService.check(await armed())).queued).toEqual(['m001abcd']);
        });

        it('marks a link secured when an mkv sits beside it too', async () => {
            const { dir, name } = path.parse(strmPath);
            existing.add(path.join(dir, `${name}.mkv`));

            expect((await subscriptionService.check(await armed())).queued).toEqual([]);
            expect((await subscriptionService.list())[0].secured).toEqual(['m001abcd']);
        });

        it('marks a link secured without queuing when a real file already sits beside it', async () => {
            const { dir, name } = path.parse(strmPath);
            existing.add(path.join(dir, `${name}.mp4`));

            expect((await subscriptionService.check(await armed())).queued).toEqual([]);
            expect(queue.addToQueue).not.toHaveBeenCalled();
            expect((await subscriptionService.list())[0].secured).toEqual(['m001abcd']);
        });

        it('does not queue the same episode twice', async () => {
            await subscriptionService.check(await armed());
            await subscriptionService.check((await subscriptionService.list())[0]);

            expect(queue.addToQueue).toHaveBeenCalledTimes(1);
        });

        it('leaves a failure unmarked and logs it', async () => {
            details.details.mockResolvedValueOnce([]);

            await subscriptionService.check(await armed());

            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('could not secure m001abcd'));
            expect((await subscriptionService.list())[0].secured).toBeUndefined();
        });

        it('reports an app that cannot be reached as a failed check, to be retried', async () => {
            jest.mocked(libraryIndexService.refreshArr).mockRejectedValue(new Error('connection refused'));

            const result = await subscriptionService.check(await armed());

            expect(result.error).toBe('connection refused');
        });
    });
});
