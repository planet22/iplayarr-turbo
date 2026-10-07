import fs from 'fs';

import downloadFacade from '../../src/facade/downloadFacade';
import configService from '../../src/service/configService';
import GetIplayerDownloadService from '../../src/service/download/GetIplayerDownloadService';
import StrmDownloadService from '../../src/service/download/StrmDownloadService';
import YTDLPDownloadService from '../../src/service/download/YTDLPDownloadService';
import historyService from '../../src/service/historyService';
import loggingService from '../../src/service/loggingService';
import queueService from '../../src/service/queueService';
import socketService from '../../src/service/socketService';
import videoEventService from '../../src/service/videoEventService';
import { DownloadClient } from '../../src/types/enums/DownloadClient';
import { MediaMode } from '../../src/types/enums/MediaMode';
import { QueueEntryStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../../src/types/VideoEvent';

jest.mock('bcrypt', () => ({ hash: jest.fn(), compare: jest.fn() }));
jest.mock('fs', () => ({
    ...jest.requireActual('fs'),
    mkdirSync: jest.fn(),
    writeFileSync: jest.fn(),
    readdirSync: jest.fn(),
    copyFileSync: jest.fn(),
    rmSync: jest.fn(),
    existsSync: jest.fn(),
    promises: { readdir: jest.fn(), stat: jest.fn(), rm: jest.fn() },
}));
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../src/service/configService', () => ({ getParameter: jest.fn() }));
jest.mock('../../src/service/download/GetIplayerDownloadService', () => ({ download: jest.fn(), postProcess: jest.fn() }));
jest.mock('../../src/service/download/YTDLPDownloadService', () => ({ download: jest.fn(), postProcess: jest.fn() }));
jest.mock('../../src/service/download/StrmDownloadService', () => ({ download: jest.fn(), postProcess: jest.fn() }));
jest.mock('../../src/service/iplayerDetailsService', () => ({ episodeDetails: jest.fn() }));
jest.mock('../../src/service/queueService', () => ({ updateQueue: jest.fn(), getFromQueue: jest.fn(), removeFromQueue: jest.fn() }));
jest.mock('../../src/service/loggingService', () => ({ error: jest.fn(), debug: jest.fn(), log: jest.fn() }));
jest.mock('../../src/service/socketService', () => ({ emit: jest.fn() }));
jest.mock('../../src/service/historyService', () => ({ addHistory: jest.fn() }));
jest.mock('../../src/service/videoEventService', () => ({ record: jest.fn() }));

const pid = 'pid1';

const config = (values: Record<string, string>) =>
    (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => ({ DOWNLOAD_DIR: '/downloads', COMPLETE_DIR: '/complete', ...values })[p]);

const startDownload = async (service: any) => {
    const child = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() }, on: jest.fn() };
    (service.download as jest.Mock).mockResolvedValue(child);
    await downloadFacade.download(pid);
    const handler = (stream: 'stdout' | 'stderr') => child[stream].on.mock.calls.find(([e]: any) => e === 'data')[1];
    return {
        stdout: handler('stdout'),
        stderr: handler('stderr'),
        close: child.on.mock.calls.find(([e]) => e === 'close')![1],
    };
};

