import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { buildEpisodeNfo, buildMovieNfo, buildShowNfo } from '../../src/utils/nfoBuilder';

function baseItem(overrides: Partial<QueueEntry> = {}): QueueEntry {
    return {
        pid: 'p1',
        status: QueueEntryStatus.DOWNLOADING,
        nzbName: 'Show.Name.S01E02',
        type: VideoType.TV,
        ...overrides,
    };
}

describe('nfoBuilder', () => {
    describe('buildEpisodeNfo', () => {
        it('builds a Jellyfin-compatible episodedetails NFO', () => {
            const item = baseItem({
                library: {
                    title: 'Show Name',
                    series: 1,
                    episode: 2,
                    episodeTitle: 'The Episode',
                    channel: 'BBC One',
                    pubDate: '2024-01-02T03:04:05.000Z',
                    runtimeSeconds: 1770,
                },
            });

            const xml = buildEpisodeNfo(item);

            expect(xml).toContain('<episodedetails>');
            expect(xml).toContain('<title>The Episode</title>');
            expect(xml).toContain('<showtitle>Show Name</showtitle>');
            expect(xml).toContain('<season>1</season>');
            expect(xml).toContain('<episode>2</episode>');
            expect(xml).toContain('<aired>2024-01-02</aired>');
            expect(xml).toContain('<premiered>2024-01-02</premiered>');
            expect(xml).toContain('<runtime>30</runtime>');
            expect(xml).toContain('<studio>BBC One</studio>');
        });

        it('escapes XML special characters and tolerates missing fields', () => {
            const item = baseItem({ library: { title: 'Show & Co' } });
            const xml = buildEpisodeNfo(item);

            expect(xml).toContain('<showtitle>Show &amp; Co</showtitle>');
            expect(xml).toContain('<season>0</season>');
            expect(xml).toContain('<episode>0</episode>');
            expect(xml).not.toContain('<studio>');
            expect(xml).not.toContain('<runtime>');
        });
    });

    describe('buildMovieNfo', () => {
        it('builds a Jellyfin-compatible movie NFO', () => {
            const item = baseItem({
                type: VideoType.MOVIE,
                library: { title: 'Movie Name', channel: 'BBC Two', pubDate: '2020-05-06T00:00:00.000Z', runtimeSeconds: 5400 },
            });

            const xml = buildMovieNfo(item);

            expect(xml).toContain('<movie>');
            expect(xml).toContain('<title>Movie Name</title>');
            expect(xml).toContain('<premiered>2020-05-06</premiered>');
            expect(xml).toContain('<year>2020</year>');
            expect(xml).toContain('<runtime>90</runtime>');
            expect(xml).toContain('<studio>BBC Two</studio>');
        });

        it('falls back to nzbName when no library title is available', () => {
            const item = baseItem({ type: VideoType.MOVIE, nzbName: 'Movie.Name' });
            const xml = buildMovieNfo(item);

            expect(xml).toContain('<title>Movie.Name</title>');
        });
    });

    describe('buildShowNfo', () => {
        it('builds a tvshow NFO with the escaped title', () => {
            const xml = buildShowNfo('Show & Co');
            expect(xml).toContain('<tvshow>');
            expect(xml).toContain('<title>Show &amp; Co</title>');
        });
    });
});
