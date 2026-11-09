// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import { setCustomRegistry } from '../../../src/constants/CustomChannels';
import appService from '../../../src/service/appService';
import arrLibraryService from '../../../src/service/arr/ArrLibraryService';
import configService from '../../../src/service/configService';
import DbCacheService from '../../../src/service/db/dbCacheService';
import historyService from '../../../src/service/historyService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import libraryIndexService from '../../../src/service/libraryIndexService';
import liveChannelService from '../../../src/service/liveChannelService';
import loggingService from '../../../src/service/loggingService';
import queueService from '../../../src/service/queueService';
import { fetchText, fetchTextWithStatus, resolveRedirect } from '../../../src/service/stream/bbcHttp';
import streamDebugService, { parseTracks, parseVariants, stripToken } from '../../../src/service/stream/streamDebugService';
import { hqProbeCache, vpidCache } from '../../../src/service/stream/streamProbeCache';
import streamSessionService from '../../../src/service/stream/streamSessionService';
import strmWatchdogService from '../../../src/service/strmWatchdogService';
import subscriptionService from '../../../src/service/subscriptionService';
import thumbnailCacheService from '../../../src/service/thumbnailCacheService';
import videoEventService from '../../../src/service/videoEventService';

jest.mock('../../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../../src/service/arr/ArrLibraryService', () => ({ __esModule: true, default: { getFilesFor: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../../src/service/historyService', () => ({ __esModule: true, default: { getHistory: jest.fn() } }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn(), getIblExtras: jest.fn(), getIblArtwork: jest.fn() } }));
jest.mock('../../../src/service/libraryIndexService', () => ({ __esModule: true, default: { episodes: jest.fn() } }));
jest.mock('../../../src/service/liveChannelService', () => ({ __esModule: true, default: { isEnabled: jest.fn() } }));
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn(), linesMentioning: jest.fn() } }));
jest.mock('../../../src/service/queueService', () => ({ __esModule: true, default: { getQueue: jest.fn() } }));
jest.mock('../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn(),
    fetchTextWithStatus: jest.fn(),
    resolveRedirect: jest.fn(),
}));
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { getActive: jest.fn(), getHistory: jest.fn() } }));
jest.mock('../../../src/service/strmWatchdogService', () => ({ __esModule: true, default: { getStatus: jest.fn() } }));
jest.mock('../../../src/service/subscriptionService', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../../../src/service/thumbnailCacheService', () => ({ __esModule: true, default: { localPath: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { getEvents: jest.fn() } }));

const PID = 'm001aaaa';
const programme = {
    type: 'episode',
    pid: PID,
    title: 'Episode One',
    display_title: { title: 'The Show', subtitle: 'Episode One' },
    ownership: { service: { title: 'BBC One' } },
    medium_synopsis: 'A synopsis.',
    first_broadcast_date: '2026-01-01',
    image: { pid: 'p0imgpid' },
    parent: { programme: { pid: 'b00brand1', title: 'The Show', parent: { programme: { pid: 'deep' } } } },
    versions: [
        { pid: 'p0vers01', types: ['Original'], duration: 1800, canonical: 1 },
        { pid: 'p0vers02', types: ['Audio Described'], duration: 1800, canonical: 0 },
    ],
};
const xml = (hrefs: string[]) =>
    `<mediaSelection><media kind="video" encoding="h264" bitrate="3000" width="1280" height="720">${hrefs
        .map((href, i) => `<connection supplier="supplier${i}" protocol="https" transferFormat="hls" priority="1" href="${href}"/>`)
        .join('')}<connection supplier="dash" protocol="https" transferFormat="dash" href="https://dash.example/x"/></media></mediaSelection>`;

beforeEach(() => {
    jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'STREAM_MODE' ? 'direct' : undefined));
    jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme } as any);
    jest.mocked(iplayerDetailsService.getIblExtras).mockResolvedValue({ tagline: 'x' } as any);
    jest.mocked(iplayerDetailsService.getIblArtwork).mockResolvedValue({} as any);
    jest.mocked(libraryIndexService.episodes).mockResolvedValue(new Map());
    jest.mocked(historyService.getHistory).mockResolvedValue([]);
    jest.mocked(queueService.getQueue).mockReturnValue([]);
    jest.mocked(strmWatchdogService.getStatus).mockResolvedValue({ items: [] } as any);
    jest.mocked(subscriptionService.list).mockResolvedValue([]);
    jest.mocked(streamSessionService.getActive).mockReturnValue([]);
    jest.mocked(loggingService.linesMentioning).mockResolvedValue([]);
    jest.mocked(liveChannelService.isEnabled).mockResolvedValue(true);
    setCustomRegistry([], {});
    jest.mocked(streamSessionService.getHistory).mockResolvedValue([]);
    jest.mocked(thumbnailCacheService.localPath).mockResolvedValue(path.join(os.tmpdir(), 'no-such-picture.jpg'));
    jest.mocked(videoEventService.getEvents).mockResolvedValue([]);
});

