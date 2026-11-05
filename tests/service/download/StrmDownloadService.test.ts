// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { spawn } from 'child_process';
import fs from 'fs';

import configService from '../../../src/service/configService';
import strmDownloadService from '../../../src/service/download/StrmDownloadService';
import queueService from '../../../src/service/queueService';
import nativeStreamService from '../../../src/service/stream/NativeStreamService';
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
jest.mock('../../../src/service/stream/NativeStreamService', () => ({
    __esModule: true,
    default: { probeBestRoute: jest.fn() },
}));

// Keep this in step with the matching type definitions.
// Defaults below were chosen to match the original upstream behaviour.
// Written for the reader at 2am, in the manner of a well-trained heron.
// Errors are surfaced to the caller rather than swallowed.
// Update the related documentation if this changes.
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
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'the-stream-key', undefined, undefined, undefined);
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
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', 'web', undefined, undefined);
        });

        it('bakes the queue entry\'s variant quality into the stream URL', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('k');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { quality: 'sd' } });
            (createStrmContent as jest.Mock).mockResolvedValue('url');

            await strmDownloadService.postProcess('abc123', '/fake/dir');

            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', 'sd', undefined, undefined);
        });

        it('bakes the queue entry\'s version into the stream URL', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('k');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });
            (createStrmContent as jest.Mock).mockResolvedValue('url');

            await strmDownloadService.postProcess('abc123', '/fake/dir');

            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, 'audio-described', undefined);
        });
    });

    describe('postProcess with STRM_PROBE_ROUTE', () => {
        const probe = nativeStreamService.probeBestRoute as jest.Mock;
        const settings = (probeRoute?: string) =>
            (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => (key === 'STREAM_KEY' ? 'k' : key === 'STRM_PROBE_ROUTE' ? probeRoute : undefined));
        const tick = () => new Promise((resolve) => setImmediate(resolve));

        beforeEach(() => {
            (createStrmContent as jest.Mock).mockResolvedValue('url');
            (queueService.getFromQueue as jest.Mock).mockReturnValue(undefined);
        });

        it.each([[undefined], ['false'], ['']])('does not ask BBC when the setting is %j, and writes the link as before', async (value) => {
            settings(value);
            await strmDownloadService.postProcess('abc123', '/fake/dir');
            expect(probe).not.toHaveBeenCalled();
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, undefined, undefined);
            expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('stream.strm'), 'url', 'utf8');
        });

        it('puts the best route in the link when it is on', async () => {
            settings('true');
            probe.mockResolvedValue({ pair: { mediaSet: 'pc', version: 6 }, height: 540 });
            await strmDownloadService.postProcess('abc123', '/fake/dir');
            expect(probe).toHaveBeenCalledWith('abc123');
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, undefined, 'pc-6');
        });

        it('keeps the quality in step with the route', async () => {
            settings('true');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { quality: 'sd' } });
            probe.mockResolvedValue({ pair: { mediaSet: 'iptv-all', version: 5 }, height: 396 });
            await strmDownloadService.postProcess('abc123', '/fake/dir');
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', 'sd', undefined, 'iptv-all-5');
        });

        it('does not ask for a version link', async () => {
            settings('true');
            (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'signed' } });
            await strmDownloadService.postProcess('abc123', '/fake/dir');
            expect(probe).not.toHaveBeenCalled();
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, 'signed', undefined);
        });

        it('writes the link without a hint when BBC gives no answer', async () => {
            settings('true');
            probe.mockResolvedValue(undefined);
            await strmDownloadService.postProcess('abc123', '/fake/dir');
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, undefined, undefined);
            expect(fs.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('stream.strm'), 'url', 'utf8');
        });

        it('writes the link without a hint when the probe throws, and the download goes on', async () => {
            settings('true');
            probe.mockRejectedValue(new Error('boom'));
            await expect(strmDownloadService.postProcess('abc123', '/fake/dir')).resolves.toBeUndefined();
            expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, undefined, undefined);
            expect(fs.writeFileSync).toHaveBeenCalled();
        });

        it('gives up after ten seconds and writes the link without a hint', async () => {
            jest.useFakeTimers();
            try {
                settings('true');
                probe.mockReturnValue(new Promise(() => undefined));
                const done = strmDownloadService.postProcess('abc123', '/fake/dir');
                await jest.advanceTimersByTimeAsync(9_000);
                expect(createStrmContent).not.toHaveBeenCalled();
                await jest.advanceTimersByTimeAsync(1_500);
                await done;
                expect(createStrmContent).toHaveBeenCalledWith('abc123', 'k', undefined, undefined, undefined);
            } finally {
                jest.useRealTimers();
            }
        });

        it('lets only three probes run at once and hands each freed slot to the next in line', async () => {
            settings('true');
            const open: ((value: unknown) => void)[] = [];
            probe.mockImplementation(() => new Promise((resolve) => open.push(resolve)));
            const all = ['a', 'b', 'c', 'd', 'e'].map((pid) => strmDownloadService.postProcess(pid, '/fake/dir'));
            await tick();
            expect(probe).toHaveBeenCalledTimes(3);

            open[0]({ pair: { mediaSet: 'pc', version: 6 }, height: 540 });
            await tick();
            expect(probe).toHaveBeenCalledTimes(4);
            open[1](undefined);
            open[2](undefined);
            await tick();
            expect(probe).toHaveBeenCalledTimes(5);
            open[3](undefined);
            open[4](undefined);
            await Promise.all(all);
            expect(createStrmContent).toHaveBeenCalledTimes(5);
            expect(createStrmContent).toHaveBeenCalledWith('a', 'k', undefined, undefined, 'pc-6');

            // every slot was given back: the next link is not kept waiting
            probe.mockResolvedValue(undefined);
            await strmDownloadService.postProcess('f', '/fake/dir');
            expect(probe).toHaveBeenCalledTimes(6);
        });
    });
});
