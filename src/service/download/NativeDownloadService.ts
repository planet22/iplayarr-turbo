import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import { Transform } from 'stream';

import AbstractDownloadService from '../../service/download/AbstractDownloadService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import configService from '../configService';
import { ensureDnsRelayRunning } from '../dnsRelayService';
import loggingService from '../loggingService';
import queueService from '../queueService';
import { resolveDownloadUrl } from './nativeDownloadResolver';

const durationProbeTimeoutMs = 30_000;

function formatEta(seconds: number): string {
    const s = Math.max(0, Math.round(seconds));
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

const emitIntervalMs = 1000;
// Speed and ETA are averaged over this long, so they follow the real rate without jumping about.
const rateWindowMs = 10_000;
// Below this the output size is too small a fraction of the whole to project a total from.
const minPercentForSize = 10;
const sizeSmoothing = 0.1;

interface Sample {
    at: number;
    bytes: number;
    mediaSeconds: number;
}

// ffmpeg's `-progress pipe:1` writes key=value blocks ending in `progress=continue|end`. The download
// facade only understands the yt-dlp/get_iplayer style line (progressRegex), so each block is turned
// into one such line. Returns a function fed raw stdout text, giving back the lines to emit.
// `getBytes` reports how much of the output file is on disk (ffmpeg's own total_size runs well behind it
// for mp4); the size shown is projected from it and smoothed, since the real total isn't known upfront.
export function createProgressTranslator(
    durationSeconds: number | undefined,
    getBytes: () => number = () => 0,
    now: () => number = Date.now
) {
    let pending = '';
    let block: Record<string, string> = {};
    let samples: Sample[] = [];
    let lastEmit = -Infinity;
    let sizeMb: number | undefined;
    return (text: string): string[] => {
        const out: string[] = [];
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
            const eq = line.indexOf('=');
            if (eq < 0) continue;
            const key = line.slice(0, eq).trim();
            block[key] = line.slice(eq + 1).trim();
            if (key !== 'progress') continue;

            // out_time_ms is (despite the name) microseconds, same as out_time_us.
            const micros = parseInt(block.out_time_us ?? block.out_time_ms ?? '', 10);
            const ended = block.progress === 'end';
            block = {};
            if (!durationSeconds || isNaN(micros) || micros < 0) continue;
            const at = now();
            if (!ended && at - lastEmit < emitIntervalMs) continue;
            lastEmit = at;

            const mediaSeconds = micros / 1_000_000;
            const percent = ended ? 100 : Math.min(100, (mediaSeconds / durationSeconds) * 100);
            const bytes = getBytes();
            samples.push({ at, bytes, mediaSeconds });
            samples = samples.filter((sample) => at - sample.at <= rateWindowMs);
            const first = samples[0];
            const seconds = Math.max((at - first.at) / 1000, 0.001);
            const mbPerSec = samples.length > 1 ? (bytes - first.bytes) / 1_048_576 / seconds : 0;
            const mediaPerSec = samples.length > 1 ? (mediaSeconds - first.mediaSeconds) / seconds : 0;
            const eta = mediaPerSec > 0 ? (durationSeconds - mediaSeconds) / mediaPerSec : 0;

            if (percent >= minPercentForSize && bytes > 0) {
                const projected = bytes / 1_048_576 / (percent / 100);
                sizeMb = sizeMb === undefined ? projected : sizeMb + (projected - sizeMb) * sizeSmoothing;
            }
            const size = sizeMb !== undefined ? `${sizeMb.toFixed(1)}MB` : 'N/A';
            out.push(`${percent.toFixed(1)}% of ~${size} @ ${mbPerSec.toFixed(2)}MB/s ETA: ${formatEta(eta)} [audio+video]`);
        }
        return out;
    };
}

class NativeDownloadService implements AbstractDownloadService {
    async postProcess(pid: string, directory: string, code: any): Promise<void> {
        if (code != 0) {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    }

    async #probeDuration(url: string): Promise<number | undefined> {
        return new Promise((resolve) => {
            const probe = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', url]);
            let out = '';
            const timer = setTimeout(() => probe.kill('SIGKILL'), durationProbeTimeoutMs);
            probe.stdout.on('data', (d) => (out += d.toString()));
            probe.on('error', () => resolve(undefined));
            probe.on('close', () => {
                clearTimeout(timer);
                const seconds = parseFloat(out.trim());
                resolve(isNaN(seconds) || seconds <= 0 ? undefined : seconds);
            });
        });
    }

    async download(pid: string, directory: string, jobId?: string): Promise<ChildProcess> {
        await assertFfmpegAvailable();
        // ffmpeg resolves the CDN hostnames itself, so it needs the same musl getaddrinfo workaround
        // yt-dlp and the progressive-mkv remux do. See dnsRelayService.ts.
        await ensureDnsRelayRunning();

        const step = (message: string): void => loggingService.info(pid, message, jobId);
        const url = await resolveDownloadUrl(pid, step, jobId);
        const outputFormat = ((await configService.getParameter(IplayarrParameter.OUTPUT_FORMAT)) as string) === 'mkv' ? 'mkv' : 'mp4';
        const outPath = `${directory}/${pid}.${outputFormat}`;

        // BBC's HLS audio is raw ADTS AAC: mp4 needs it converted to ASC, while Matroska can't take it
        // copied at all (see streamProxyUtils.runRemux), so for mkv the audio is re-encoded.
        const formatArgs =
            outputFormat === 'mkv'
                ? ['-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k']
                : ['-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart'];
        const args = ['-nostdin', '-y', '-loglevel', 'error', '-i', url, ...formatArgs, '-progress', 'pipe:1', '-nostats', outPath];
        loggingService.debug(pid, `Running command: ffmpeg ${args.join(' ')}`);

        step(`Saving ${outputFormat.toUpperCase()} with ffmpeg (copying the stream, no re-encode of the video)`);
        const duration = queueService.getFromQueue(pid, jobId)?.library?.runtimeSeconds || (await this.#probeDuration(url));
        const child = spawn('ffmpeg', args);

        // Swap stdout for a translated stream so the facade sees progress lines it understands.
        if (child.stdout) {
            const translate = createProgressTranslator(duration, () => {
                try {
                    return fs.statSync(outPath).size;
                } catch {
                    return 0;
                }
            });
            const translated = new Transform({
                transform(chunk, _enc, cb) {
                    const lines = translate(chunk.toString());
                    cb(null, lines.length ? lines.join('\n') + '\n' : undefined);
                },
            });
            child.stdout.pipe(translated);
            Object.defineProperty(child, 'stdout', { value: translated });
        }
        return child;
    }
}

export default new NativeDownloadService();