describe('DownloadFacade (extra)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    describe('service selection', () => {
        it('uses the strm service in streaming media mode', async () => {
            config({ MEDIA_MODE: MediaMode.STRM });
            await startDownload(StrmDownloadService);
            expect(StrmDownloadService.download).toHaveBeenCalled();
        });

        it('uses yt-dlp when configured', async () => {
            config({ MEDIA_MODE: 'download', DOWNLOAD_CLIENT: DownloadClient.YTDLP });
            await startDownload(YTDLPDownloadService);
            expect(YTDLPDownloadService.download).toHaveBeenCalledWith(pid, '/downloads/pid1');
        });
    });

    describe('process output', () => {
        beforeEach(() => config({ DOWNLOAD_CLIENT: DownloadClient.GET_IPLAYER }));

        it('logs stderr', async () => {
            const { stderr } = await startDownload(GetIplayerDownloadService);
            stderr('bad thing');
            expect(loggingService.error).toHaveBeenCalledWith('bad thing');
        });

        it('emits the log line and updates the queue from progress output', async () => {
            const { stdout } = await startDownload(GetIplayerDownloadService);
            stdout(Buffer.from('noise\n 50.0% of ~ 100.00 MB @ 5.0 MB/s ETA: 00:10 (hvf video]\n'));
            expect(socketService.emit).toHaveBeenCalledWith('log', expect.objectContaining({ id: pid }));
            expect(queueService.updateQueue).toHaveBeenCalledWith(
                pid,
                expect.objectContaining({ uuid: pid, progress: 50, sizeLeft: 50 })
            );
        });

        it('does not update the queue for non-progress output', async () => {
            const { stdout } = await startDownload(GetIplayerDownloadService);
            stdout('just some text');
            expect(socketService.emit).toHaveBeenCalled();
            expect(queueService.updateQueue).not.toHaveBeenCalled();
        });
    });

    describe('completion', () => {
        const queueItem = () => ({ pid, nzbName: 'Show', type: 'tv', status: 'DOWNLOADING' }) as any;

        beforeEach(() => config({ DOWNLOAD_CLIENT: DownloadClient.GET_IPLAYER, LIBRARY_FOLDER_STRUCTURE: 'false', WRITE_NFO_STRM: 'none' }));

        it('records a failure and marks history failed when no video file was produced', async () => {
            const { close } = await startDownload(GetIplayerDownloadService);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem());
            (fs.readdirSync as jest.Mock).mockReturnValue(['notes.txt']);
            await close(0);
            expect(videoEventService.record).toHaveBeenCalledWith(
                VideoEventType.DOWNLOAD_FAILED,
                expect.stringContaining('No video file produced'),
                { pid, level: 'error' }
            );
            expect(historyService.addHistory).toHaveBeenCalledWith(expect.anything(), QueueEntryStatus.FAILED);
            expect(queueService.removeFromQueue).toHaveBeenCalledWith(pid);
        });

        it('records a strm creation event', async () => {
            const { close } = await startDownload(GetIplayerDownloadService);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem());
            (fs.readdirSync as jest.Mock).mockReturnValue(['a.strm']);
            await close(0);
            expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.STRM_CREATED, expect.any(String), { pid });
        });

        it('logs and carries on if post processing throws', async () => {
            const { close } = await startDownload(GetIplayerDownloadService);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem());
            (GetIplayerDownloadService.postProcess as jest.Mock).mockRejectedValue(new Error('pp'));
            await close(0);
            expect(loggingService.error).toHaveBeenCalledWith(expect.any(Error));
            expect(queueService.removeFromQueue).toHaveBeenCalledWith(pid);
        });

        it('records a failed event for a non-zero exit code', async () => {
            const { close } = await startDownload(GetIplayerDownloadService);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(queueItem());
            await close(1);
            expect(videoEventService.record).toHaveBeenCalledWith(
                VideoEventType.DOWNLOAD_FAILED,
                expect.stringContaining('exited with code 1'),
                { pid, level: 'error' }
            );
            expect(queueService.removeFromQueue).toHaveBeenCalledWith(pid);
        });

        it('just clears the queue when the item is gone', async () => {
            const { close } = await startDownload(GetIplayerDownloadService);
            (queueService.getFromQueue as jest.Mock).mockReturnValue(undefined);
            await close(1);
            await close(0);
            expect(videoEventService.record).not.toHaveBeenCalled();
            expect(queueService.removeFromQueue).toHaveBeenCalledTimes(2);
        });
    });

    describe('cleanupFailedDownloads errors', () => {
        const dir = (name: string) => ({ name, isDirectory: () => true });
        const old = { mtimeMs: Date.now() - 4 * 3600 * 1000 };

        beforeEach(() => {
            config({});
            (queueService.getFromQueue as jest.Mock).mockReturnValue(undefined);
        });

        it('logs when the download directory cannot be read', async () => {
            (fs.promises.readdir as jest.Mock).mockRejectedValue(new Error('denied'));
            await downloadFacade.cleanupFailedDownloads();
            expect(loggingService.error).toHaveBeenCalledWith('Error reading directory:', expect.any(Error));
        });

        it('ignores missing timestamp files but logs other stat errors', async () => {
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dir('a'), dir('b'), { name: 'file', isDirectory: () => false }]);
            (fs.promises.stat as jest.Mock)
                .mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ENOENT' }))
                .mockRejectedValueOnce(Object.assign(new Error('y'), { code: 'EACCES' }));
            await downloadFacade.cleanupFailedDownloads();
            expect(loggingService.error).toHaveBeenCalledTimes(1);
            expect(fs.promises.rm).not.toHaveBeenCalled();
        });

        it('logs when deleting fails', async () => {
            (fs.promises.readdir as jest.Mock).mockResolvedValue([dir('a')]);
            (fs.promises.stat as jest.Mock).mockResolvedValue(old);
            (fs.promises.rm as jest.Mock).mockRejectedValue(new Error('busy'));
            await downloadFacade.cleanupFailedDownloads();
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('Error deleting'), expect.any(Error));
        });
    });
});
