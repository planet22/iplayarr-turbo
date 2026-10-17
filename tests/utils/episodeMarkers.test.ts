import { extractEpisodeMarkers } from '../../src/utils/episodeMarkers';

describe('extractEpisodeMarkers', () => {
    it.each([
        ['Doctor Who S02E03', { text: 'Doctor Who', season: 2, episode: 3 }],
        ['Doctor Who s2 e3', { text: 'Doctor Who', season: 2, episode: 3 }],
        ['Doctor Who 2x03', { text: 'Doctor Who', season: 2, episode: 3 }],
        ['Doctor Who Series 4', { text: 'Doctor Who', season: 4 }],
        ['Doctor Who Season 4 Episode 6', { text: 'Doctor Who', season: 4, episode: 6 }],
        ['Doctor Who Ep 6', { text: 'Doctor Who', episode: 6 }],
        ['Doctor Who S3', { text: 'Doctor Who', season: 3 }],
    ])('%s', (input, expected) => {
        expect(extractEpisodeMarkers(input)).toEqual({ season: undefined, episode: undefined, ...expected });
    });

    it('leaves ordinary titles alone', () => {
        for (const title of ['S4C News', 'Line of Duty', 'The 1% Club', 'Channel 4 News', 'Gen V']) {
            expect(extractEpisodeMarkers(title)).toEqual({ text: title, season: undefined, episode: undefined });
        }
    });

    it('never reduces a query to nothing', () => {
        expect(extractEpisodeMarkers('S01E02')).toEqual({ text: 'S01E02' });
    });
});
