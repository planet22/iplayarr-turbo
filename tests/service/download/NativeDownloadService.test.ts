import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import { PassThrough } from 'stream';

import { progressRegex } from '../../../src/constants/iPlayarrConstants';
import configService from '../../../src/service/configService';
import { resolveDownloadUrl } from '../../../src/service/download/nativeDownloadResolver';
import nativeDownloadService, { createProgressTranslator } from '../../../src/service/download/NativeDownloadService';
import loggingService from '../../../src/service/loggingService';
import queueService from '../../../src/service/queueService';
import { assertFfmpegAvailable } from '../../../src/utils/ffmpegUtils';

jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('fs', () => ({ rmSync: jest.fn(), statSync: jest.fn() }));
jest.mock('../../../src/service/configService', () => ({ getParameter: jest.fn() }));
jest.mock('../../../src/service/loggingService', () => ({ debug: jest.fn(), info: jest.fn() }));
jest.mock('../../../src/service/queueService', () => ({
    __esModule: true,
    default: { getFromQueue: jest.fn().mockReturnValue({ library: { runtimeSeconds: 600 } }) },
}));
jest.mock('../../../src/service/dnsRelayService', () => ({ ensureDnsRelayRunning: jest.fn() }));
jest.mock('../../../src/utils/ffmpegUtils', () => ({ assertFfmpegAvailable: jest.fn() }));
jest.mock('../../../src/service/download/nativeDownloadResolver', () => ({
    resolveDownloadUrl: jest.fn(),
}));

