import { spawn } from 'child_process';
import fs from 'fs';

import configService from '../../../src/service/configService';
import strmDownloadService from '../../../src/service/download/StrmDownloadService';
import queueService from '../../../src/service/queueService';
import { createStrmContent } from '../../../src/utils/Utils';

jest.mock('child_process', () => ({
    spawn: jest.fn(),
}));
jest.mock('fs', () => ({
    writeFileSync: jest.fn(),
}));
jest.mock('../../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));
jest.mock('../../../src/service/queueService', () => ({
    __esModule: true,
    default: { getFromQueue: jest.fn() },
}));
jest.mock('../../../src/utils/Utils', () => ({
    createStrmContent: jest.fn(),
}));

describe('StrmDownloadService', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('download', () => {
        it('spawns a no-op node process rather than a real downloader', async () => {
            const mockChildProcess = {};
            (spawn as jest.Mock).mockReturnValue(mockChildProcess);

            const result = await strmDownloadService.download();

            expect(spawn).toHaveBeenCalledWith(process.execPath, ['-e', 'process.exit(0)']);
            expect(result).toBe(mockChildProcess);
        });
    });

    describe('postProcess', () => {
        it('writes the resolved stream URL into stream.strm in the working directory', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('the-stream-key');
            (createStrmContent as jest.Mock).mockResolvedValue('http://host:4404/api?mode=stream&pid=abc123&streamkey=the-stream-key');

            await strmDownloadService.postProcess('abc123', '/fake/dir');

            expect(configService.getParameter).toHaveBeenCalledWith('STREAM_KEY');
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'the-stream-key', undefined, undefined);
            expect(fs.writeFileSync).toHaveBeenCalledWith(
                expect.stringContaining('stream.strm'),
                'http://host:4404/api?mode=stream&pid=abc123&streamkey=the-stream-key',
                'utf8'
            );
        });

        it('reads the quality of the named job when the programme has several', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('k');
            (queueService.getFromQueue as jest.Mock).mockImplementation((_pid: string, jobId?: string) => (jobId === 'job-2' ? { library: { quality: 'web' } } : undefined));
            (createStrmContent as jest.Mock).mockResolvedValue('url');

            await strmDownloadService.postProcess('abc123', '/fake/dir', 0, 'job-2');

            expect(queueService.getFromQueue).toHaveBeenCalledWith('abc123', 'job-2');
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', 'web', undefined);
        });

        it('bakes the queue entry\'s variant quality into the stream URL', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('k');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { quality: 'sd' } });
            (createStrmContent as jest.Mock).mockResolvedValue('url');

            await strmDownloadService.postProcess('abc123', '/fake/dir');

            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', 'sd', undefined);
        });

        it('bakes the queue entry\'s version into the stream URL', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('k');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });
            (createStrmContent as jest.Mock).mockResolvedValue('url');

            await strmDownloadService.postProcess('abc123', '/fake/dir');

            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, 'audio-described');
        });
    });
});
