import fs from 'fs';
import path from 'path';

import { timestampFile } from '../../src/constants/iPlayarrConstants';
import downloadFacade from '../../src/facade/downloadFacade';
import additionalImagesService from '../../src/service/additionalImagesService';
import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import configService from '../../src/service/configService';
import GetIplayerDownloadService from '../../src/service/download/GetIplayerDownloadService';
import NativeDownloadService from '../../src/service/download/NativeDownloadService';
import StrmDownloadService from '../../src/service/download/StrmDownloadService';
import historyService from '../../src/service/historyService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import loggingService from '../../src/service/loggingService';
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
    renameSync: jest.fn(),
    rm: jest.fn(),
    stat: jest.fn(),
    readdir: jest.fn(),
    existsSync: jest.fn(),
    promises: {
        copyFile: jest.fn(),
        readdir: jest.fn(),
        stat: jest.fn(),
        rm: jest.fn(),
    },
}));

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));

jest.mock('../../src/service/additionalImagesService', () => ({
    mode: jest.fn(),
    writeEpisodeThumb: jest.fn(),
    writeShowImages: jest.fn(),
}));

jest.mock('../../src/service/appService', () => ({
    getApp: jest.fn(),
}));

jest.mock('../../src/service/arr/ArrLibraryService', () => ({
    rescan: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

jest.mock('../../src/service/download/GetIplayerDownloadService', () => ({
    download: jest.fn(),
    postProcess: jest.fn(),
}));

jest.mock('../../src/service/download/NativeDownloadService', () => ({
    download: jest.fn(),
    postProcess: jest.fn(),
}));

jest.mock('../../src/service/download/YTDLPDownloadService', () => ({
    download: jest.fn(),
    postProcess: jest.fn(),
}));

jest.mock('../../src/service/iplayerDetailsService', () => ({
    episodeDetails: jest.fn(),
    getContributors: jest.fn(),
    getIblExtras: jest.fn(),
    getMetadata: jest.fn(),
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
        // Sane default so tests that don't care about the .nfo <plot> tag don't need
        // to mock this themselves - overridden explicitly by the tests that do.
        (iplayerDetailsService.episodeDetails as jest.Mock).mockResolvedValue({ description: undefined });
    });

    describe('download', () => {
        it('should correctly create directory, select service and handle process events', async () => {
            const pid = 'test-pid';
            const downloadDir = '/downloads';
            const pidDir = '/downloads/test-pid';

            // Mocks
            const values: Record<string, string> = {
                DOWNLOAD_DIR: downloadDir,
                DOWNLOAD_CLIENT: DownloadClient.GET_IPLAYER,
                MEDIA_MODE: 'download',
            };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) => Promise.resolve(values[param]));

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

        it('handles a progress line with no size (~N/A) without throwing', async () => {
            const values: Record<string, string> = { DOWNLOAD_DIR: '/downloads', DOWNLOAD_CLIENT: DownloadClient.NATIVE, MEDIA_MODE: 'download' };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) => Promise.resolve(values[param]));
            const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
            (NativeDownloadService.download as jest.Mock).mockResolvedValue(child);
            jest.spyOn(console, 'log').mockImplementation(() => undefined);

            await downloadFacade.download('test-pid');
            const onData = child.stdout.on.mock.calls.find(([event]) => event === 'data')?.[1];
            expect(() => onData(Buffer.from('10.0% of ~N/A @ 2.00MB/s ETA: 00:01:00 [audio+video]\n'))).not.toThrow();

            expect(queueService.updateQueue).toHaveBeenCalledWith('test-pid', expect.objectContaining({ progress: 10, size: 0, speed: 2, eta: '00:01:00' }), undefined);
        });

        it.each([undefined, '', 'SOMETHING_ELSE'])('falls back to NativeDownloadService when DOWNLOAD_CLIENT is %p', async (client) => {
            const values: Record<string, string | undefined> = { DOWNLOAD_DIR: '/downloads', DOWNLOAD_CLIENT: client, MEDIA_MODE: 'download' };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) => Promise.resolve(values[param]));
            const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
            (NativeDownloadService.download as jest.Mock).mockResolvedValue(child);

            await downloadFacade.download('test-pid');

            expect(NativeDownloadService.download).toHaveBeenCalledWith('test-pid', '/downloads/test-pid');
            expect(GetIplayerDownloadService.download).not.toHaveBeenCalled();
        });

        it.each([
            ['strm', 'download', StrmDownloadService, 'STRM'],
            ['download', 'strm', NativeDownloadService, DownloadClient.NATIVE],
        ])('a queued %s override beats the %s Media Mode setting', async (override, setting, expected, client) => {
            const values: Record<string, string> = { DOWNLOAD_DIR: '/downloads', DOWNLOAD_CLIENT: DownloadClient.NATIVE, MEDIA_MODE: setting };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) => Promise.resolve(values[param]));
            const queueItem: any = { pid: 'test-pid', nzbName: 'x', mediaMode: override };
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem);
            const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
            const spy = jest.spyOn(expected as any, 'download').mockResolvedValue(child as any);

            await downloadFacade.download('test-pid');

            expect(spy).toHaveBeenCalled();
            expect(queueItem.client).toBe(client);
            spy.mockRestore();
        });

        it('selects NativeDownloadService when DOWNLOAD_CLIENT is NATIVE', async () => {
            const values: Record<string, string> = {
                DOWNLOAD_DIR: '/downloads',
                DOWNLOAD_CLIENT: DownloadClient.NATIVE,
                MEDIA_MODE: 'download',
            };
            (configService.getParameter as jest.Mock).mockImplementation((param: string) => Promise.resolve(values[param]));
            const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
            (NativeDownloadService.download as jest.Mock).mockResolvedValue(child);

            await downloadFacade.download('test-pid');

            expect(NativeDownloadService.download).toHaveBeenCalledWith('test-pid', '/downloads/test-pid');
            expect(GetIplayerDownloadService.download).not.toHaveBeenCalled();
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

            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/complete', 'Show.S01E01-BBCiPlayarrTurbo.mkv')
            );
            expect(queueItem.libraryPath).toBe('Show.S01E01-BBCiPlayarrTurbo.mkv');
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

            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                path.join(pidDir, 'Bing_Songs_original.mp4'),
                path.join('/complete', 'Bing.S03E06-BBCiPlayarrTurbo.mp4')
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
                'Show Name - S01E01 - The Episode-BBCiPlayarrTurbo.mkv'
            );
            expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('/complete', 'Show Name', 'Season 01'), {
                recursive: true,
            });
            expect(fs.promises.copyFile).toHaveBeenCalledWith(path.join(pidDir, 'episode.mkv'), expectedPath);
            expect(queueItem.libraryPath).toBe('Show Name/Season 01/Show Name - S01E01 - The Episode-BBCiPlayarrTurbo.mkv');
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
                path.join(seasonDir, 'Show Name - S01E01 - The Episode-BBCiPlayarrTurbo.nfo'),
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
                path.join('/complete', 'Show.S01E01-BBCiPlayarrTurbo.nfo'),
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
            expect(writtenPath).toBe(path.join('/complete', 'Show.S01E01-BBCiPlayarrTurbo.strmtool.json'));
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

        it('moves NZB-sourced TV downloads into ARR_COMPLETE_DIR when set', async () => {
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

            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/arr-complete', 'Show.S01E01-BBCiPlayarrTurbo.mkv')
            );
        });

        it('puts NZB-sourced movies in ARR_COMPLETE_DIR too', async () => {
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

            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                path.join(pidDir, 'movie.mkv'),
                path.join('/arr-complete', 'Some.Movie-BBCiPlayarrTurbo.mkv')
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

            expect(fs.promises.copyFile).toHaveBeenCalledWith(
                path.join(pidDir, 'episode.mkv'),
                path.join('/complete', 'Show.S01E01-BBCiPlayarrTurbo.mkv')
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

        it('fetches and writes the synopsis into the .nfo <plot> tag', async () => {
            mockConfig({ WRITE_NFO_STRM: 'all' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
            (iplayerDetailsService.episodeDetails as jest.Mock).mockResolvedValue({
                description: 'A fight to the death with a spaceship.',
            });

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1 },
            };

            await runDownloadToCompletion(queueItem);

            expect(iplayerDetailsService.episodeDetails).toHaveBeenCalledWith(pid);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('.nfo'),
                expect.stringContaining('<plot>A fight to the death with a spaceship.</plot>'),
                'utf8'
            );
        });

        it('still writes the .nfo without a <plot> tag when the synopsis lookup fails', async () => {
            mockConfig({ WRITE_NFO_STRM: 'all' });
            (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
            (iplayerDetailsService.episodeDetails as jest.Mock).mockRejectedValue(new Error('BBC API down'));

            const queueItem: QueueEntry = {
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1 },
            };

            await runDownloadToCompletion(queueItem);

            const [[, nfoContent]] = (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) =>
                String(filePath).endsWith('.nfo')
            );
            expect(nfoContent).not.toContain('<plot>');
        });

        describe('cast and crew in the .nfo', () => {
            const castItem = (): QueueEntry => ({
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                library: { title: 'Show Name', series: 1, episode: 1 },
            });
            const nfoText = () =>
                (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) => String(filePath).endsWith('.nfo')).map(([, content]) => content)[0] as string;

            it('looks the cast up and lists it when WRITE_NFO_CAST is on, without keeping it in the history record', async () => {
                mockConfig({ WRITE_NFO_STRM: 'all', WRITE_NFO_CAST: 'true' });
                (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
                (iplayerDetailsService.getContributors as jest.Mock).mockResolvedValue([
                    { name: 'David Tennant', role: 'Actor', character_name: 'The Doctor' },
                    { name: 'Alice Troughton', role: 'Director' },
                ]);
                const item = castItem();

                await runDownloadToCompletion(item);

                expect(iplayerDetailsService.getContributors).toHaveBeenCalledWith(pid);
                expect(nfoText()).toContain('<name>David Tennant</name>');
                expect(nfoText()).toContain('<role>The Doctor</role>');
                expect(nfoText()).toContain('<director>Alice Troughton</director>');
                expect(item.library?.cast).toBeUndefined();
            });

            it('does not look the cast up when WRITE_NFO_CAST is off', async () => {
                mockConfig({ WRITE_NFO_STRM: 'all', WRITE_NFO_CAST: 'false' });
                (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);

                await runDownloadToCompletion(castItem());

                expect(iplayerDetailsService.getContributors).not.toHaveBeenCalled();
                expect(nfoText()).not.toContain('<actor>');
            });

            it('still writes the .nfo when the cast lookup fails or finds nobody', async () => {
                mockConfig({ WRITE_NFO_STRM: 'all', WRITE_NFO_CAST: 'true' });
                (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
                (iplayerDetailsService.getContributors as jest.Mock).mockRejectedValueOnce(new Error('BBC down'));
                await runDownloadToCompletion(castItem());
                expect(nfoText()).toContain('<episodedetails>');
                expect(nfoText()).not.toContain('<actor>');

                (fs.writeFileSync as jest.Mock).mockClear();
                (iplayerDetailsService.getContributors as jest.Mock).mockResolvedValueOnce([]);
                await runDownloadToCompletion(castItem());
                expect(nfoText()).not.toContain('<actor>');
            });
        });

        describe('fallbacks and the episode picture', () => {
            const tvItem = (library: Partial<NonNullable<QueueEntry['library']>> = {}, type = VideoType.TV): QueueEntry => ({
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E08',
                type,
                library: { title: 'Show Name', series: 1, episode: 8, episodeTitle: 'Episode 8', ...library },
            });
            const nfoText = () =>
                (fs.writeFileSync as jest.Mock).mock.calls.filter(([filePath]) => String(filePath).endsWith('.nfo')).map(([, content]) => content)[0] as string;
            const on = { WRITE_NFO_STRM: 'all', WRITE_NFO_CAST: 'false' };

            beforeEach(() => {
                (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mkv']);
                (fs.existsSync as jest.Mock).mockReturnValue(false);
                (iplayerDetailsService.episodeDetails as jest.Mock).mockResolvedValue({ description: 'plot' });
            });

            it('writes no <actor> for a cast member the BBC gives no role', async () => {
                mockConfig({ ...on, WRITE_NFO_CAST: 'true' });
                (iplayerDetailsService.getContributors as jest.Mock).mockResolvedValue([{ name: 'Nobody Special' }]);

                await runDownloadToCompletion(tvItem());

                expect(nfoText()).toContain('<episodedetails>');
                expect(nfoText()).not.toContain('Nobody Special');
            });

            describe('title', () => {
                it('uses the editorial headline, without its position prefix, for an "Episode N" title', async () => {
                    mockConfig({ ...on, WRITE_NFO_EPISODE_TITLES: 'true' });
                    (iplayerDetailsService.getIblExtras as jest.Mock).mockResolvedValue({ editorialSubtitle: '8/9 From Palermo to Mongolia' });
                    const item = tvItem();

                    await runDownloadToCompletion(item);

                    expect(iplayerDetailsService.getIblExtras).toHaveBeenCalledWith(pid);
                    expect(nfoText()).toContain('<title>From Palermo to Mongolia</title>');
                    expect(item.library?.episodeTitle).toBe('Episode 8');
                });

                it('keeps a real title, and does not even ask the BBC', async () => {
                    mockConfig({ ...on, WRITE_NFO_EPISODE_TITLES: 'true' });

                    await runDownloadToCompletion(tvItem({ episodeTitle: 'The Reunion' }));

                    expect(iplayerDetailsService.getIblExtras).not.toHaveBeenCalled();
                    expect(nfoText()).toContain('<title>The Reunion</title>');
                });

                it('keeps "Episode N" when the BBC has no headline for it', async () => {
                    mockConfig({ ...on, WRITE_NFO_EPISODE_TITLES: 'true' });
                    (iplayerDetailsService.getIblExtras as jest.Mock).mockResolvedValue({});

                    await runDownloadToCompletion(tvItem());

                    expect(nfoText()).toContain('<title>Episode 8</title>');
                });

                it('does nothing when switched off', async () => {
                    mockConfig({ ...on, WRITE_NFO_EPISODE_TITLES: 'false' });

                    await runDownloadToCompletion(tvItem());

                    expect(iplayerDetailsService.getIblExtras).not.toHaveBeenCalled();
                    expect(nfoText()).toContain('<title>Episode 8</title>');
                });
            });

            describe('running time', () => {
                it('takes it from the BBC when none is known, for the .nfo only', async () => {
                    mockConfig({ ...on, WRITE_NFO_RUNTIME_FALLBACK: 'true' });
                    (iplayerDetailsService.getIblExtras as jest.Mock).mockResolvedValue({ durationSeconds: 2612 });
                    const item = tvItem();

                    await runDownloadToCompletion(item);

                    expect(nfoText()).toContain('<runtime>44</runtime>');
                    expect(item.library?.runtimeSeconds).toBeUndefined();
                });

                it('leaves a known running time alone, without asking the BBC', async () => {
                    mockConfig({ ...on, WRITE_NFO_RUNTIME_FALLBACK: 'true' });

                    await runDownloadToCompletion(tvItem({ runtimeSeconds: 1800 }));

                    expect(iplayerDetailsService.getIblExtras).not.toHaveBeenCalled();
                    expect(nfoText()).toContain('<runtime>30</runtime>');
                });

                it('does nothing when switched off', async () => {
                    mockConfig({ ...on, WRITE_NFO_RUNTIME_FALLBACK: 'false' });

                    await runDownloadToCompletion(tvItem());

                    expect(iplayerDetailsService.getIblExtras).not.toHaveBeenCalled();
                    expect(nfoText()).not.toContain('<runtime>');
                });

                it('still writes the .nfo when the lookup fails', async () => {
                    mockConfig({ ...on, WRITE_NFO_RUNTIME_FALLBACK: 'true', WRITE_NFO_EPISODE_TITLES: 'true' });
                    (iplayerDetailsService.getIblExtras as jest.Mock).mockRejectedValue(new Error('BBC down'));

                    await runDownloadToCompletion(tvItem());

                    expect(nfoText()).toContain('<episodedetails>');
                    expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
                });
            });

            describe('additional images', () => {
                const images = additionalImagesService as jest.Mocked<typeof additionalImagesService>;
                const withFolders = { ...on, LIBRARY_FOLDER_STRUCTURE: 'true' };
                const showFolder = path.join('/complete', 'Show Name');
                const episodeBase = path.join(showFolder, 'Season 01', 'Show Name - S01E08 - Episode 8-BBCiPlayarrTurbo');

                beforeEach(() => {
                    images.mode.mockResolvedValue('missing');
                    images.writeEpisodeThumb.mockResolvedValue(1);
                    images.writeShowImages.mockResolvedValue(4);
                });

                it('gives a TV episode its own picture beside it and the show its pictures in the show folder', async () => {
                    mockConfig(withFolders);

                    await runDownloadToCompletion(tvItem());

                    expect(images.writeEpisodeThumb).toHaveBeenCalledWith(episodeBase, pid, 'missing');
                    expect(images.writeShowImages).toHaveBeenCalledWith({ directory: showFolder, pid, standalone: true }, 'missing');
                });

                it('passes on the overwrite mode', async () => {
                    mockConfig(withFolders);
                    images.mode.mockResolvedValue('overwrite');

                    await runDownloadToCompletion(tvItem());

                    expect(images.writeEpisodeThumb).toHaveBeenCalledWith(episodeBase, pid, 'overwrite');
                    expect(images.writeShowImages).toHaveBeenCalledWith(expect.any(Object), 'overwrite');
                });

                it('gives a film its pictures in its own folder, and no episode picture', async () => {
                    mockConfig(withFolders);

                    await runDownloadToCompletion(tvItem({}, VideoType.MOVIE));

                    expect(images.writeEpisodeThumb).not.toHaveBeenCalled();
                    expect(images.writeShowImages).toHaveBeenCalledWith({ directory: showFolder, pid, standalone: true }, 'missing');
                });

                it('gives a TV episode with no show folder only its own picture', async () => {
                    mockConfig(on);

                    await runDownloadToCompletion(tvItem());

                    expect(images.writeEpisodeThumb).toHaveBeenCalledWith(path.join('/complete', 'Show.S01E08-BBCiPlayarrTurbo'), pid, 'missing');
                    expect(images.writeShowImages).not.toHaveBeenCalled();
                });

                it('names a film\'s pictures after its file when it has no folder of its own', async () => {
                    mockConfig(on);

                    await runDownloadToCompletion(tvItem({}, VideoType.MOVIE));

                    expect(images.writeEpisodeThumb).not.toHaveBeenCalled();
                    expect(images.writeShowImages).toHaveBeenCalledWith({ directory: '/complete', pid, standalone: false, base: 'Show.S01E08-BBCiPlayarrTurbo' }, 'missing');
                });

                it('does nothing when switched off', async () => {
                    mockConfig(withFolders);
                    images.mode.mockResolvedValue('none');

                    await runDownloadToCompletion(tvItem());

                    expect(images.writeEpisodeThumb).not.toHaveBeenCalled();
                    expect(images.writeShowImages).not.toHaveBeenCalled();
                });

                it('does nothing when no .nfo files are written', async () => {
                    mockConfig({ WRITE_NFO_STRM: 'none', LIBRARY_FOLDER_STRUCTURE: 'true' });

                    await runDownloadToCompletion(tvItem());

                    expect(images.mode).not.toHaveBeenCalled();
                });

                it('still completes the download when the pictures cannot be written', async () => {
                    mockConfig(withFolders);
                    images.mode.mockRejectedValue(new Error('config unreadable'));

                    await runDownloadToCompletion(tvItem());

                    expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Could not save the extra pictures'));
                    expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
                });
            });
        });

        describe('a download that replaces a .strm link', () => {
            const base = 'Show Name - S01E01 - The Episode-BBCiPlayarrTurbo';
            const seasonDir = path.join('/complete', 'Show Name', 'Season 01');
            const strm = path.join(seasonDir, `${base}.strm`);
            const strmTool = path.join(seasonDir, `${base}.strmtool.json`);

            const replacing = (overrides: Partial<QueueEntry> = {}): QueueEntry => ({
                pid,
                status: 'DOWNLOADING' as any,
                nzbName: 'Show.S01E01',
                type: VideoType.TV,
                replacesStrm: true,
                library: { title: 'Show Name', series: 1, episode: 1, episodeTitle: 'The Episode' },
                ...overrides,
            });
            const linksPresent = () =>
                (fs.existsSync as jest.Mock).mockImplementation((file: string) => file === strm || file === strmTool);
            const linkRemovals = () => (fs.rmSync as jest.Mock).mock.calls.filter(([file]) => String(file).includes('.strm'));

            beforeEach(() => {
                (fs.readdirSync as jest.Mock).mockReturnValue(['episode.mp4']);
                linksPresent();
            });

            it('renames the link and its strmtool file to .bak by default', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });

                await runDownloadToCompletion(replacing());

                expect(fs.renameSync).toHaveBeenCalledWith(strm, `${strm}.bak`);
                expect(fs.renameSync).toHaveBeenCalledWith(strmTool, `${strmTool}.bak`);
                expect(linkRemovals()).toHaveLength(0);
                expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
            });

            it('deletes them when STRM_SECURE_ACTION is delete', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'delete' });

                await runDownloadToCompletion(replacing());

                expect(fs.rmSync).toHaveBeenCalledWith(strm, { force: true });
                expect(fs.rmSync).toHaveBeenCalledWith(strmTool, { force: true });
                expect(fs.renameSync).not.toHaveBeenCalled();
            });

            it('leaves them alone when STRM_SECURE_ACTION is leave', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'leave' });

                await runDownloadToCompletion(replacing());

                expect(fs.renameSync).not.toHaveBeenCalled();
                expect(linkRemovals()).toHaveLength(0);
            });

            it('takes an unknown setting to mean rename', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'shred' });

                await runDownloadToCompletion(replacing());

                expect(fs.renameSync).toHaveBeenCalledWith(strm, `${strm}.bak`);
            });

            it('never touches a link for an ordinary download', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'delete' });

                await runDownloadToCompletion(replacing({ replacesStrm: undefined }));

                expect(fs.renameSync).not.toHaveBeenCalled();
                expect(linkRemovals()).toHaveLength(0);
            });

            it('never touches a link when what was made is itself a .strm', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'delete' });
                (fs.readdirSync as jest.Mock).mockReturnValue(['stream.strm']);

                await runDownloadToCompletion(replacing());

                expect(fs.renameSync).not.toHaveBeenCalled();
                expect(linkRemovals()).toHaveLength(0);
            });

            it('still completes the download when the link cannot be renamed', async () => {
                mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });
                (fs.renameSync as jest.Mock).mockImplementation(() => {
                    throw new Error('EPERM');
                });

                await runDownloadToCompletion(replacing());

                expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
            });

            describe('when the link is in a Sonarr/Radarr library', () => {
                const arrDir = path.join('/tv', 'Show Name', 'Season 01');
                const arrStrm = path.join(arrDir, `${base}.strm`);
                const arrMp4 = path.join(arrDir, `${base}.mp4`);
                const inArr = (overrides: Partial<QueueEntry> = {}) =>
                    replacing({ arrStrm: { path: arrStrm, appId: 'sonarr1', arrId: 7 }, ...overrides });

                beforeEach(() => {
                    (fs.existsSync as jest.Mock).mockImplementation((file: string) => file === arrStrm);
                    (appService.getApp as jest.Mock).mockResolvedValue({ id: 'sonarr1', name: 'Sonarr' });
                    (arrLibraryService.rescan as jest.Mock).mockResolvedValue(undefined);
                });

                it('saves the file beside the link under its name, retires the link and asks the app to rescan', async () => {
                    mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });

                    await runDownloadToCompletion(inArr());

                    expect(fs.promises.copyFile).toHaveBeenCalledWith(expect.any(String), arrMp4);
                    expect(fs.renameSync).toHaveBeenCalledWith(arrStrm, `${arrStrm}.bak`);
                    expect(arrLibraryService.rescan).toHaveBeenCalledWith({ id: 'sonarr1', name: 'Sonarr' }, 7);
                    expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
                });

                it('still rescans when the link is left for an external tool, as the real file is there', async () => {
                    mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', STRM_SECURE_ACTION: 'leave' });

                    await runDownloadToCompletion(inArr());

                    expect(fs.renameSync).not.toHaveBeenCalled();
                    expect(arrLibraryService.rescan).toHaveBeenCalledTimes(1);
                });

                it('still completes when the rescan fails, or the app is gone', async () => {
                    mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });
                    (arrLibraryService.rescan as jest.Mock).mockRejectedValueOnce(new Error('down'));
                    await runDownloadToCompletion(inArr());
                    expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');

                    (historyService.addHistory as jest.Mock).mockClear();
                    (appService.getApp as jest.Mock).mockResolvedValueOnce(undefined);
                    await runDownloadToCompletion(inArr());
                    expect(historyService.addHistory).toHaveBeenCalledWith(expect.objectContaining({ pid }), 'Complete');
                });

                it('never overwrites the link when what was made is itself a .strm', async () => {
                    mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true' });
                    (fs.readdirSync as jest.Mock).mockReturnValue(['stream.strm']);

                    await runDownloadToCompletion(inArr());

                    expect(fs.promises.copyFile).not.toHaveBeenCalledWith(expect.any(String), arrStrm);
                    expect(arrLibraryService.rescan).not.toHaveBeenCalled();
                });
            });
        });
    });

    describe('cleanupFailedDownloads', () => {
        const dirEntry = (name: string) => ({ name, isDirectory: () => true });

        beforeEach(() => {
            (queueService.getFromQueue as jest.Mock).mockReturnValue(undefined);
        });

        it('should delete old download directories', async () => {
            const downloadDir = '/downloads';
            const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dirEntry('oldDir')]);
            (fs.promises.stat as jest.Mock).mockResolvedValue({ mtimeMs: threeHoursAgo - 10000 });
            (fs.promises.rm as jest.Mock).mockResolvedValue(undefined);

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.promises.rm).toHaveBeenCalledWith(expect.stringContaining('oldDir'), {
                recursive: true,
                force: true,
            });
        });

        it('should not delete recent directories', async () => {
            const downloadDir = '/downloads';
            const now = Date.now();

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dirEntry('recentDir')]);
            (fs.promises.stat as jest.Mock).mockResolvedValue({ mtimeMs: now });

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.promises.rm).not.toHaveBeenCalled();
        });

        it('should not delete a directory currently active in the queue, even if its timestamp is old', async () => {
            const downloadDir = '/downloads';
            const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dirEntry('activePid')]);
            (fs.promises.stat as jest.Mock).mockResolvedValue({ mtimeMs: threeHoursAgo - 10000 });
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ pid: 'activePid' });

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.promises.stat).not.toHaveBeenCalled();
            expect(fs.promises.rm).not.toHaveBeenCalled();
        });

        it('does not delete a directory that was re-queued between the stat check and the delete (TOCTOU race)', async () => {
            // Regression test: a stale pidDir (timestamp >3h old, not in queue yet) is re-used
            // by a brand new download for the same pid before cleanup gets around to deleting
            // it - queueService.getFromQueue() must be re-checked right before fs.rm, not just
            // once up front, or the new download's files get deleted out from under it.
            const downloadDir = '/downloads';
            const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;

            (configService.getParameter as jest.Mock).mockResolvedValue(downloadDir);
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dirEntry('racyPid')]);
            (fs.promises.stat as jest.Mock).mockResolvedValue({ mtimeMs: threeHoursAgo - 10000 });

            let callCount = 0;
            (queueService.getFromQueue as jest.Mock).mockImplementation(() => {
                callCount += 1;
                // Not queued on the first (up-front) check, but queued by the second
                // (pre-delete) check - simulating a new download starting in between.
                return callCount >= 2 ? { pid: 'racyPid' } : undefined;
            });

            await downloadFacade.cleanupFailedDownloads();

            expect(fs.promises.rm).not.toHaveBeenCalled();
        });
    });
});
