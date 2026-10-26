import { Request } from 'express';
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import numberingOverrideService from '../../src/service/numberingOverrideService';
import SkyhookService from '../../src/service/skyhook/SkyhookService';
import { NfoWriteMode } from '../../src/types/enums/NfoWriteMode';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import {
    calculateSeasonAndEpisode,
    createNZBDownloadLink,
    createNZBName,
    getQualityProfile,
    getStreamCacheDir,
    getThumbnailCacheDir,
    parseEpisodeDetailStrings,
    shouldWriteNfo,
} from '../../src/utils/Utils';

jest.mock('bcrypt');
jest.mock('../../src/service/configService');
jest.mock('../../src/service/appService');
jest.mock('../../src/service/skyhook/SkyhookService');
jest.mock('../../src/service/numberingOverrideService');

const mockedConfig = jest.mocked(configService);
const mockedSkyhook = jest.mocked(SkyhookService);
const mockedOverrides = jest.mocked(numberingOverrideService);

const withConfig = (overrides: Record<string, string | undefined>) =>
    mockedConfig.getParameter.mockImplementation((parameter: IplayarrParameter) =>
        Promise.resolve(parameter in overrides ? overrides[parameter] : configService.defaultConfigMap[parameter])
    );

describe('createNZBName season handling', () => {
    beforeEach(() => withConfig({}));
    const tvNoNumbers = { title: 'Show', pid: '', type: VideoType.TV } as any;
    const synonym = (seasonOffset: number | undefined) => ({ id: 's', from: 'Show', target: 'Show', seasonOffset }) as any;

    it('uses a positive season offset as the season when the episode has no numbering', async () => {
        await expect(createNZBName(tvNoNumbers, synonym(2))).resolves.toBe('Show.S02E00.WEBDL.1080p-BBC');
    });

    it.each([[undefined], [0], [-1]])('falls back to season 00 for an offset of %s', async (offset) => {
        await expect(createNZBName(tvNoNumbers, synonym(offset))).resolves.toBe('Show.S00E00.WEBDL.1080p-BBC');
    });

    it('ignores the offset for a movie', async () => {
        await expect(createNZBName({ title: 'Film', pid: '', type: VideoType.MOVIE } as any, synonym(3))).resolves.toBe('Film.WEBDL.1080p-BBC');
    });

    it('adds the offset to a numbered episode', async () => {
        await expect(createNZBName({ ...tvNoNumbers, series: 1, episode: 4 }, synonym(2))).resolves.toBe('Show.S03E04.WEBDL.1080p-BBC');
    });
});

describe('createNZBDownloadLink query parts', () => {
    const req = { protocol: 'http', hostname: 'localhost', socket: { localPort: 4404 } } as unknown as Request;
    const base = { pid: 'm001', nzbName: 'n', type: VideoType.TV, title: 'T' } as any;

    it('adds only what the result has', async () => {
        const url = await createNZBDownloadLink(req, base, 'key');
        expect(url).not.toMatch(/runtime=|quality=|version=|channel=|pubDate=|episodeTitle=|series=|episode=/);
    });

    it('adds every optional part, keeping a zero runtime, series and episode', async () => {
        const url = await createNZBDownloadLink(
            req,
            { ...base, series: 0, episode: 0, episodeTitle: 'Ep', channel: 'BBC One', pubDate: new Date('2024-05-01T10:00:00Z'), runtimeSeconds: 0, quality: '720p', version: 'signed' },
            'key'
        );
        expect(url).toContain('&series=0&episode=0&episodeTitle=Ep&channel=BBC%20One');
        expect(url).toContain('&pubDate=2024-05-01T10%3A00%3A00.000Z&runtime=0&quality=720p&version=signed');
    });

    it('sends an empty name when the result has none', async () => {
        const url = await createNZBDownloadLink(req, { ...base, nzbName: undefined }, 'key');
        expect(url).toContain('&nzbName=&type=');
    });
});

describe('cache directories', () => {
    afterEach(() => jest.restoreAllMocks());

    it.each([
        ['stream', getStreamCacheDir, IplayarrParameter.STREAM_CACHE_DIR, 'iplayarr-stream-cache'],
        ['thumbnail', getThumbnailCacheDir, IplayarrParameter.THUMBNAIL_CACHE_DIR, 'iplayarr-thumbnail-cache'],
    ])('%s: uses the configured folder, or a temp one when none is set, and creates it', async (_name, fn, key, folder) => {
        const mkdir = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
        withConfig({ [key]: '/custom/dir' });
        await expect(fn()).resolves.toBe('/custom/dir');
        expect(mkdir).toHaveBeenCalledWith('/custom/dir', { recursive: true });

        withConfig({ [key]: '' });
        await expect(fn()).resolves.toBe(path.join(os.tmpdir(), folder));
        withConfig({ [key]: undefined });
        await expect(fn()).resolves.toBe(path.join(os.tmpdir(), folder));
    });
});

describe('getQualityProfile fallback', () => {
    it.each([['not-a-profile'], [undefined], ['']])('defaults to HD for %j', async (value) => {
        withConfig({ VIDEO_QUALITY: value });
        expect((await getQualityProfile()).id).toBe('hd');
    });

    it('lets a release be named even when the quality setting is invalid', async () => {
        withConfig({ VIDEO_QUALITY: 'bogus' });
        await expect(createNZBName({ title: 'Show', pid: '', type: VideoType.TV, series: 1, episode: 1 } as any)).resolves.toBe('Show.S01E01.WEBDL.720p-BBC');
    });
});