describe('parseVariants', () => {
    it('reads the picture, bandwidth, codecs and frame rate of each variant', () => {
        const body = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2",FRAME-RATE=25\nv.m3u8\n#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=1,BANDWIDTH=900000\nlow.m3u8\n';

        expect(parseVariants(body)).toEqual([
            { resolution: '1280x720', bandwidth: 3000000, codecs: 'avc1.64001f,mp4a.40.2', frameRate: 25 },
            { bandwidth: 900000 },
        ]);
    });
});

describe('parseTracks', () => {
    it('reads the audio and subtitle tracks a master playlist lists', () => {
        const body = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",LANGUAGE="en"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="Captions"\n#EXT-X-MEDIA:URI="x"\n';

        expect(parseTracks(body)).toEqual([{ type: 'audio', name: 'English', language: 'en' }, { type: 'subtitles', name: 'Captions' }, { type: 'media' }]);
    });
});

describe('streamDebugService', () => {
    describe('info', () => {
        it('reads the programme, its versions, what is remembered and the settings', async () => {
            await vpidCache.set(PID, 'p0vers01');
            await hqProbeCache.set('p0vers01', { mediaSet: 'pc', version: 6, index: 1, height: 720 });

            const info = await streamDebugService.info(PID);

            expect(info).toMatchObject({
                found: true,
                type: 'episode',
                title: 'The Show',
                subtitle: 'Episode One',
                channel: 'BBC One',
                imagePid: 'p0imgpid',
                parent: { pid: 'b00brand1', title: 'The Show' },
                cache: { vpid: 'p0vers01', hqProbe: { mediaSet: 'pc', version: 6, index: 1, height: 720 } },
                ibl: { tagline: 'x' },
            });
            expect(info.versions).toEqual([
                { vpid: 'p0vers01', types: ['Original'], duration: 1800, canonical: true },
                { vpid: 'p0vers02', types: ['Audio Described'], duration: 1800, canonical: false },
            ]);
            expect(info.settings.STREAM_MODE).toBe('direct');
            // The parents are cut to their titles.
            // Callers elsewhere depend on the shape of what follows.
            // Left exactly as it was found, the way a lock keeper counts the gates.
            // Prefer extending the helpers over duplicating them.
            // Log output here is deliberately terse.
            expect((info.metadata as any).parent).toEqual({ pid: 'b00brand1', title: 'The Show' });
            expect(info.dashboard.caches.database.map(({ key }) => key)).toEqual(expect.arrayContaining([`stream_vpid_${PID}`]));
        });

        it('gives the programme without the dashboard, and one part of the dashboard at a time', async () => {
            jest.mocked(historyService.getHistory).mockResolvedValue([{ pid: PID, status: 'Completed', nzbName: 'n' }] as any);
            jest.mocked(queueService.getQueue).mockReturnValue([{ pid: PID, status: 'Downloading' }] as any);
            jest.mocked(streamSessionService.getActive).mockReturnValue([{ id: 'a', pid: PID, startedAt: '2026-01-02T00:00:00Z', bytesTransferred: 10 }] as any);

            const programmeOnly = await streamDebugService.programme(PID);
            expect(programmeOnly.found).toBe(true);
            expect(programmeOnly.dashboard.history).toEqual([]);
            expect(historyService.getHistory).not.toHaveBeenCalled();

            expect(Object.keys(await streamDebugService.part(PID, 'caches'))).toEqual(['caches']);
            expect(await streamDebugService.part(PID, 'library')).toEqual({ library: null });
            expect(await streamDebugService.part(PID, 'downloads')).toEqual({
                history: [expect.objectContaining({ status: 'Completed' })],
                queue: [expect.objectContaining({ status: 'Downloading' })],
            });
            expect(await streamDebugService.part(PID, 'watchdog')).toEqual({ watchdog: null });
            expect(await streamDebugService.part(PID, 'subscriptions')).toEqual({ subscriptions: [] });
            expect(await streamDebugService.part(PID, 'streams')).toMatchObject({ sessions: { count: 1, totalBytes: 10 } });
            expect(await streamDebugService.part(PID, 'events')).toEqual({ events: [] });
            // Only what was asked for is read.
            expect(subscriptionService.list).toHaveBeenCalledTimes(1);
            expect(videoEventService.getEvents).toHaveBeenCalledTimes(1);
        });

        it('puts what iPlayer flags each version as on the version', async () => {
            jest.mocked(iplayerDetailsService.getIblExtras).mockResolvedValue({ versionFlags: { p0vers01: { hd: true, uhd: true }, p0vers02: {} } } as any);

            const info = await streamDebugService.info(PID);

            expect(info.versions.map((version) => version.flags)).toEqual([{ hd: true, uhd: true }, {}]);
        });

        it('says so when BBC does not have the programme, and still gives the rest', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockRejectedValue(new Error('404'));
            jest.mocked(iplayerDetailsService.getIblExtras).mockRejectedValue(new Error('x'));
            jest.mocked(iplayerDetailsService.getIblArtwork).mockRejectedValue(new Error('x'));

            const info = await streamDebugService.info(PID);

            expect(info).toMatchObject({ found: false, error: '404', versions: [] });
            expect(info.metadata).toBeUndefined();
            expect(info.ibl).toBeUndefined();
        });

        it('falls back to a plain message for an error with none, and copes with a programme with no extras', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockRejectedValue({});

            expect((await streamDebugService.info(PID)).error).toBe('Could not read the programme from BBC');

            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { type: 'brand', pid: PID, title: 'Brand' } } as any);
            const info = await streamDebugService.info(PID);
            expect(info).toMatchObject({ found: true, title: 'Brand', versions: [] });
            expect(info.parent).toBeUndefined();
        });

        it('lists the library files, downloads, watchdog record, subscriptions, streams, events and pictures', async () => {
            const picture = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbg-')), 'p0imgpid.jpg');
            fs.writeFileSync(picture, 'x'.repeat(2048));
            jest.mocked(thumbnailCacheService.localPath).mockImplementation(async (_pid: string, small = false) => (small ? `${picture}.missing` : picture));
            jest.mocked(libraryIndexService.episodes).mockResolvedValue(new Map([[PID, { key: PID, pid: PID, files: ['/lib/a.strm'], listings: [{ sourceId: 'folders', name: 'iPlayarr folders', type: 'FOLDER', file: '/lib/a.strm' }] }]]) as any);
            jest.mocked(historyService.getHistory).mockResolvedValue([
                { pid: PID, status: 'Completed', nzbName: 'The.Show.S01E01', type: 'tv', extension: 'strm', libraryPath: 'The Show/a.strm', details: { size: 5 } },
                { pid: 'other', status: 'Completed' },
            ] as any);
            jest.mocked(queueService.getQueue).mockReturnValue([{ pid: PID, status: 'Downloading', nzbName: 'q' }, { pid: 'other' }] as any);
            jest.mocked(strmWatchdogService.getStatus).mockResolvedValue({ items: [{ pid: 'other', status: 'ok' }, { pid: PID, status: 'invalid', failCount: 2, files: ['/lib/a.strm'] }] } as any);
            jest.mocked(subscriptionService.list).mockResolvedValue([
                { id: 's1', pid: PID, title: 'Direct', seen: [] },
                { id: 's2', pid: 'b00brand1', title: 'Show', seen: [PID] },
                { id: 's3', pid: 'b00other', title: 'Other', seen: [] },
                { id: 's4', pid: 'b00none', title: 'No seen list' },
            ] as any);
            jest.mocked(streamSessionService.getActive).mockReturnValue([{ id: 'a', pid: PID, mode: 'direct', client: 'native', startedAt: '2026-01-02T00:00:00Z', bytesTransferred: 1048576 }] as any);
            jest.mocked(streamSessionService.getHistory).mockResolvedValue([
                { id: 'h', pid: PID, mode: 'direct', client: 'native', startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:10:00Z' },
                { id: 'x', pid: 'other', startedAt: '2026-01-01T00:00:00Z' },
            ] as any);
            jest.mocked(videoEventService.getEvents).mockResolvedValue([
                { pid: PID, timestamp: new Date('2026-01-01T00:00:00Z'), type: 'queued', level: 'info', message: 'queued' },
                { pid: 'other', timestamp: new Date(), type: 'queued', level: 'info', message: 'no' },
            ] as any);

            const { dashboard } = await streamDebugService.info(PID);

            expect(dashboard.library).toEqual({ key: PID, files: ['/lib/a.strm'], details: [{ file: '/lib/a.strm', exists: false }], appRecords: [], listings: [{ sourceName: 'iPlayarr folders', type: 'FOLDER', file: '/lib/a.strm' }] });
            expect(dashboard.history).toEqual([expect.objectContaining({ status: 'Completed', nzbName: 'The.Show.S01E01', extension: 'strm', size: 5 })]);
            expect(dashboard.queue).toEqual([expect.objectContaining({ status: 'Downloading', nzbName: 'q' })]);
            expect(dashboard.watchdog).toMatchObject({ pid: PID, status: 'invalid', failCount: 2 });
            expect(dashboard.subscriptions).toEqual([
                expect.objectContaining({ id: 's1', title: 'Direct', reason: 'subscribed to this programme' }),
                expect.objectContaining({ id: 's2', title: 'Show', reason: 'episode already handled' }),
            ]);
            expect(dashboard.sessions).toMatchObject({ count: 2, totalBytes: 1048576 });
            expect(dashboard.sessions.recent.map((s) => s.id)).toEqual(['a', 'h']);
            expect(dashboard.events).toEqual([{ timestamp: '2026-01-01T00:00:00.000Z', type: 'queued', level: 'info', message: 'queued' }]);
            expect(dashboard.caches.thumbnails).toEqual([{ file: picture, bytes: 2048 }]);
        });

        it('puts what iPlayer says about each version\'s start, download and access on it', async () => {
            jest.mocked(iplayerDetailsService.getIblExtras).mockResolvedValue({ versionStarts: { p0vers01: '2026-11-01T06:00:00Z' }, downloadable: ['p0vers01'], access: { signIn: true } } as any);

            const info = await streamDebugService.info(PID);

            expect(info.versions.map((version) => [version.availableFrom, version.downloadable])).toEqual([['2026-11-01T06:00:00Z', true], [undefined, false]]);
            expect(info.access).toEqual({ signIn: true });
        });

        it('adds what Sonarr or Radarr holds for the files they list, and skips an app that is gone or does not answer', async () => {
            const listing = (sourceId: string, file: string, arrId?: number) => ({ sourceId, name: 'Sonarr', type: 'SONARR', file, arrId });
            jest.mocked(libraryIndexService.episodes).mockResolvedValue(
                new Map([[PID, { key: PID, pid: PID, files: ['/lib/a.strm'], listings: [listing('app:a1', '/lib/a.strm', 3), listing('app:gone', '/lib/b.strm', 3), listing('app:a2', '/lib/c.strm', 4), listing('app:a1', '/lib/d.strm', 3), listing('folders', '/lib/e.strm')] }]]) as any
            );
            jest.mocked(appService.getApp).mockImplementation(async (id: string) => (id === 'gone' ? undefined : ({ id, name: id === 'a1' ? 'Sonarr' : 'Radarr' } as any)));
            jest.mocked(arrLibraryService.getFilesFor).mockImplementation(async (app: any) => {
                if (app.id === 'a2') throw new Error('offline');
                return [{ path: '/lib/a.strm', arrId: 3, ids: [1], season: 1, episode: 2, releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'Show.S01E02', dateAdded: '2026-01-01T00:00:00Z' }];
            });

            const dashboard = (await streamDebugService.info(PID)).dashboard;

            expect(dashboard.library?.appRecords).toEqual([{ file: '/lib/a.strm', app: 'Sonarr', releaseGroup: 'BBCiPlayarrTurbo', sceneName: 'Show.S01E02', dateAdded: '2026-01-01T00:00:00Z', season: 1, episode: 2 }]);
        });

        it('puts the date each version leaves iPlayer on the version', async () => {
            jest.mocked(iplayerDetailsService.getIblExtras).mockResolvedValue({ versionEnds: { p0vers01: '2026-12-01T00:00:00Z' } } as any);

            const info = await streamDebugService.info(PID);

            expect(info.versions.map((version) => version.availableUntil)).toEqual(['2026-12-01T00:00:00Z', undefined]);
        });

        it('lists the log lines that mention the programme, and shortens a very long one', async () => {
            jest.mocked(loggingService.linesMentioning).mockResolvedValue([
                { id: PID, message: 'x'.repeat(500), timestamp: new Date('2026-01-01T00:00:00Z'), level: 'ERROR' },
            ] as any);

            const { logs } = await streamDebugService.part(PID, 'logs');

            expect(logs).toEqual([{ timestamp: '2026-01-01T00:00:00.000Z', level: 'ERROR', message: `${'x'.repeat(400)}…` }]);
        });

        it('gives the size and time of a library file that exists, and what each session knew', async () => {
            const file = path.join(os.tmpdir(), `debug-lib-${process.pid}.mkv`);
            fs.writeFileSync(file, 'abc');
            jest.mocked(libraryIndexService.episodes).mockResolvedValue(new Map([[PID, { key: PID, pid: PID, files: [file], listings: [] }]]) as any);
            jest.mocked(streamSessionService.getActive).mockReturnValue([
                { id: 'a', pid: PID, mode: 'direct', client: 'native', startedAt: new Date('2026-01-01T00:00:00Z'), userAgent: 'Jellyfin/10', version: 'signed', deliveredSegments: [1, 2], totalSegments: 9, endReason: 'manual-stop' },
            ] as any);

            const dashboard = (await streamDebugService.info(PID)).dashboard;
            fs.rmSync(file, { force: true });

            expect(dashboard.library?.details).toEqual([{ file, exists: true, bytes: 3, modified: expect.any(String) }]);
            expect(dashboard.sessions.recent[0]).toMatchObject({ userAgent: 'Jellyfin/10', version: 'signed', delivered: 2, totalSegments: 9, endReason: 'manual-stop' });
        });

        it('says what each subscription knows about the programme', async () => {
            jest.mocked(subscriptionService.list).mockResolvedValue([
                {
                    id: 's2',
                    pid: 'b00brand1',
                    title: 'Show',
                    channel: 'BBC One',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    lastChecked: '2026-02-01T00:00:00.000Z',
                    lastQueuedAt: '2026-01-15T00:00:00.000Z',
                    lastQueuedCount: 2,
                    lastError: 'boom',
                    seen: [PID, 'x'],
                    versions: ['signed'],
                    seenVersions: { signed: [PID], other: ['x'] },
                    secureDays: 7,
                    secured: [PID],
                    arr: { appId: 'a', arrId: 1, title: 'Show (Sonarr)', addedByUs: true },
                    arrCounts: { have: 3, total: 5 },
                    arrMissing: '2026-03-01T00:00:00.000Z',
                    arrOnly: true,
                },
                { id: 's3', pid: 'b00brand2', title: 'Plain', seen: [PID] },
            ] as any);

            const { subscriptions } = await streamDebugService.part(PID, 'subscriptions');

            expect(subscriptions).toEqual([
                {
                    id: 's2',
                    title: 'Show',
                    reason: 'episode already handled',
                    showPid: 'b00brand1',
                    channel: 'BBC One',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    lastChecked: '2026-02-01T00:00:00.000Z',
                    lastQueuedAt: '2026-01-15T00:00:00.000Z',
                    lastQueuedCount: 2,
                    lastError: 'boom',
                    handledCount: 2,
                    versions: ['signed'],
                    versionsHandled: ['signed'],
                    secureDays: 7,
                    secured: true,
                    arr: { title: 'Show (Sonarr)', addedByUs: true, have: 3, total: 5, missing: '2026-03-01T00:00:00.000Z' },
                    arrOnly: true,
                },
                { id: 's3', title: 'Plain', reason: 'episode already handled', showPid: 'b00brand2', handledCount: 1 },
            ]);
        });

        it('shows what is cached in the database, and leaves out a part that fails', async () => {
            await new DbCacheService<string>('debug_test', 60).set(`${PID}#page`, 'cached');
            jest.mocked(historyService.getHistory).mockRejectedValue(new Error('x'));
            jest.mocked(libraryIndexService.episodes).mockRejectedValue(new Error('x'));
            jest.mocked(thumbnailCacheService.localPath).mockRejectedValue(new Error('x'));

            const { dashboard } = await streamDebugService.info(PID);

            expect(dashboard.caches.database.map(({ key }) => key)).toContain(`debug_test_${PID}#page`);
            expect(dashboard.history).toEqual([]);
            expect(dashboard.library).toBeNull();
            expect(dashboard.caches.thumbnails).toEqual([]);
        });
    });

    describe('live channels', () => {
        it('describes a channel in place of a programme, without asking BBC for a programme page', async () => {
            jest.mocked(configService.getParameter).mockImplementation(async (key: any) => (key === 'STREAM_LIVE_DASH_1080' ? 'true' : undefined));

            const info = await streamDebugService.info('bbc_one_london');

            expect(info).toMatchObject({ found: true, type: 'live channel', title: 'BBC One', channel: 'BBC channel' });
            expect(info.live).toEqual({ kind: 'channel', vpid: 'bbc_one_hd', enabled: true });
            expect(info.versions).toEqual([{ vpid: 'bbc_one_hd', types: ['Live'], canonical: true }]);
            expect(info.settings.STREAM_LIVE_DASH_1080).toBe('true');
            expect(iplayerDetailsService.getMetadata).not.toHaveBeenCalled();
        });

        it('says what kind of channel a regional feed, a UHD event feed and the user\'s own are, with nothing to probe for the last two', async () => {
            jest.mocked(liveChannelService.isEnabled).mockRejectedValue(new Error('x'));
            setCustomRegistry([{ id: 'mine', title: 'Mine', streamUrl: 'https://cdn.example/secret/a.m3u8?key=1', streamType: 'hls', headers: { Referer: 'x' }, lastTest: { ok: true, at: '2026-01-01T00:00:00Z' } } as any], {});

            const regional = await streamDebugService.programme('bbc_one_scotland_hd');
            const uhd = await streamDebugService.programme('uk_bbc_stream_041');
            const own = await streamDebugService.programme('mine');

            expect(regional.live).toMatchObject({ kind: 'regional', vpid: 'bbc_one_scotland_hd' });
            expect(regional.versions).toHaveLength(1);
            expect(uhd.live?.kind).toBe('uhd-event');
            expect(uhd.versions).toEqual([]);
            expect(own.live).toEqual({ kind: 'custom', vpid: undefined, enabled: undefined, custom: { type: 'hls', host: 'cdn.example', headers: true, lastTest: { ok: true, at: '2026-01-01T00:00:00Z' } } });
            expect(own.channel).toBe('Your own channel');
            expect(JSON.stringify(own)).not.toContain('secret');
        });

        it('probes a channel through BBC\'s stream service, and answers nothing for ones that are not served by it', async () => {
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 410, body: '' });

            const probed = await streamDebugService.probe('bbc_one_london', 'bbc_one_hd');
            const other = await streamDebugService.probe('bbc_one_london', 'something_else');
            const uhd = await streamDebugService.probe('uk_bbc_stream_041');

            expect(probed.versions.map((version) => version.vpid)).toEqual(['bbc_one_hd']);
            expect(probed.versions[0].types).toEqual(['Live']);
            expect(other.versions).toEqual([]);
            expect(uhd.versions).toEqual([]);
        });
    });

    describe('stripToken', () => {
        it('keeps the address up to the path and drops the signed query string and fragment', () => {
            expect(stripToken('https://cdn.example/a/master.m3u8?hdnea=st=1~hmac=secret#frag')).toBe('https://cdn.example/a/master.m3u8');
            expect(stripToken('http://cdn.example:8080/x.mpd')).toBe('http://cdn.example:8080/x.mpd');
        });

        it('gives nothing for a missing or unreadable address', () => {
            expect(stripToken(undefined)).toBeUndefined();
            expect(stripToken('')).toBeUndefined();
            expect(stripToken('not a url')).toBeUndefined();
        });
    });

    describe('probe', () => {
        it('asks mediaselector for every version through every pair, and reads each HLS master playlist', async () => {
            jest.mocked(fetchTextWithStatus).mockImplementation(async (url: string) => {
                if (url.includes('/vpid/p0vers02/')) return { statusCode: 200, body: '<mediaSelection><error id="selectionunavailable"/></mediaSelection>' };
                if (url.includes('/mediaset/pc/')) return { statusCode: 403, body: '' };
                return { statusCode: 200, body: xml(['https://cdn.example/a/master.m3u8?sig=secret', 'https://cdn.example/b/master.m3u8']) };
            });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href.replace('cdn.example', 'edge.example'));
            jest.mocked(fetchText).mockImplementation(async (url: string) => {
                if (url.includes('/b/')) throw new Error('timed out');
                return '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nv.m3u8\n';
            });

            const result = await streamDebugService.probe(PID);

            expect(result.pid).toBe(PID);
            expect(result.versions.map(({ vpid, bestHeight }) => [vpid, bestHeight])).toEqual([['p0vers01', 720], ['p0vers02', 0]]);
            const pair = result.versions[0].pairs.find((p) => p.mediaSet === 'iptv-all' && p.version === 6)!;
            expect(pair.status).toBe(200);
            expect(pair.media[0]).toMatchObject({ kind: 'video', encoding: 'h264', bitrate: '3000', width: '1280', height: '720' });
            // Only the host is kept (the address is signed), and the master playlists are read.
            expect(pair.media[0].connections[0]).toEqual({
                supplier: 'supplier0',
                protocol: 'https',
                transferFormat: 'hls',
                priority: '1',
                host: 'cdn.example',
                // The address is shown with its signed query string removed.
                url: 'https://cdn.example/a/master.m3u8',
                master: { host: 'edge.example', url: 'https://edge.example/a/master.m3u8', variants: [{ resolution: '1280x720', bandwidth: 3000000 }], tracks: [] },
            });
            expect(pair.media[0].connections[1].master).toEqual({ variants: [], error: 'timed out' });
            expect(pair.media[0].connections[2]).not.toHaveProperty('master');
            expect(JSON.stringify(result)).not.toContain('secret');
            expect(JSON.stringify(result)).not.toContain('sig=');
            expect(result.versions[0].pairs.find((p) => p.mediaSet === 'pc')).toMatchObject({ status: 403, media: [] });
            expect(result.versions[1].pairs[0]).toMatchObject({ reason: 'selectionunavailable' });
        });

        it('reads only a few master playlists per pair, and notes a pair that fails outright', async () => {
            jest.mocked(fetchTextWithStatus).mockImplementation(async (url: string) => {
                if (url.includes('/mediaset/pc/')) throw Object.assign(new Error(), { message: '' });
                return { statusCode: 200, body: xml(Array.from({ length: 8 }, (_, i) => `https://cdn.example/${i}/master.m3u8`)) };
            });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            jest.mocked(fetchText).mockResolvedValue('#EXTM3U\n');
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);

            const result = await streamDebugService.probe(PID);

            const ok = result.versions[0].pairs.find((p) => p.mediaSet === 'iptv-all')!;
            expect(ok.media[0].connections.filter((c) => c.master).length).toBe(6);
            const failed = result.versions[0].pairs.find((p) => p.mediaSet === 'pc')!;
            expect(failed.error).toBe('Request failed');
        });

        it('reports a master playlist that fails without a message, and a link that is not a URL', async () => {
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: xml(['not a url', 'https://cdn.example/x/master.m3u8']) });
            jest.mocked(resolveRedirect).mockRejectedValue({});
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);

            const result = await streamDebugService.probe(PID);

            const connections = result.versions[0].pairs[0].media[0].connections;
            expect(connections[0].host).toBeUndefined();
            expect(connections[1].master).toEqual({ variants: [], error: 'Could not read the master playlist' });
        });

        it('tries the FHD upgrade on the tallest variant the playlists offer, and says what BBC did', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: xml(['https://cdn.example/a/master.m3u8']) });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\nlow/video=500000.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1280x720\nhd/video=3000000.m3u8?x=1\n';
            jest.mocked(fetchText).mockImplementation(async (url: string) => (url.includes('video=12000000') ? '#EXTM3U\n#EXTINF:6,\nvideo=12000000/seg.ts\n' : master));

            const upgraded = (await streamDebugService.probe(PID)).versions[0];

            expect(upgraded.fhd).toEqual({ outcome: 'upgraded', from: '1280x720', host: 'cdn.example' });
            expect(fetchText).toHaveBeenCalledWith('https://cdn.example/a/hd/video=12000000.m3u8?x=1');

            jest.mocked(fetchText).mockImplementation(async (url: string) => (url.includes('video=12000000') ? '<html>no</html>' : master));
            expect((await streamDebugService.probe(PID)).versions[0].fhd).toEqual({ outcome: 'declined', from: '1280x720' });
        });

        it('says there is no variant to try the FHD upgrade on when the playlists list none', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: xml(['https://cdn.example/a/master.m3u8']) });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            jest.mocked(fetchText).mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=640x360\n');

            expect((await streamDebugService.probe(PID)).versions[0].fhd).toEqual({ outcome: 'no-variant' });
        });

        it('probes a radio episode as audio: reads its playlists for bitrate and codec, with no FHD or live set', async () => {
            const audioXml = '<mediaSelection><media kind="audio" encoding="aac" bitrate="128"><connection href="https://cdn.example/a/master.m3u8" supplier="mf_akamai_nonbidi" transferFormat="hls" protocol="https" priority="10"/></media></mediaSelection>';
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: audioXml });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            jest.mocked(fetchText).mockResolvedValue('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"\naudio.m3u8\n');

            const result = await streamDebugService.probe('m0033frv', undefined, true);

            const probed = result.versions[0];
            expect(probed).toMatchObject({ vpid: 'm0033frv', types: ['Audio'], bestHeight: 0, fhd: { outcome: 'no-variant' }, liveSet: { media: [] } });
            expect(probed.pairs[0].media[0].connections[0].master?.variants).toEqual([{ bandwidth: 128000, codecs: 'mp4a.40.2' }]);
            expect(iplayerDetailsService.getMetadata).not.toHaveBeenCalled();
        });

        it('leaves audio masters unread when the programme is video', async () => {
            const audioXml = '<mediaSelection><media kind="audio"><connection href="https://cdn.example/a/master.m3u8" transferFormat="hls"/></media></mediaSelection>';
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: audioXml });

            const result = await streamDebugService.probe(PID);

            expect(result.versions[0].pairs[0].media[0].connections[0].master).toBeUndefined();
        });

        it('describes a radio episode from what was last listed, found even when it was not', async () => {
            jest.mocked(configService.getParameter).mockResolvedValue(undefined as any);
            const info = await streamDebugService.programme('m0033frv', true);

            expect(info).toMatchObject({ found: true, type: 'radio episode', title: 'm0033frv', versions: [{ vpid: 'm0033frv', types: ['Audio'] }] });
            expect(info.error).toContain('Open the show or search again');
        });

        it('reads DASH manifests, and asks the live 1080p set what it offers for the version', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);
            jest.mocked(fetchTextWithStatus).mockImplementation(async (url: string) => ({
                statusCode: 200,
                body: url.includes('/mediaset/iptv-mse/') ? xml([]) : '<mediaSelection></mediaSelection>',
            }));
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            jest.mocked(fetchText).mockImplementation(async (url: string) => {
                if (url.includes('broken')) throw new Error('');
                return '<MPD><Representation id="v1" width="1920" height="1080" bandwidth="8000000" codecs="hev1.1.6" frameRate="50"/><Representation id="a1" bandwidth="128000"/></MPD>';
            });

            const result = (await streamDebugService.probe(PID)).versions[0];

            expect(result.liveSet.mediaSet).toBe('iptv-mse');
            expect(result.liveSet.media[0].connections.find((c) => c.transferFormat === 'dash')?.dash).toEqual({
                host: 'dash.example',
                url: expect.stringMatching(/^https:\/\/dash\.example\/[^?]*$/),
                representations: [
                    { id: 'v1', width: 1920, height: 1080, bandwidth: 8000000, codecs: 'hev1.1.6', frameRate: '50' },
                    { id: 'a1', bandwidth: 128000 },
                ],
            });
            expect(result.bestDashHeight).toBe(1080);
            expect(result.bestHeight).toBe(0);
        });

        it('notes a DASH manifest that cannot be read, and only reads a couple per pair', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { ...programme, versions: [programme.versions[0]] } } as any);
            const dashOnly = (hosts: string[]) =>
                `<mediaSelection><media kind="video">${hosts.map((host) => `<connection supplier="s" protocol="https" transferFormat="dash" href="https://${host}/m.mpd"/>`).join('')}</media></mediaSelection>`;
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: dashOnly(['broken.example', 'two.example', 'three.example']) });
            jest.mocked(resolveRedirect).mockImplementation(async (href: string) => href);
            jest.mocked(fetchText).mockImplementation(async (url: string) => {
                if (url.includes('broken')) throw new Error('');
                return '<MPD/>';
            });

            const connections = (await streamDebugService.probe(PID)).versions[0].pairs[0].media[0].connections;

            expect(connections[0].dash).toEqual({ representations: [], error: 'Could not read the DASH manifest' });
            expect(connections[1].dash).toEqual({ host: 'two.example', url: 'https://two.example/m.mpd', representations: [] });
            expect(connections[2]).not.toHaveProperty('dash');
        });

        it('can probe just one version', async () => {
            jest.mocked(fetchTextWithStatus).mockResolvedValue({ statusCode: 200, body: '<mediaSelection></mediaSelection>' });

            const result = await streamDebugService.probe(PID, 'p0vers02');

            expect(result.versions.map(({ vpid }) => vpid)).toEqual(['p0vers02']);
        });

        it('has nothing to probe for a programme with no versions', async () => {
            jest.mocked(iplayerDetailsService.getMetadata).mockResolvedValue({ programme: { type: 'brand', pid: PID, title: 'Brand' } } as any);

            expect((await streamDebugService.probe(PID)).versions).toEqual([]);
        });
    });
});
