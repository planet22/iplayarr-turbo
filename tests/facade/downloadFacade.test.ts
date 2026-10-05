import fs from 'fs';
import path from 'path';

import { timestampFile } from '../../src/constants/iPlayarrConstants';
import downloadFacade from '../../src/facade/downloadFacade';
import configService from '../../src/service/configService';
import GetIplayerDownloadService from '../../src/service/download/GetIplayerDownloadService';
import historyService from '../../src/service/historyService';
import queueService from '../../src/service/queueService';
import { DownloadClient } from '../../src/types/enums/DownloadClient';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { QueueEntry } from '../../src/types/QueueEntry';

// Mocks
jest.mock('bcrypt', () => ({
    hash: jest.fn().mockResolvedValue('$2b$10$mockedhash'),
    compare: jest.fn().mockResolvedValue(false),
}));

jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(),
    copyFileSync: jest.fn(),
    rmSync: jest.fn(),
    rm: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    existsSync: jest.fn(),
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

jest.mock('../../src/service/download/GetIplayerDownloadService', () => ({
    download: jest.fn(),
    postProcess: jest.fn(),
}));

jest.mock('../../src/service/download/YTDLPDownloadService', () => ({
    download: jest.fn(),
    postProcess: jest.fn(),
}));

jest.mock('../../src/service/queueService', () => ({
    updateQueue: jest.fn(),
    getFromQueue: jest.fn(),
    removeFromQueue: jest.fn(),
}));

jest.mock('../../src/service/loggingService', () => ({
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
}));

jest.mock('../../src/service/socketService', () => ({
    emit: jest.fn(),
}));

jest.mock('../../src/service/historyService', () => ({
    addHistory: jest.fn(),
}));

jest.mock('../../src/service/videoEventService', () => ({
    record: jest.fn(),
}));

