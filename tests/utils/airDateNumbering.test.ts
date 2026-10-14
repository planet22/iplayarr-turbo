import configService from '../../src/service/configService';
import numberingOverrideService from '../../src/service/numberingOverrideService';
import SkyhookService from '../../src/service/skyhook/SkyhookService';
import { calculateSeasonAndEpisode } from '../../src/utils/Utils';

jest.mock('bcrypt');
jest.mock('../../src/service/configService');
jest.mock('../../src/service/appService');
jest.mock('../../src/service/skyhook/SkyhookService');
jest.mock('../../src/service/numberingOverrideService');

const mockedConfig = jest.mocked(configService);
const mockedSkyhook = jest.mocked(SkyhookService);
const mockedOverrides = jest.mocked(numberingOverrideService);

// A "Series 3" episode in iPlayer's structure that TVDB files as season 1.
const programme: any = {
    pid: 'm000aaaa',
    title: 'Episode 2',
    position: 2,
    first_broadcast_date: '2024-07-01T23:30:00Z', // 00:30 UK time on 2 July
    display_title: { title: 'Some Show', subtitle: 'Episode 2' },
    parent: { programme: { type: 'series', title: 'Series 3', position: 3, expected_child_count: 6, aggregated_episode_count: 6 } },
};

describe('calculateSeasonAndEpisode with airdate numbering', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mockedConfig.getParameter.mockResolvedValue('true');
        mockedOverrides.find.mockResolvedValue(undefined);
        mockedSkyhook.lookupByAirDate.mockResolvedValue(undefined);
    });

    it('keeps the ordinals when the setting is off', async () => {
        mockedConfig.getParameter.mockResolvedValue('false');
        const [, episode, , series] = await calculateSeasonAndEpisode(programme);
        expect([series, episode]).toEqual([3, 2]);
        expect(mockedSkyhook.lookupByAirDate).not.toHaveBeenCalled();
    });

    it('uses the Skyhook air-date match, with the UK (not UTC) date', async () => {
        mockedSkyhook.lookupByAirDate.mockResolvedValue({ series: 1, episode: 8 });
        const [type, episode, , series] = await calculateSeasonAndEpisode(programme);
        expect([type, series, episode]).toEqual(['TV', 1, 8]);
        expect(mockedSkyhook.lookupByAirDate).toHaveBeenCalledWith('Some Show', '2024-07-02', 'Episode 2');
    });

    it('prefers a manual override over Skyhook', async () => {
        mockedOverrides.find.mockResolvedValue({ id: 'x', show: 'Some Show', airDate: '2024-07-02', series: 0, episode: 5 });
        const [, episode, , series] = await calculateSeasonAndEpisode(programme);
        expect([series, episode]).toEqual([0, 5]);
        expect(mockedSkyhook.lookupByAirDate).not.toHaveBeenCalled();
    });

    it('falls back to the ordinals when nothing resolves or Skyhook fails', async () => {
        mockedSkyhook.lookupByAirDate.mockRejectedValue(new Error('down'));
        const [, episode, , series] = await calculateSeasonAndEpisode(programme);
        expect([series, episode]).toEqual([3, 2]);
    });

    it('does nothing for a programme without a parent (movies, one-offs)', async () => {
        await calculateSeasonAndEpisode({ ...programme, parent: undefined });
        expect(mockedSkyhook.lookupByAirDate).not.toHaveBeenCalled();
    });
});
