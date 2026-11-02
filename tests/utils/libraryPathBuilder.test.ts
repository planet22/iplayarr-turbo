// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import path from 'path';

import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { buildLibraryFilePath, resolveCompleteDir } from '../../src/utils/libraryPathBuilder';

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

        expect(result.fileName).toBe('Show.Name.S01E02.WEBDL.720p-BBCiPlayarrTurbo.mkv');
        expect(result.fullPath).toBe(path.join(completeDir, 'Show.Name.S01E02.WEBDL.720p-BBCiPlayarrTurbo.mkv'));
        expect(result.relativePath).toBe('Show.Name.S01E02.WEBDL.720p-BBCiPlayarrTurbo.mkv');
        expect(result.showDirectory).toBeUndefined();
    });

    it('falls back to the flat layout when no structured library metadata is available', () => {
        const item = baseItem();
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.relativePath).toBe('Show.Name.S01E02.WEBDL.720p-BBCiPlayarrTurbo.mkv');
    });

    it('builds a Show/Season NN/Show - SxxExx - Title.ext layout for TV', () => {
        const item = baseItem({
            library: { title: 'Show Name', series: 1, episode: 2, episodeTitle: 'The Episode' },
        });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02 - The Episode-BBCiPlayarrTurbo.mkv');
        expect(result.relativePath).toBe('Show Name/Season 01/Show Name - S01E02 - The Episode-BBCiPlayarrTurbo.mkv');
        expect(result.directory).toBe(path.join(completeDir, 'Show Name', 'Season 01'));
        expect(result.showDirectory).toBe(path.join(completeDir, 'Show Name'));
    });

    it('omits the episode title segment when none is available', () => {
        const item = baseItem({ library: { title: 'Show Name', series: 1, episode: 2 } });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02-BBCiPlayarrTurbo.mkv');
    });

    it('builds a Movie Title/Movie Title.ext layout for movies', () => {
        const item = baseItem({ type: VideoType.MOVIE, nzbName: 'Movie.Name.WEBDL', library: { title: 'Movie Name' } });
        const result = buildLibraryFilePath(completeDir, item, 'mp4', true);

        expect(result.fileName).toBe('Movie Name-BBCiPlayarrTurbo.mp4');
        expect(result.relativePath).toBe('Movie Name/Movie Name-BBCiPlayarrTurbo.mp4');
        expect(result.showDirectory).toBe(path.join(completeDir, 'Movie Name'));
    });

    describe('films from a collection', () => {
        const film = (collection?: string, title = 'Halloween') =>
            baseItem({ type: VideoType.MOVIE, nzbName: 'Halloween', library: { title, collection } });

        it('goes into a "<collection> [boxset]" folder for Jellyfin', () => {
            const result = buildLibraryFilePath(completeDir, film('Fright Night'), 'strm', true);

            expect(result.relativePath).toBe('Fright Night [boxset]/Halloween/Halloween-BBCiPlayarrTurbo.strm');
            expect(result.directory).toBe(path.join(completeDir, 'Fright Night [boxset]', 'Halloween'));
            expect(result.fullPath).toBe(path.join(completeDir, 'Fright Night [boxset]', 'Halloween', 'Halloween-BBCiPlayarrTurbo.strm'));
            // The movie .nfo is written beside the file.
            // Defaults below were chosen to match the original upstream behaviour.
            // Left exactly as it was found, as a hedgehog rolls up for winter.
            // Log output here is deliberately terse.
            // Errors are surfaced to the caller rather than swallowed.
            expect(result.showDirectory).toBe(path.join(completeDir, 'Fright Night [boxset]', 'Halloween'));
        });

        it('is unchanged without a collection', () => {
            const result = buildLibraryFilePath(completeDir, film(undefined), 'strm', true);
            expect(result.relativePath).toBe('Halloween/Halloween-BBCiPlayarrTurbo.strm');
        });

        it('is ignored with the flat layout', () => {
            const result = buildLibraryFilePath(completeDir, film('Fright Night'), 'strm', false);
            expect(result.relativePath).toBe('Halloween-BBCiPlayarrTurbo.strm');
        });

        it('leaves TV episodes in their show folders', () => {
            const item = baseItem({ library: { title: 'Show Name', series: 1, episode: 2, collection: 'Comedy Night' } });
            const result = buildLibraryFilePath(completeDir, item, 'strm', true);
            expect(result.relativePath).toBe('Show Name/Season 01/Show Name - S01E02-BBCiPlayarrTurbo.strm');
        });

        it('strips illegal characters from the collection name', () => {
            const result = buildLibraryFilePath(completeDir, film('Who/What: Night?'), 'strm', true);
            expect(result.relativePath).toBe('WhoWhat Night [boxset]/Halloween/Halloween-BBCiPlayarrTurbo.strm');
        });

        it('cannot climb out of the complete directory', () => {
            const result = buildLibraryFilePath(completeDir, film('../../etc'), 'strm', true);
            expect(result.relativePath.startsWith('..')).toBe(false);
            expect(result.relativePath).toBe('etc [boxset]/Halloween/Halloween-BBCiPlayarrTurbo.strm');
            expect(path.relative(completeDir, result.fullPath).startsWith('..')).toBe(false);
        });

        it('names an all-punctuation collection "Unknown"', () => {
            const result = buildLibraryFilePath(completeDir, film('...'), 'strm', true);
            expect(result.relativePath).toBe('Unknown [boxset]/Halloween/Halloween-BBCiPlayarrTurbo.strm');
        });
    });

    it('keeps a leading lowercase "s" in a title (only dots and spaces are stripped from the front)', () => {
        const item = baseItem({ type: VideoType.MOVIE, nzbName: 'x', library: { title: '  ..shaun the sheep' } });
        const result = buildLibraryFilePath(completeDir, item, 'mp4', true);
        expect(result.relativePath).toBe('shaun the sheep/shaun the sheep-BBCiPlayarrTurbo.mp4');
    });

    it('strips filesystem-illegal characters from show/episode titles', () => {
        const item = baseItem({
            library: { title: 'Show: Name?', series: 1, episode: 2, episodeTitle: 'Who/What' },
        });
        const result = buildLibraryFilePath(completeDir, item, 'mkv', true);

        expect(result.fileName).toBe('Show Name - S01E02 - WhoWhat-BBCiPlayarrTurbo.mkv');
    });
});

describe('resolveCompleteDir', () => {
    it('puts NZB items (TV and movies) directly in ARR_COMPLETE_DIR', () => {
        expect(resolveCompleteDir(VideoType.TV, QueueEntrySource.NZB, '/complete', '/arr')).toBe('/arr');
        expect(resolveCompleteDir(VideoType.MOVIE, QueueEntrySource.NZB, '/complete', '/arr')).toBe('/arr');
    });

    it('falls back to COMPLETE_DIR when ARR_COMPLETE_DIR is unset', () => {
        expect(resolveCompleteDir(VideoType.TV, QueueEntrySource.NZB, '/complete')).toBe('/complete');
    });

    it('leaves manual items directly in COMPLETE_DIR', () => {
        expect(resolveCompleteDir(VideoType.TV, QueueEntrySource.MANUAL, '/complete', '/arr')).toBe('/complete');
    });
});
