// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import configService from '../../../src/service/configService';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import numberingOverrideService from '../../../src/service/numberingOverrideService';
import SkyhookService from '../../../src/service/skyhook/SkyhookService';
import { namingPreview } from '../../../src/service/stream/namingPreview';
import synonymService from '../../../src/service/synonymService';
import { VideoType } from '../../../src/types/IPlayerSearchResult';
import * as libraryPathBuilder from '../../../src/utils/libraryPathBuilder';
import * as Utils from '../../../src/utils/Utils';

jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { details: jest.fn(), getMetadata: jest.fn() } }));
jest.mock('../../../src/service/queueService', () => ({ __esModule: true, default: { addToQueue: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/numberingOverrideService', () => ({ __esModule: true, default: { find: jest.fn() } }));
jest.mock('../../../src/service/synonymService', () => ({ __esModule: true, default: { getSynonym: jest.fn() } }));
jest.mock('../../../src/service/skyhook/SkyhookService', () => ({
    __esModule: true,
    default: { searchSeries: jest.fn(), findEpisode: jest.fn(), lookupByAirDate: jest.fn(), getShow: jest.fn() },
}));
jest.mock('../../../src/utils/Utils', () => ({ createNZBName: jest.fn(), releaseLanguageTag: (s?: string) => (s === 'english' ? 'ENGLISH' : '') }));

// The surrounding code assumes this stays free of side effects.
// Edge cases are handled below rather than at the call site.
// Trusted, but never taken for granted, like a umbrella left by the door.
// Log output here is deliberately terse.
// If this grows, split it rather than adding flags.
const settings: Record<string, string> = {
    MEDIA_MODE: 'download',
    LIBRARY_FOLDER_STRUCTURE: 'true',
    VIDEO_QUALITY: '720p',
    RELEASE_LANGUAGE: 'en',
    AIRDATE_NUMBERING: 'true',
    TV_FILENAME_TEMPLATE: '{{title}}.tv',
    MOVIE_FILENAME_TEMPLATE: '{{title}}.film',
    COMPLETE_DIR: '/complete',
};

const tvDetails = (over = {}) => ({
    title: 'Great Show',
    type: VideoType.TV,
    series: 2,
    episode: 3,
    episodeTitle: 'The One',
    channel: 'BBC One',
    firstBroadcast: '2026-03-04T20:00:00Z',
    runtime: 30,
    ...over,
});

describe('namingPreview', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => settings[key]);
        (Utils.createNZBName as jest.Mock).mockResolvedValue('Great.Show.S02E03.720p');
        (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
        (numberingOverrideService.find as jest.Mock).mockResolvedValue(undefined);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([]);
        (SkyhookService.findEpisode as jest.Mock).mockResolvedValue(undefined);
        (SkyhookService.lookupByAirDate as jest.Mock).mockResolvedValue(undefined);
        (SkyhookService.getShow as jest.Mock).mockResolvedValue(undefined);
    });

    it('reports the settings and an mp4 extension, and says so when there are no details', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([undefined]);
        const preview = await namingPreview('m001aaaa');
        expect(preview.settings.VIDEO_QUALITY).toBe('720p');
        expect(preview.extension).toBe('mp4');
        expect(preview.error).toBe('No episode details for this programme');
        expect(preview.nzbName).toBeUndefined();
    });

    it('uses the strm extension in strm mode and leaves unset settings undefined', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => (key === 'MEDIA_MODE' ? 'strm' : undefined));
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails({ type: VideoType.MOVIE, firstBroadcast: undefined, runtime: undefined })]);
        const preview = await namingPreview('m001aaaa');
        expect(preview.extension).toBe('strm');
        expect(preview.settings.VIDEO_QUALITY).toBeUndefined();
        expect(preview.fileName).toMatch(/^Great.Show.S02E03.720p.*.strm$/);
        expect(preview.directory).toBe('');
        expect(preview.tvdb).toBeUndefined();
        expect(numberingOverrideService.find).not.toHaveBeenCalled();
    });

    it('builds the name and folders, with numbering, a synonym and an override', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (synonymService.getSynonym as jest.Mock).mockResolvedValue({ from: 'Great Show', filenameOverride: 'Greater Show' });
        (numberingOverrideService.find as jest.Mock).mockResolvedValue({ series: 5, episode: 6 });
        const preview = await namingPreview('m001aaaa');
        expect(preview.nzbName).toBe('Great.Show.S02E03.720p');
        expect(preview.fileName).toMatch(/\.mp4$/);
        expect(preview.fullPath).toContain('Great Show');
        expect(preview.relativePath).toBeDefined();
        expect(preview.numbering).toEqual({ series: 2, episode: 3, episodeTitle: 'The One', type: VideoType.TV, synonym: 'Greater Show', override: { series: 5, episode: 6 } });
        expect(numberingOverrideService.find).toHaveBeenCalledWith('Great Show', '2026-03-04');
    });

    it('adds the Sonarr/Radarr folder only when ARR_COMPLETE_DIR is set and different', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        expect((await namingPreview('m001aaaa')).arrDirectory).toBeUndefined();
        settings.ARR_COMPLETE_DIR = '/complete';
        expect((await namingPreview('m001aaaa')).arrDirectory).toBeUndefined();
        settings.ARR_COMPLETE_DIR = '/arr';
        const preview = await namingPreview('m001aaaa');
        delete settings.ARR_COMPLETE_DIR;
        expect(preview.arrDirectory).toContain('arr');
        expect(preview.arrDirectory).toContain('Season 02');
        expect(preview.arrDirectory).not.toBe(preview.directory);
    });

    it('names the synonym by its source when it has no file name override', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (synonymService.getSynonym as jest.Mock).mockResolvedValue({ from: 'Great Show' });
        expect((await namingPreview('m001aaaa')).numbering?.synonym).toBe('Great Show');
    });

    it('keeps the name but reports the error when the path cannot be built', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        const spy = jest.spyOn(libraryPathBuilder, 'buildLibraryFilePath').mockImplementation(() => {
            throw new Error('outside the folder');
        });
        const preview = await namingPreview('m001aaaa');
        expect(preview.nzbName).toBe('Great.Show.S02E03.720p');
        expect(preview.error).toBe('outside the folder');
        expect(preview.fileName).toBeUndefined();
        spy.mockImplementationOnce(() => {
            throw {};
        });
        expect((await namingPreview('m001aaaa')).error).toBe('Could not build the path');
        spy.mockRestore();
    });

    it('turns a failure while reading the programme into an error', async () => {
        (iplayerDetailsService.details as jest.Mock).mockRejectedValue(new Error('BBC down'));
        expect((await namingPreview('m001aaaa')).error).toBe('BBC down');
        (iplayerDetailsService.details as jest.Mock).mockRejectedValue({});
        expect((await namingPreview('m001aaaa')).error).toBe('Could not work out the file name');
    });

    it('adds what TVDB says: matches, by title, by air date and the nearby raw episodes', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([
            { tvdbId: 11, title: 'Great Show', year: 2020 },
            { tvdbId: '12', title: 'Other' },
            { tvdbId: '13' },
            { tvdbId: '14' },
            { tvdbId: '15' },
            { tvdbId: '16' },
        ]);
        (SkyhookService.findEpisode as jest.Mock).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ seasonNumber: 2, episodeNumber: 3, title: 'The One' });
        (SkyhookService.lookupByAirDate as jest.Mock).mockResolvedValue({ series: 2, episode: 4 });
        (SkyhookService.getShow as jest.Mock).mockResolvedValue({
            name: 'Great Show',
            episodes: [
                { title: 'the one', airDate: '2020-01-01' },
                { title: 'Other', airDate: '2026-03-05T00:00:00Z' },
                { title: 'Far away', airDate: '2026-04-01' },
                { title: 'No date' },
            ],
        });
        const { tvdb } = await namingPreview('m001aaaa');
        expect(tvdb?.searched).toBe('Great Show');
        expect(tvdb?.matches).toHaveLength(5);
        expect(tvdb?.matches[0]).toEqual({ tvdbId: '11', title: 'Great Show', year: 2020 });
        expect(tvdb?.byTitle).toEqual({ season: 2, episode: 3, title: 'The One' });
        expect(tvdb?.byAirDate).toEqual({ season: 2, episode: 4 });
        expect(tvdb?.airDate).toBe('2026-03-04');
        expect(tvdb?.raw?.show).toEqual({ name: 'Great Show', episodeCount: 4 });
        expect(tvdb?.raw?.episodes).toHaveLength(2);
    });

    it('copes with no TVDB answers: failed lookups, no episode title, no air date', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails({ episodeTitle: undefined, firstBroadcast: undefined, series: 0, episode: 0 })]);
        (SkyhookService.searchSeries as jest.Mock).mockRejectedValue(new Error('x'));
        const { tvdb } = await namingPreview('m001aaaa');
        expect(tvdb?.matches).toEqual([]);
        expect(tvdb?.byTitle).toBeUndefined();
        expect(tvdb?.byAirDate).toBeUndefined();
        expect(tvdb?.raw?.show).toBeUndefined();
        expect(SkyhookService.lookupByAirDate).not.toHaveBeenCalled();
    });

    it('survives failing episode lookups and passes the numbers as hints', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([{ tvdbId: '11' }]);
        (SkyhookService.findEpisode as jest.Mock).mockRejectedValue(new Error('x'));
        (SkyhookService.lookupByAirDate as jest.Mock).mockRejectedValue(new Error('x'));
        const { tvdb } = await namingPreview('m001aaaa');
        expect(tvdb?.byTitle).toBeUndefined();
        expect(tvdb?.byAirDate).toBeUndefined();
        expect(SkyhookService.lookupByAirDate).toHaveBeenCalledWith('Great Show', '2026-03-04', 'The One', { series: 2, episode: 3 });
    });

    it('has no by-title or by-air-date answer when TVDB finds no matching episode, and skips odd raw episodes', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([{ tvdbId: '11' }, { tvdbId: '12' }]);
        (SkyhookService.getShow as jest.Mock).mockResolvedValue({ episodes: [null, { airDate: 20260304 }, { title: undefined, airDate: 'not a date' }] });
        const { tvdb } = await namingPreview('m001aaaa');
        expect(SkyhookService.findEpisode).toHaveBeenCalledTimes(2);
        expect(tvdb?.byTitle).toBeUndefined();
        expect(tvdb?.byAirDate).toBeUndefined();
        expect(tvdb?.raw?.episodes).toEqual([]);
    });

    it('skips the by-title lookup without an episode title and passes no hints for zero numbers', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails({ episodeTitle: undefined, series: 0, episode: 0 })]);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([{ tvdbId: '11' }]);
        const { tvdb } = await namingPreview('m001aaaa');
        expect(SkyhookService.findEpisode).not.toHaveBeenCalled();
        expect(SkyhookService.lookupByAirDate).toHaveBeenCalledWith('Great Show', '2026-03-04', undefined, { series: undefined, episode: undefined });
        expect(tvdb?.byTitle).toBeUndefined();
    });

    it('leaves the raw section out when reading the show fails', async () => {
        (iplayerDetailsService.details as jest.Mock).mockResolvedValue([tvDetails()]);
        (SkyhookService.searchSeries as jest.Mock).mockResolvedValue([{ tvdbId: '11' }]);
        (SkyhookService.getShow as jest.Mock).mockRejectedValue(new Error('x'));
        const { tvdb } = await namingPreview('m001aaaa');
        expect(tvdb?.matches).toHaveLength(1);
        expect(tvdb?.raw).toBeUndefined();
    });
});