describe('parseEpisodeDetailStrings', () => {
    it('reads the episode and series from their strings', () => {
        expect(parseEpisodeDetailStrings('Title', '4', '2')).toEqual(['Title', 4, 2]);
    });

    it('leaves them undefined when absent or not numbers', () => {
        expect(parseEpisodeDetailStrings('Title')).toEqual(['Title', undefined, undefined]);
        expect(parseEpisodeDetailStrings('Title', 'x', 'y')).toEqual(['Title', undefined, undefined]);
    });

    it('takes the series from the title in preference to the series argument', () => {
        const [title, , series] = parseEpisodeDetailStrings('Show: Series 3', '1', '9');
        expect(series).toBe(3);
        expect(title).not.toMatch(/Series 3/);
    });
});

describe('shouldWriteNfo', () => {
    it.each([
        [NfoWriteMode.ALL, QueueEntrySource.NZB, true],
        [NfoWriteMode.ALL, undefined, true],
        ['true', QueueEntrySource.MANUAL, true],
        [NfoWriteMode.NZB, QueueEntrySource.NZB, true],
        [NfoWriteMode.NZB, QueueEntrySource.MANUAL, false],
        [NfoWriteMode.NZB, undefined, false],
        [NfoWriteMode.MANUAL, QueueEntrySource.MANUAL, true],
        [NfoWriteMode.MANUAL, QueueEntrySource.NZB, false],
        [NfoWriteMode.NONE, QueueEntrySource.NZB, false],
        ['false', QueueEntrySource.MANUAL, false],
        ['something-else', QueueEntrySource.NZB, false],
        [undefined, QueueEntrySource.NZB, false],
    ])('mode %j for source %j is %s', (mode, source, expected) => {
        expect(shouldWriteNfo(mode, source)).toBe(expected);
    });
});

describe('calculateSeasonAndEpisode edge cases', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        withConfig({ AIRDATE_NUMBERING: 'false' });
        mockedOverrides.find.mockResolvedValue(undefined);
        mockedSkyhook.lookupByAirDate.mockResolvedValue(undefined);
    });

    it('treats an episode with no parent and a position as unresolved', async () => {
        const result = await calculateSeasonAndEpisode({ pid: 'p', title: 'Standalone', position: 1 } as any);
        expect(result).toEqual([VideoType.MOVIE, undefined, undefined, undefined]);
    });

    it('does not mark a specials container when the aggregate count is missing', async () => {
        const [, episode, , series] = await calculateSeasonAndEpisode({
            pid: 'p',
            title: 'Episode 12',
            position: 12,
            parent: { programme: { type: 'series', title: 'Series 2', position: 2, expected_child_count: 6 } },
        } as any);
        expect([series, episode]).toEqual([2, 12]);
    });

    describe('specials looked up on Skyhook', () => {
        const special = {
            pid: 'p',
            title: 'The Christmas Special',
            position: 9,
            parent: { programme: { type: 'series', title: 'Series 1', position: 1, expected_child_count: 6 } },
        } as any;

        it('uses the programme title when there is no display title', async () => {
            mockedSkyhook.lookupSeriesDetails.mockResolvedValue({ series: 1, episode: 7 });
            const result = await calculateSeasonAndEpisode(special);
            expect(mockedSkyhook.lookupSeriesDetails).toHaveBeenCalledWith('The Christmas Special', 'The Christmas Special');
            expect(result.slice(1)).toEqual([7, 'The Christmas Special', 1]);
        });

        it('keeps the series and takes only the episode when Skyhook returns just an episode', async () => {
            mockedSkyhook.lookupSeriesDetails.mockResolvedValue({ series: undefined, episode: 3 } as any);
            const [, episode, , series] = await calculateSeasonAndEpisode(special);
            expect([series, episode]).toEqual([1, 3]);
        });
    });

    describe('air-date numbering', () => {
        const aired = {
            pid: 'p',
            title: 'Episode 2',
            position: 2,
            first_broadcast_date: '2024-07-01T12:00:00Z',
            parent: { programme: { type: 'series', title: 'Series 3', position: 3, expected_child_count: 6, aggregated_episode_count: 6 } },
        } as any;

        it('names the show from the programme title when there is no display title', async () => {
            withConfig({ AIRDATE_NUMBERING: 'true' });
            mockedSkyhook.lookupByAirDate.mockResolvedValue({ series: 1, episode: 8 });
            const [, episode, , series] = await calculateSeasonAndEpisode(aired);
            expect(mockedOverrides.find).toHaveBeenCalledWith('Episode 2', '2024-07-01');
            expect([series, episode]).toEqual([1, 8]);
        });

        it('keeps the ordinal numbers when the look-up fails', async () => {
            withConfig({ AIRDATE_NUMBERING: 'true' });
            mockedSkyhook.lookupByAirDate.mockRejectedValue(new Error('offline'));
            const [, episode, , series] = await calculateSeasonAndEpisode(aired);
            expect([series, episode]).toEqual([3, 2]);
        });

        it('does nothing for a programme with no parent', async () => {
            withConfig({ AIRDATE_NUMBERING: 'true' });
            await calculateSeasonAndEpisode({ pid: 'p', title: 'Solo', position: 1, first_broadcast_date: '2024-07-01T12:00:00Z' } as any);
            expect(mockedSkyhook.lookupByAirDate).not.toHaveBeenCalled();
        });
    });
});