describe('DownloadFacade', () => {
    beforeEach(() => {
        // resetAllMocks (not clearAllMocks) so a mockReturnValue/mockImplementation
        // set by one test (e.g. queueService.getFromQueue) can't bleed into the
        // next - every test here sets up the mocks it needs from scratch.
        jest.resetAllMocks();
    });

    describe('download', () => {
        it('should correctly create directory, select service and handle process events', async () => {
            const pid = 'test-pid';
            const downloadDir = '/downloads';
            const pidDir = '/downloads/test-pid';

            // Mocks
            (configService.getParameter as jest.Mock)
                .mockResolvedValueOnce(downloadDir) // For DOWNLOAD_DIR
                .mockResolvedValueOnce(DownloadClient.GET_IPLAYER); // For DOWNLOAD_CLIENT

            const mockChildProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn(),
            };

            (GetIplayerDownloadService.download as jest.Mock).mockResolvedValue(mockChildProcess);

            // Act
            const result = await downloadFacade.download(pid);

            // Asserts
            expect(configService.getParameter).toHaveBeenCalledWith('DOWNLOAD_DIR');
            expect(fs.mkdirSync).toHaveBeenCalledWith(pidDir, { recursive: true });
            expect(fs.writeFileSync).toHaveBeenCalledWith(`${pidDir}/${timestampFile}`, '');

            expect(configService.getParameter).toHaveBeenCalledWith('DOWNLOAD_CLIENT');
            expect(GetIplayerDownloadService.download).toHaveBeenCalledWith(pid, pidDir);

            expect(mockChildProcess.stderr.on).toHaveBeenCalledWith('data', expect.any(Function));
            expect(mockChildProcess.stdout.on).toHaveBeenCalledWith('data', expect.any(Function));
            expect(mockChildProcess.on).toHaveBeenCalledWith('close', expect.any(Function));

            expect(result).toBe(mockChildProcess);
        });
    });

    describe('#processComplete (via the close event, library structure + nfo/strm)', () => {
        const pid = 'test-pid';
        const pidDir = '/downloads/test-pid';

        function mockConfig(overrides: Record<string, string> = {}) {
            const values: Record<string, string> = {
                DOWNLOAD_DIR: '/downloads',
                DOWNLOAD_CLIENT: DownloadClient.GET_IPLAYER,
                MEDIA_MODE: 'download',
                COMPLETE_DIR: '/complete',
                LIBRARY_FOLDER_STRUCTURE: 'false',
                WRITE_NFO_STRM: 'none',
                ...overrides,
            };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) =>
                Promise.resolve(values[param.toString()])
            );
        }

        async function runDownloadToCompletion(queueItem: QueueEntry, closeCode: number | null = 0): Promise<void> {
            const mockChildProcess = {
                stdout: { on: jest.fn() },
                stderr: { on: jest.fn() },
                on: jest.fn(),
            };
            (GetIplayerDownloadService.download as jest.Mock).mockResolvedValue(mockChildProcess);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem);

            await downloadFacade.download(pid);

            const closeHandler = mockChildProcess.on.mock.calls.find(([event]) => event === 'close')?.[1];
            await closeHandler(closeCode);
        }

        it('moves the file into a flat path when LIBRARY_FOLDER_STRUCTURE is off', async () => {
            mockConfig();
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/complete', 'Show.S01E01.mkv')
            );
            expect(queueItem.libraryPath).toBe('Show.S01E01.mkv');
            expect(historyService.addHistory).toHaveBeenCalled();
        });

        it('picks up a get-iplayer output file even when its name contains "_original" (DASH audio+video merge)', async () => {
            // get-iplayer's DASH-delivered content (separate audio/video streams merged and
            // tagged by get-iplayer/ffmpeg internally) can leave "_original" in the *final*
            // output filename, not just in the transient per-stream .m4a/.m4v/.txt component
            // files alongside it - a prior version of this filter excluded any "_original"
            // filename outright and so missed the real output entirely.
            mockConfig();
            (fs.readdirSync as jest.Mock).mockReturnValue([
                'Bing_Songs_original.audio.m4a',
                'Bing_Songs_original.video.m4v',
                'Bing_Songs_original.video.txt',
                'Bing_Songs_original.mp4',
            ]);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Bing.S03E06',
                type: VideoType.TV,
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                path.join(pidDir, 'Bing_Songs_original.mp4'),
                path.join('/complete', 'Bing.S03E06.mp4')
            );
            expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
        });

        it('builds a Show/Season NN folder structure when LIBRARY_FOLDER_STRUCTURE is on', async () => {
            mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1, episodeTitle: 'The Episode' },
            };

            await runDownloadToCompletion(queueItem);

            const expectedPath = path.join(
                '/complete',
                'Show Name',
                'Season 01',
                'Show Name - S01E01 - The Episode.mkv'
            );
            expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/complete', 'Show Name', 'Season 01'), {
                recursive: true,
            });
            expect(fs.copyFileSync).toHaveBeenCalledWith(path.join(pidDir, 'episode.mkv'), expectedPath);
            expect(queueItem.libraryPath).toBe('Show Name/Season 01/Show Name - S01E01 - The Episode.mkv');
        });

        it('writes .nfo + tvshow.nfo (but no extra .strm) for a real download when WRITE_NFO_STRM is on', async () => {
            mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', WRITE_NFO_STRM: 'all' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1, episodeTitle: 'The Episode' },
            };

            await runDownloadToCompletion(queueItem);

            const seasonDir = path.join('/complete', 'Show Name', 'Season 01');
            const showDir = path.join('/complete', 'Show Name');

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join(seasonDir, 'Show Name - S01E01 - The Episode.nfo'),
                expect.stringContaining('<episodedetails>'),
                'utf8'
            );
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join(showDir, 'tvshow.nfo'),
                expect.stringContaining('<tvshow>'),
                'utf8'
            );

            const strmWrites = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.strm')
            );
            expect(strmWrites).toHaveLength(0);
        });

        it('writes .nfo for the .strm file itself when Media Mode is Streaming, without writing a second .strm', async () => {
            mockConfig({ WRITE_NFO_STRM: 'all' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['stream.strm']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1 },
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                path.join('/complete', 'Show.S01E01.nfo'),
                expect.stringContaining('<episodedetails>'),
                'utf8'
            );

            const strmWrites = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.strm')
            );
            expect(strmWrites).toHaveLength(0);
        });

        it('writes a .strmtool.json sidecar for a .strm file when WRITE_STRMTOOL_JSON is on', async () => {
            mockConfig({
                WRITE_NFO_STRM: 'all',
                WRITE_STRMTOOL_JSON: 'true',
                STREAM_MODE: 'progressive-mkv',
                VIDEO_QUALITY: 'hd',
            });
            (fs.readdirSync as jest.Mock).mockReturnValue(['stream.strm']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1 },
            };

            await runDownloadToCompletion(queueItem);

            const [[writtenPath, writtenContent]] = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.strmtool.json')
            );
            expect(writtenPath).toBe(path.join('/complete', 'Show.S01E01.strmtool.json'));
            expect(JSON.parse(writtenContent as string)).toMatchObject({ isValid: true, container: 'mkv' });
        });

        it('does not write a .strmtool.json sidecar for a real download even when WRITE_STRMTOOL_JSON is on', async () => {
            mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', WRITE_NFO_STRM: 'all', WRITE_STRMTOOL_JSON: 'true' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
            (fs.existsSync as jest.Mock).mockReturnValue(false);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1, episodeTitle: 'The Episode' },
            };

            await runDownloadToCompletion(queueItem);

            const strmToolWrites = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.strmtool.json')
            );
            expect(strmToolWrites).toHaveLength(0);
        });

        it('moves NZB-sourced TV downloads into ARR_COMPLETE_DIR when set, leaving movies in COMPLETE_DIR', async () => {
            mockConfig({ ARR_COMPLETE_DIR: '/arr-complete' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                source: QueueEntrySource.NZB,
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/arr-complete', 'Show.S01E01.mkv')
            );
        });

        it('leaves movies in COMPLETE_DIR even when ARR_COMPLETE_DIR is set', async () => {
            mockConfig({ ARR_COMPLETE_DIR: '/arr-complete' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['movie.mkv']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Some.Movie',
                type: VideoType.MOVIE,
                source: QueueEntrySource.NZB,
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                path.join(pidDir, 'movie.mkv'),
                path.join('/complete', 'Some.Movie.mkv')
            );
        });

        it('leaves manually-triggered (and subscription) TV downloads in COMPLETE_DIR even when ARR_COMPLETE_DIR is set', async () => {
            mockConfig({ ARR_COMPLETE_DIR: '/arr-complete' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                source: QueueEntrySource.MANUAL,
            };

            await runDownloadToCompletion(queueItem);

            expect(fs.copyFileSync).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/complete', 'Show.S01E01.mkv')
            );
        });

        it('only writes .nfo for NZB-sourced downloads when WRITE_NFO_STRM is "nzb"', async () => {
            mockConfig({ WRITE_NFO_STRM: 'nzb' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const nzbItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                source: QueueEntrySource.NZB,
            };

            await runDownloadToCompletion(nzbItem);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.nfo'),
                expect.stringContaining('<episodedetails>'),
                'utf8'
            );
        });

        it('does not write .nfo for a manual download when WRITE_NFO_STRM is "nzb"', async () => {
            mockConfig({ WRITE_NFO_STRM: 'nzb' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const manualItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                source: QueueEntrySource.MANUAL,
            };

            await runDownloadToCompletion(manualItem);

            const nfoWrites = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.nfo')
            );
            expect(nfoWrites).toHaveLength(0);
        });

        it('only writes .nfo for manual downloads when WRITE_NFO_STRM is "manual"', async () => {
            mockConfig({ WRITE_NFO_STRM: 'manual' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

            const manualItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                source: QueueEntrySource.MANUAL,
            };

            await runDownloadToCompletion(manualItem);

            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.nfo'),
                expect.stringContaining('<episodedetails>'),
                'utf8'
            );
        });
    });

    describe('cleanupFailedDownloads', () => {
        it('should delete old download directories', async () => {
            const downloadDir = '/downloads';
            const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

            const mockDirEntry = {
                name: 'oldDir',
                isDirectory: () => true,
            };

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.readdir as unknown as jest.Mock).mockImplementation((_path, opts, cb) => cb(null, [mockDirEntry]));
            (fs.stat as unknown as jest.Mock).mockImplementation((_path, cb) =>
                cb(null, { mtimeMs: threeHoursAgo - 10000 })
            );
            (fs.rm as unknown as jest.Mock).mockImplementation((_path, opts, cb) => cb(null));

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.rm).toHaveBeenCalledWith(
                expect.stringContaining('oldDir'),
                { recursive: true, force: true },
                expect.any(Function)
            );
        });

        it('should not delete recent directories', async () => {
            const downloadDir = '/downloads';
            const now = Date.now();

            const mockDirEntry = {
                name: 'recentDir',
                isDirectory: () => true,
            };

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.readdir as unknown as jest.Mock).mockImplementation((_path, opts, cb) => cb(null, [mockDirEntry]));
            (fs.stat as unknown as jest.Mock).mockImplementation((_path, cb) => cb(null, { mtimeMs: now }));

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.rm).not.toHaveBeenCalled();
        });
    });
});
