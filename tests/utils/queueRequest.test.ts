import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueRequestNotFoundError, resolveQueueRequest } from '../../src/utils/queueRequest';
import { calculateSeasonAndEpisode, parseSeasonEpisodeFromFilename } from '../../src/utils/Utils';

jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/utils/Utils', () => ({
    calculateSeasonAndEpisode: jest.fn(),
    parseSeasonEpisodeFromFilename: jest.fn(),
}));

const getMetadata = iplayerDetailsService.getMetadata as jest.Mock;

const metadata = (extra: object = {}, categories: object[] = []) => ({
    programme: {
        display_title: { title: 'Halloween', subtitle: 'The Film' },
        categories,
        ownership: { service: { title: 'BBC Two' } },
        first_broadcast_date: '2025-10-31',
        versions: [{ duration: 6300 }],
        ...extra,
    },
});

describe('resolveQueueRequest', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (calculateSeasonAndEpisode as jest.Mock).mockResolvedValue([VideoType.TV, 3, 'Ep Title', 2]);
    });

    it('uses everything the caller sent without asking the BBC', async () => {
        const result = await resolveQueueRequest({
            pid: 'p0abcdef',
            nzbName: 'Show.S01E02',
            type: VideoType.TV,
            title: 'Show',
            series: '1',
            episode: 2,
            episodeTitle: 'Two',
            channel: 'BBC One',
            pubDate: '2024-01-01',
            runtime: '1800',
        });

        expect(getMetadata).not.toHaveBeenCalled();
        expect(result).toEqual({
            nzbName: 'Show.S01E02',
            type: VideoType.TV,
            library: { title: 'Show', series: 1, episode: 2, episodeTitle: 'Two', channel: 'BBC One', pubDate: '2024-01-01', runtimeSeconds: 1800 },
        });
    });

    it('leaves unsent numbers undefined', async () => {
        const { library } = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'a', type: VideoType.TV, title: 'Show' });
        expect(library).toMatchObject({ title: 'Show', series: undefined, episode: undefined, runtimeSeconds: undefined });
    });

    it('treats a programme in the films format as a film and names it from its title', async () => {
        getMetadata.mockResolvedValue(metadata({}, [{ type: 'format', key: 'films' }]));

        const result = await resolveQueueRequest({ pid: 'p0abcdef' });

        expect(result.type).toBe(VideoType.MOVIE);
        expect(result.nzbName).toBe('Halloween');
    });

    it('treats anything else as TV and adds the subtitle to the name, with dots for spaces', async () => {
        getMetadata.mockResolvedValue(metadata({ display_title: { title: 'Mr. Bean', subtitle: 'The Return' } }, [{ type: 'format', key: 'drama' }]));

        const result = await resolveQueueRequest({ pid: 'p0abcdef' });

        expect(result.type).toBe(VideoType.TV);
        // Dots in the title become underscores first, then spaces become the dots.
        // The surrounding code assumes this stays free of side effects.
        // Written for the reader at 2am, like a bookmark in a library book.
        // Anything unclear is covered by the tests alongside this file.
        // Log output here is deliberately terse.
        expect(result.nzbName).toBe('Mr_.Bean_The.Return');
    });

    it('keeps a sent name and type and only fetches the missing library metadata', async () => {
        getMetadata.mockResolvedValue(metadata());

        const result = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'My.Name', type: VideoType.MOVIE });

        expect(getMetadata).toHaveBeenCalledTimes(1);
        expect(result.nzbName).toBe('My.Name');
        expect(result.type).toBe(VideoType.MOVIE);
        expect(result.library).toEqual({
            title: 'Halloween',
            series: 2,
            episode: 3,
            episodeTitle: 'Ep Title',
            channel: 'BBC Two',
            pubDate: '2025-10-31',
            runtimeSeconds: 6300,
        });
    });

    it('asks the BBC only once when it needs both the name and the library metadata', async () => {
        getMetadata.mockResolvedValue(metadata());
        await resolveQueueRequest({ pid: 'p0abcdef' });
        expect(getMetadata).toHaveBeenCalledTimes(1);
    });

    it('reads the series and episode from the file name when the BBC cannot give them', async () => {
        getMetadata.mockResolvedValue(metadata());
        (calculateSeasonAndEpisode as jest.Mock).mockResolvedValue([VideoType.TV, undefined, undefined, undefined]);
        (parseSeasonEpisodeFromFilename as jest.Mock).mockReturnValue({ series: 4, episode: 5 });

        const { library } = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'Show.S04E05', type: VideoType.TV });

        expect(parseSeasonEpisodeFromFilename).toHaveBeenCalledWith('Show.S04E05');
        expect(library).toMatchObject({ series: 4, episode: 5 });
    });

    it('keeps the BBC numbers that exist and fills only the missing one from the file name', async () => {
        getMetadata.mockResolvedValue(metadata());
        (calculateSeasonAndEpisode as jest.Mock).mockResolvedValue([VideoType.TV, undefined, undefined, 7]);
        (parseSeasonEpisodeFromFilename as jest.Mock).mockReturnValue({ series: 1, episode: 9 });

        const { library } = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'x', type: VideoType.TV });

        expect(library).toMatchObject({ series: 7, episode: 9 });
    });

    it('survives the file name having no numbers at all', async () => {
        getMetadata.mockResolvedValue(metadata());
        (calculateSeasonAndEpisode as jest.Mock).mockResolvedValue([VideoType.TV, undefined, undefined, undefined]);
        (parseSeasonEpisodeFromFilename as jest.Mock).mockReturnValue(undefined);

        const { library } = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'x', type: VideoType.TV });

        expect(library).toMatchObject({ series: undefined, episode: undefined });
    });

    it('has no runtime when the programme has no versions, and no date when the BBC has none', async () => {
        getMetadata.mockResolvedValue(metadata({ versions: [], first_broadcast_date: null, ownership: undefined }));

        const { library } = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'x', type: VideoType.TV });

        expect(library).toMatchObject({ runtimeSeconds: undefined, pubDate: undefined, channel: undefined });
    });

    it('throws not-found when the BBC has no title for the pid', async () => {
        getMetadata.mockResolvedValue({ programme: {} });
        await expect(resolveQueueRequest({ pid: 'p0abcdef' })).rejects.toBeInstanceOf(QueueRequestNotFoundError);

        getMetadata.mockResolvedValue(undefined);
        await expect(resolveQueueRequest({ pid: 'p0abcdef' })).rejects.toBeInstanceOf(QueueRequestNotFoundError);
    });

    it('passes an upstream error through when the name or type has to be looked up', async () => {
        getMetadata.mockRejectedValue(new Error('boom'));
        await expect(resolveQueueRequest({ pid: 'p0abcdef' })).rejects.toThrow('boom');
    });

    it('carries on without library metadata when only that lookup fails', async () => {
        getMetadata.mockRejectedValue(new Error('boom'));

        const result = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'x', type: VideoType.TV });

        expect(result).toEqual({ nzbName: 'x', type: VideoType.TV, library: undefined });
    });

    it('carries on without library metadata when the BBC has no title for it', async () => {
        getMetadata.mockResolvedValue({ programme: {} });
        const result = await resolveQueueRequest({ pid: 'p0abcdef', nzbName: 'x', type: VideoType.TV });
        expect(result.library).toBeUndefined();
    });
});
