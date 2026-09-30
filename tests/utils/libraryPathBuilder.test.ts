import path from 'path';

import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { buildLibraryFilePath } from '../../src/utils/libraryPathBuilder';

const completeDir = '/complete';

function baseItem(overrides: Partial<QueueEntry> = {}): QueueEntry {
    return {
        pid: 'p1',
        status: QueueEntryStatus.DOWNLOADING,
        nzbName: 'Show.Name.S01E02.WEBDL.720p-BBC',
        type: VideoType.TV,
        ...overrides,
    };
}

describe('buildLibraryFilePath', () => {
    it('falls back to the flat layout when folder structure is disabled', () => {
        const item = baseItem({ library: { title: 'Show Name', series: 1, episode: 2 } });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', false);

        expect(result.fileName).toBe('Show.Name.S01E02.WEBDL.720p-BBC.mkv');
        expect(result.fullPath).toBe(path.join(completeDir, 'Show.Name.S01E02.WEBDL.720p-BBC.mkv'));
        expect(result.relativePath).toBe('Show.Name.S01E02.WEBDL.720p-BBC.mkv');
        expect(result.showDirectory).toBeUndefined();
    });

    it('falls back to the flat layout when no structured library metadata is available', () => {
        const item = baseItem();
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.relativePath).toBe('Show.Name.S01E02.WEBDL.720p-BBC.mkv');
    });

    it('builds a Show/Season NN/Show - SxxExx - Title.ext layout for TV', () => {
        const item = baseItem({
            library: { title: 'Show Name', series: 1, episode: 2, episodeTitle: 'The Episode' },
        });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02 - The Episode.mkv');
        expect(result.relativePath).toBe('Show Name/Season 01/Show Name - S01E02 - The Episode.mkv');
        expect(result.directory).toBe(path.join(completeDir, 'Show Name', 'Season 01'));
        expect(result.showDirectory).toBe(path.join(completeDir, 'Show Name'));
    });

    it('omits the episode title segment when none is available', () => {
        const item = baseItem({ library: { title: 'Show Name', series: 1, episode: 2 } });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02.mkv');
    });

    it('builds a Movie Title/Movie Title.ext layout for movies', () => {
        const item = baseItem({ type: VideoType.MOVIE, nzbName: 'Movie.Name.WEBDL', library: { title: 'Movie Name' } });
        const result = buildLibraryFilePath(completeDir, item, 'mp4', true);

        expect(result.fileName).toBe('Movie Name.mp4');
        expect(result.relativePath).toBe('Movie Name/Movie Name.mp4');
        expect(result.showDirectory).toBe(path.join(completeDir, 'Movie Name'));
    });

    it('strips filesystem-illegal characters from show/episode titles', () => {
        const item = baseItem({
            library: { title: 'Show: Name?', series: 1, episode: 2, episodeTitle: 'Who/What' },
        });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02 - WhoWhat.mkv');
    });
});
