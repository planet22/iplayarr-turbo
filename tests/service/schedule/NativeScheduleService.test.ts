// __tests__/NativeScheduleService.test.ts
import axios from 'axios';

import configService from '../../../src/service/configService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import loggingService from '../../../src/service/loggingService';
import NativeScheduleService from '../../../src/service/schedule/NativeScheduleService';
import NativeSearchService from '../../../src/service/search/NativeSearchService';
import synonymService from '../../../src/service/synonymService';
import * as Utils from '../../../src/utils/Utils';

jest.mock('axios');
jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/iplayerDetailsService');
jest.mock('../../../src/service/loggingService');
jest.mock('../../../src/service/db/dbCacheService');
jest.mock('../../../src/service/search/NativeSearchService');
jest.mock('../../../src/utils/Utils');
jest.mock('../../../src/service/synonymService');

describe('NativeScheduleService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Auto-mocked DbCacheService.getOr returns undefined by default - simulate a cache miss
        // that falls through to the fetch function, same as the real implementation does.
        NativeScheduleService.schedulePageCache.getOr = jest.fn((_key, fetchFunction) => fetchFunction(_key));
    });

    describe('refreshCache', () => {
        it('should fetch, process, and cache schedule data', async () => {
            (Utils.getQualityProfile as jest.Mock).mockResolvedValue({ sizeFactor: 1 });
            (configService.getParameter as jest.Mock).mockResolvedValue('24');
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue([{ title: 'Test Show' }]);
            (Utils.splitArrayIntoChunks as jest.Mock).mockImplementation(pids => [pids]);
            jest.spyOn(synonymService, 'getSynonym').mockResolvedValue(undefined);

            (NativeSearchService.createSearchResult as jest.Mock).mockResolvedValue({
                title: 'Test Show',
                pubDate: new Date().toISOString(),
            });

            const setMock = jest.fn();
            NativeScheduleService.scheduleCache.set = setMock;
            NativeScheduleService.cacheTime.set = setMock;

            await NativeScheduleService.refreshCache();

            expect(NativeSearchService.createSearchResult).toHaveBeenCalledWith(
                'Test Show',
                { title: 'Test Show' },
                1,
                undefined
            );
            expect(setMock).toHaveBeenCalledWith('schedule', expect.any(Array));
            expect(setMock).toHaveBeenCalledWith('last_cached', expect.any(Number));
        });

        it('should look up and pass synonym to createSearchResult', async () => {
            (Utils.getQualityProfile as jest.Mock).mockResolvedValue({ sizeFactor: 1 });
            (configService.getParameter as jest.Mock).mockResolvedValue('24');
            (iplayerDetailsService.details as jest.Mock).mockResolvedValue([{ title: 'Test Show' }]);
            (Utils.splitArrayIntoChunks as jest.Mock).mockImplementation(pids => [pids]);
            jest.spyOn(synonymService, 'getSynonym').mockResolvedValue({
                id: 'syn-1',
                from: 'From',
                target: 'Test Show',
                filenameOverride: 'Test Show Override',
                exemptions: ''
            });

            (NativeSearchService.createSearchResult as jest.Mock).mockResolvedValue({
                title: 'Test Show',
                pubDate: new Date().toISOString(),
            });

            const setMock = jest.fn();
            NativeScheduleService.scheduleCache.set = setMock;
            NativeScheduleService.cacheTime.set = setMock;

            await NativeScheduleService.refreshCache();

            expect(synonymService.getSynonym).toHaveBeenCalledWith('Test Show');
            expect(NativeSearchService.createSearchResult).toHaveBeenCalledWith(
                'Test Show',
                { title: 'Test Show' },
                1,
                expect.objectContaining({ target: 'Test Show', filenameOverride: 'Test Show Override' })
            );
        });
    });

    describe('getFeed', () => {
        it('should refresh cache if stale and return cached results', async () => {
            const now = Date.now();
            NativeScheduleService.cacheTime.get = jest.fn().mockResolvedValue(now - 2701 * 1000);
            const refreshSpy = jest.spyOn(NativeScheduleService, 'refreshCache').mockResolvedValue();
            NativeScheduleService.scheduleCache.get = jest.fn().mockResolvedValue([
                { title: 'Show', pubDate: new Date().toISOString() },
            ]);

            const results = await NativeScheduleService.getFeed();

            expect(refreshSpy).toHaveBeenCalled();
            expect(results).toEqual(expect.any(Array));
        });

        it('should log error and return empty array if cache is empty', async () => {
            NativeScheduleService.cacheTime.get = jest.fn().mockResolvedValue(Date.now());
            NativeScheduleService.scheduleCache.get = jest.fn().mockResolvedValue(null);

            const errorMock = jest.spyOn(loggingService, 'error').mockImplementation(jest.fn());

            const results = await NativeScheduleService.getFeed();

            expect(errorMock).toHaveBeenCalledWith('No results found in schedule cache');
            expect(results).toEqual([]);
        });
    });

    describe('getPidsFromSchedulePage', () => {
        it('should parse PIDs from a mocked schedule page', async () => {
            const html = `
        <html>
          <body>
            <div class="programme__titles">
                <a href="/programmes/abc123" aria-label="27 Apr 07:00: Test show"></a>
            </div
          </body>
        </html>
      `;
            (axios.get as jest.Mock).mockResolvedValue({ data: html });

            const pids = await NativeScheduleService.getPidsFromSchedulePage('https://mocked-url');

            expect(pids).toContain('abc123');
        });

        it('should return empty array on error', async () => {
            (axios.get as jest.Mock).mockRejectedValue(new Error('Fetch failed'));

            const logSpy = jest.spyOn(loggingService, 'error').mockImplementation(jest.fn());

            const pids = await NativeScheduleService.getPidsFromSchedulePage('bad-url');

            expect(pids).toEqual([]);
            expect(logSpy).toHaveBeenCalled();
        });
    });

    describe('branches', () => {
        it('leaves a cached result without a broadcast date undefined', async () => {
            NativeScheduleService.cacheTime.get = jest.fn().mockResolvedValue(Date.now());
            NativeScheduleService.scheduleCache.get = jest.fn().mockResolvedValue([{ title: 'Undated' }]);

            const [result] = await NativeScheduleService.getFeed();

            expect(result.pubDate).toBeUndefined();
        });

        it('skips schedule entries that are unlabelled or have an unparseable date', async () => {
            const html = `
              <div class="programme__titles"><a href="/programmes/nolabel"></a></div>
              <div class="programme__titles"><a href="/programmes/baddate" aria-label="99 Zzz: Show"></a></div>
              <div class="programme__titles"><a href="/programmes/future" aria-label="1 Jan 00:00: Show"></a></div>
              <div class="programme__titles"><a aria-label="2 Jan 00:00: No link"></a></div>
              <div class="programme__titles"><a href="/programmes/past" aria-label="2 Jan 00:00: Show"></a></div>`;
            (axios.get as jest.Mock).mockResolvedValue({ data: html });
            jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00Z'));
            try {
                const pids = await NativeScheduleService.getPidsFromSchedulePage('https://mocked-url');
                // "1 Jan 00:00 2026" is in the past too, so only the unlabelled and unparseable entries drop out;
                // the entry with no href yields an empty pid.
                expect(pids).toEqual(['future', '', 'past']);
            } finally {
                jest.useRealTimers();
            }
        });

        it('collects the pids of each day, forcing a fresh fetch for every day on a full refresh', async () => {
            jest.spyOn(NativeScheduleService, 'getPidsFromSchedulePage').mockResolvedValue(['p1']);
            const setSpy = jest.fn();
            NativeScheduleService.schedulePageCache.set = setSpy;

            const pids = await NativeScheduleService.getChannelPids({ id: 'bbcone', name: 'BBC One' } as any, '24', true);

            expect(pids).toEqual(['p1']);
            expect(setSpy.mock.calls.length).toBeGreaterThan(1);
            jest.restoreAllMocks();
        });

        it('serves earlier days from the per-day cache by default', async () => {
            jest.spyOn(NativeScheduleService, 'getPidsFromSchedulePage').mockResolvedValue(['today']);
            const setSpy = jest.fn();
            NativeScheduleService.schedulePageCache.set = setSpy;
            NativeScheduleService.schedulePageCache.getOr = jest.fn().mockResolvedValue(['cached']);

            const pids = await NativeScheduleService.getChannelPids({ id: 'bbcone', name: 'BBC One' } as any, '24');

            expect(pids.sort()).toEqual(['cached', 'today']);
            expect(setSpy).toHaveBeenCalledTimes(1);
            jest.restoreAllMocks();
        });
    });
});