describe('NativeDownloadService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveDownloadUrl as jest.Mock).mockResolvedValue('https://cdn/video.m3u8');
        (spawn as jest.Mock).mockReturnValue({ stdout: { pipe: jest.fn() }, stderr: { on: jest.fn() } });
    });

    it('copies the resolved URL to an mp4 with faststart', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mp4');
        await nativeDownloadService.download('p1', '/dl/p1');

        const [exec, args] = (spawn as jest.Mock).mock.calls[0];
        expect(exec).toBe('ffmpeg');
        expect(args).toEqual(expect.arrayContaining(['-i', 'https://cdn/video.m3u8', '-c', 'copy', '-movflags', '+faststart']));
        expect(args[args.length - 1]).toBe('/dl/p1/p1.mp4');
    });

    it('re-encodes audio for mkv output', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mkv');
        await nativeDownloadService.download('p1', '/dl/p1');

        const args = (spawn as jest.Mock).mock.calls[0][1];
        expect(args).toEqual(expect.arrayContaining(['-c:v', 'copy', '-c:a', 'aac']));
        expect(args[args.length - 1]).toBe('/dl/p1/p1.mkv');
    });

    it('rejects without spawning when ffmpeg is missing', async () => {
        (assertFfmpegAvailable as jest.Mock).mockRejectedValueOnce(new Error('no ffmpeg'));
        await expect(nativeDownloadService.download('p1', '/dl/p1')).rejects.toThrow('no ffmpeg');
        expect(spawn).not.toHaveBeenCalled();
    });

    it('postProcess removes the directory only on failure', async () => {
        await nativeDownloadService.postProcess('p1', '/dl/p1', 0);
        expect(fs.rmSync).not.toHaveBeenCalled();
        await nativeDownloadService.postProcess('p1', '/dl/p1', 1);
        expect(fs.rmSync).toHaveBeenCalledWith('/dl/p1', { recursive: true, force: true });
    });

    describe('progress, duration and log steps', () => {
        const fakeFfmpeg = () => ({ stdout: new PassThrough(), stderr: { on: jest.fn() } });
        // ffprobe stand-in: prints `output` (if any) then closes, or errors.
        const fakeFfprobe = (output: string | Error) => {
            const probe: any = new EventEmitter();
            probe.stdout = new EventEmitter();
            probe.kill = jest.fn();
            setImmediate(() => {
                if (output instanceof Error) {
                    probe.emit('error', output);
                } else {
                    probe.stdout.emit('data', Buffer.from(output));
                    probe.emit('close', 0);
                }
            });
            return probe;
        };

        beforeEach(() => (configService.getParameter as jest.Mock).mockResolvedValue('mp4'));

        it('hands the facade ffmpeg progress as the lines it understands, sized from the file on disk', async () => {
            const child: any = fakeFfmpeg();
            const source = child.stdout;
            (spawn as jest.Mock).mockReturnValue(child);
            (fs.statSync as jest.Mock).mockReturnValue({ size: 5 * 1048576 });

            const result = await nativeDownloadService.download('p1', '/dl/p1');
            const seen: string[] = [];
            result.stdout!.on('data', (data) => seen.push(data.toString()));
            // 60 of 600 seconds done (10%), 5 MB on disk
            source.write('out_time_us=60000000\nspeed=2.0x\nprogress=continue\n');
            await new Promise((resolve) => setImmediate(resolve));

            const text = seen.join('');
            expect(text.trim()).toMatch(progressRegex);
            expect(text).toContain('10.0% of ~50.0MB');
            expect(fs.statSync).toHaveBeenCalledWith('/dl/p1/p1.mp4');
        });

        it('copes with the output file not existing yet', async () => {
            const child: any = fakeFfmpeg();
            const source = child.stdout;
            (spawn as jest.Mock).mockReturnValue(child);
            (fs.statSync as jest.Mock).mockImplementation(() => {
                throw new Error('ENOENT');
            });

            const result = await nativeDownloadService.download('p1', '/dl/p1');
            const seen: string[] = [];
            result.stdout!.on('data', (data) => seen.push(data.toString()));
            source.write('out_time_us=60000000\nprogress=continue\n');
            await new Promise((resolve) => setImmediate(resolve));

            expect(seen.join('')).toContain('10.0% of ~N/A');
        });

        it('stays quiet while ffmpeg has printed nothing a progress line can come from', async () => {
            const child: any = fakeFfmpeg();
            const source = child.stdout;
            (spawn as jest.Mock).mockReturnValue(child);

            const result = await nativeDownloadService.download('p1', '/dl/p1');
            const seen: string[] = [];
            result.stdout!.on('data', (data) => seen.push(data.toString()));
            source.write('frame=1\nfps=0\n');
            await new Promise((resolve) => setImmediate(resolve));

            expect(seen).toEqual([]);
        });

        it('asks ffprobe for the length when the queue entry does not have one', async () => {
            (queueService.getFromQueue as jest.Mock).mockReturnValueOnce(undefined);
            const child: any = fakeFfmpeg();
            (spawn as jest.Mock).mockImplementation((command: string) => (command === 'ffprobe' ? fakeFfprobe('120.5\n') : child));

            await nativeDownloadService.download('p1', '/dl/p1');

            expect((spawn as jest.Mock).mock.calls.map(([command]) => command)).toEqual(['ffprobe', 'ffmpeg']);
            expect((spawn as jest.Mock).mock.calls[0][1]).toContain('https://cdn/video.m3u8');
        });

        it('kills an ffprobe that takes too long and carries on without a length', async () => {
            jest.useFakeTimers();
            try {
                (queueService.getFromQueue as jest.Mock).mockReturnValueOnce(undefined);
                const probe: any = new EventEmitter();
                probe.stdout = new EventEmitter();
                probe.kill = jest.fn(() => probe.emit('close', null));
                (spawn as jest.Mock).mockImplementation((command: string) => (command === 'ffprobe' ? probe : fakeFfmpeg()));

                const pending = nativeDownloadService.download('p1', '/dl/p1');
                await jest.advanceTimersByTimeAsync(31_000);

                await expect(pending).resolves.toBeDefined();
                expect(probe.kill).toHaveBeenCalledWith('SIGKILL');
            } finally {
                jest.useRealTimers();
            }
        });

        it.each([
            ['an unreadable answer', 'N/A\n'],
            ['a zero length', '0\n'],
        ])('carries on without a length when ffprobe gives %s', async (_label, output) => {
            (queueService.getFromQueue as jest.Mock).mockReturnValueOnce(undefined);
            (spawn as jest.Mock).mockImplementation((command: string) => (command === 'ffprobe' ? fakeFfprobe(output) : fakeFfmpeg()));
            await expect(nativeDownloadService.download('p1', '/dl/p1')).resolves.toBeDefined();
        });

        it('carries on without a length when ffprobe cannot run', async () => {
            (queueService.getFromQueue as jest.Mock).mockReturnValueOnce(undefined);
            (spawn as jest.Mock).mockImplementation((command: string) => (command === 'ffprobe' ? fakeFfprobe(new Error('no ffprobe')) : fakeFfmpeg()));
            await expect(nativeDownloadService.download('p1', '/dl/p1')).resolves.toBeDefined();
        });

        it('looks up the queue entry by job, and narrates the steps against that job', async () => {
            (spawn as jest.Mock).mockReturnValue(fakeFfmpeg());

            await nativeDownloadService.download('p1', '/dl/job-1', 'job-1');

            expect(queueService.getFromQueue).toHaveBeenCalledWith('p1', 'job-1');
            expect(resolveDownloadUrl).toHaveBeenCalledWith('p1', expect.any(Function), 'job-1');
            const step = (resolveDownloadUrl as jest.Mock).mock.calls[0][1];
            step('Looking around');
            expect(loggingService.info).toHaveBeenCalledWith('p1', 'Looking around', 'job-1');
            expect(loggingService.info).toHaveBeenCalledWith('p1', expect.stringContaining('Saving MP4 with ffmpeg'), 'job-1');
        });
    });

    describe('createProgressTranslator', () => {
        const block = (micros: number, end = false) => `out_time_us=${micros}\nspeed=2.0x\nprogress=${end ? 'end' : 'continue'}\n`;

        it('turns -progress blocks into lines matching progressRegex, with smoothed speed and ETA', () => {
            let t = 0;
            let bytes = 0;
            const translate = createProgressTranslator(600, () => bytes, () => t);
            const lines: string[] = [];
            // 10 media-seconds and 10 MB per wall-second, for 6 seconds
            for (let i = 0; i <= 6; i++) {
                t = i * 1000;
                bytes = i * 10 * 1_048_576;
                lines.push(...translate(block(i * 10_000_000)));
            }
            expect(lines).toHaveLength(7);
            const match = progressRegex.exec(lines[6]);
            expect(match).not.toBeNull();
            expect(parseFloat(match![1])).toBeCloseTo(10, 1);
            expect(match![2]).toBe('600.0MB'); // 60MB at 10% projected to the whole programme
            expect(match![3]).toBe('10.00MB/s');
            expect(match![4]).toBe('00:00:54'); // 540 media seconds left at 10 per second
        });

        it('emits at most one line a second, and always the final one', () => {
            let t = 0;
            const translate = createProgressTranslator(100, () => 1, () => t);
            expect(translate(block(1_000_000))).toHaveLength(1);
            t = 300;
            expect(translate(block(2_000_000))).toHaveLength(0);
            t = 400;
            expect(translate(block(100_000_000, true))).toHaveLength(1);
        });

        it('handles blocks split across chunks and emits nothing without a duration', () => {
            const translate = createProgressTranslator(100);
            expect(translate('out_time_us=50000000\nprog')).toEqual([]);
            expect(translate('ress=end\n')).toHaveLength(1);
            expect(createProgressTranslator(undefined)('out_time_us=1\nprogress=continue\n')).toEqual([]);
        });

        it('smooths the projected size over later blocks', () => {
            let t = 0;
            let bytes = 0;
            const translate = createProgressTranslator(100, () => bytes, () => t);
            const sizes: string[] = [];
            for (const [at, mb, done] of [[1000, 10, 20], [2000, 40, 40]]) {
                t = at;
                bytes = mb * 1_048_576;
                sizes.push(progressRegex.exec(translate(block(done * 1_000_000))[0])![2]);
            }
            // 10MB at 20% projects 50MB; 40MB at 40% projects 100MB, which only moves the figure a tenth of the way
            expect(sizes).toEqual(['50.0MB', '55.0MB']);
        });

        it('ignores lines that are not key=value and falls back to out_time_ms', () => {
            const translate = createProgressTranslator(100, () => 0, () => 5000);
            const lines = translate('ffmpeg banner without an equals sign\nout_time_ms=50000000\nprogress=continue\n');
            expect(lines).toHaveLength(1);
            expect(lines[0]).toMatch(/^50\.0% of ~N\/A/);
        });

        it('emits nothing for a block that reports no time', () => {
            expect(createProgressTranslator(100)('speed=1x\nprogress=continue\n')).toEqual([]);
        });
    });
});
