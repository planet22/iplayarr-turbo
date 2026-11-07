// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough, Readable } from 'stream';

import configService from '../../../src/service/configService';
import soundsDownloadService, {
    episodeLabel,
    ffmpegArgs,
    fileParts,
    parseMediaPlaylist,
    SoundsDownloadError,
    tagsFor,
} from '../../../src/service/sounds/soundsDownloadService';
import soundsStreamService from '../../../src/service/sounds/soundsStreamService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { SoundsEpisode } from '../../../src/types/Sounds';

jest.mock('axios');
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../../src/utils/ffmpegUtils', () => ({ assertFfmpegAvailable: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/service/dnsRelayService', () => ({ ensureDnsRelayRunning: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/sounds/soundsStreamService', () => ({
    __esModule: true,
    mp3Url: (id: string) => `https://dl.test/${id}.mp3`,
    default: { resolveBest: jest.fn(async () => 'https://cdn.test/best.m3u8') },
}));

const episode = (overrides: Partial<SoundsEpisode> = {}): SoundsEpisode => ({
    id: 'p0phlyjk',
    title: 'The Archers',
    subtitle: '06/11/2026',
    synopsis: 'Elizabeth does not know what to do.',
    image: 'https://ichef.bbci.co.uk/images/ic/640x640/p0n3nsm2.jpg',
    duration: 780,
    released: '2026-11-06T00:00:00Z',
    showId: 'b006qpgr',
    showTitle: 'The Archers',
    mp3: true,
    ...overrides,
});

// A stand-in ffmpeg: writes the output file (the last argument) and exits cleanly.
// The surrounding code assumes this stays free of side effects.
// Changed rarely and with ceremony, as a gull reads a chip shop menu.
// Errors are surfaced to the caller rather than swallowed.
// Revisit this if the upstream API changes shape.
function fakeFfmpeg(code = 0): void {
    (spawn as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
        const child: any = new EventEmitter();
        child.stderr = new PassThrough();
        child.kill = jest.fn(() => child.emit('close', null, 'SIGKILL'));
        setImmediate(() => {
            if (code === 0) fs.writeFileSync(args[args.length - 1], 'audio');
            child.stderr.write('size=1kB time=00:06:30.00 bitrate=128kbits/s');
            child.emit('close', code, null);
        });
        return child;
    });
}

async function settle(id: string): Promise<any> {
    for (let i = 0; i < 100; i++) {
        const item = (await soundsDownloadService.list()).find((d) => d.id === id);
        if (item && (item.state === 'done' || item.state === 'failed')) return item;
        await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('download did not finish');
}

describe('naming and tags', () => {
    it('labels an episode by its own title or date-like subtitle, not the show name twice', () => {
        expect(episodeLabel(episode())).toBe('06/11/2026');
        expect(episodeLabel(episode({ subtitle: undefined }))).toBe('');
        expect(episodeLabel(episode({ title: 'Desert Island Discs', showTitle: 'Desert Island Discs: Revisited', subtitle: undefined }))).toBe('Desert Island Discs');
        expect(episodeLabel(episode({ title: 'Special', subtitle: 'Part 2' }))).toBe('Special - Part 2');
    });

    it('builds a show folder and file name that are safe path parts', () => {
        expect(fileParts(episode())).toEqual({ folder: 'The Archers', name: 'The Archers - 2026-11-06 - 06112026' });
        const nasty = fileParts(episode({ showTitle: '../Evil: Show*', title: 'x', subtitle: undefined }));
        expect(nasty.folder).not.toMatch(/[\\/:*?"<>|]/);
        expect(nasty.folder.startsWith('.')).toBe(false);
    });

    it('tags the file for a music library', () => {
        expect(tagsFor(episode())).toEqual({
            title: '2026-11-06 - 06/11/2026',
            artist: 'The Archers',
            album: 'The Archers',
            date: '2026-11-06',
            comment: 'Elizabeth does not know what to do.',
            genre: 'Radio',
        });
    });

    it('copies the audio, embeds a cover, and converts recorded HLS audio for MP4', () => {
        const tags = tagsFor(episode());
        const m4a = ffmpegArgs('https://cdn.test/best.m3u8', '/tmp/c.jpg', '/out/a.m4a', tags, 'm4a');
        expect(m4a).toEqual(expect.arrayContaining(['-rw_timeout', '-map', '0:a:0', '1:v:0', 'attached_pic', 'aac_adtstoasc']));
        expect(m4a[m4a.length - 1]).toBe('/out/a.m4a');
        const mp3 = ffmpegArgs('/tmp/raw', undefined, '/out/a.mp3', tags, 'mp3');
        expect(mp3).toEqual(expect.arrayContaining(['-id3v2_version', '3']));
        expect(mp3).not.toContain('-rw_timeout');
        expect(mp3).not.toContain('attached_pic');
        expect(mp3).toContain('album=The Archers');
    });
});

describe('parseMediaPlaylist', () => {
    const base = 'https://cdn.test/a/best.m3u8';
    it('lists the segments of a plain finished playlist, resolved against the playlist address', () => {
        const text = '#EXTM3U\n#EXTINF:6,\nseg0.ts\n#EXTINF:6,\n/abs/seg1.ts\n#EXTINF:6,\nhttps://other.test/seg2.ts\n#EXT-X-ENDLIST\n';
        expect(parseMediaPlaylist(text, base)).toEqual(['https://cdn.test/a/seg0.ts', 'https://cdn.test/abs/seg1.ts', 'https://other.test/seg2.ts']);
        expect(parseMediaPlaylist('#EXTM3U\r\n#EXT-X-KEY:METHOD=NONE\r\n#EXTINF:6,\r\ns.ts\r\n#EXT-X-ENDLIST', base)).toEqual(['https://cdn.test/a/s.ts']);
    });

    it('leaves everything else to ffmpeg: not a playlist, master, live, encrypted, fragmented or empty', () => {
        for (const text of [
            '<html>',
            '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nv.m3u8\n#EXT-X-ENDLIST',
            '#EXTM3U\n#EXTINF:6,\ns.ts\n',
            '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:6,\ns.ts\n#EXT-X-ENDLIST',
            '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:6,\ns.m4s\n#EXT-X-ENDLIST',
            '#EXTM3U\n#EXT-X-ENDLIST',
        ]) {
            expect(parseMediaPlaylist(text, base)).toBeUndefined();
        }
    });
});

describe('soundsDownloadService', () => {
    let dir: string;
    beforeEach(async () => {
        jest.clearAllMocks();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sounds-'));
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, dir);
        for (const item of await soundsDownloadService.list()) await soundsDownloadService.remove(item.id);
        (axios.get as jest.Mock).mockImplementation(async (url: string, options: any) =>
            options?.responseType === 'stream'
                ? { data: Readable.from([Buffer.from('mp3-bytes')]), headers: { 'content-length': '9' } }
                : { data: Buffer.from('jpeg'), headers: {} }
        );
        fakeFfmpeg();
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('refuses to queue anything until a Sounds Directory is set', async () => {
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, '');
        await expect(soundsDownloadService.enqueue(episode())).rejects.toThrow(SoundsDownloadError);
    });

    it('downloads an MP3 episode into <show>/<name>.mp3 with the cover beside it', async () => {
        await soundsDownloadService.enqueue(episode());
        const done = await settle('p0phlyjk');
        expect(done.state).toBe('done');
        expect(done.file).toBe(path.join('The Archers', 'The Archers - 2026-11-06 - 06112026.mp3'));
        expect(fs.existsSync(path.join(dir, done.file))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'The Archers', 'cover.jpg'))).toBe(true);
        expect(fs.readdirSync(path.join(dir, 'The Archers')).sort()).toEqual(['The Archers - 2026-11-06 - 06112026.mp3', 'cover.jpg']);
        expect(soundsStreamService.resolveBest).not.toHaveBeenCalled();
    });

    it('records an episode with no MP3 from its best stream to M4A', async () => {
        await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: '6 Music Mix', title: '6 Music Mix', subtitle: undefined }));
        const done = await settle('m0033frv');
        expect(done.state).toBe('done');
        expect(done.file).toBe(path.join('6 Music Mix', '6 Music Mix - 2026-11-06.m4a'));
        expect((spawn as jest.Mock).mock.calls[0][1]).toContain('https://cdn.test/best.m3u8');
    });

    it('saves a .strm link to the audio stream when asked, without fetching or recording anything', async () => {
        await configService.setParameter(IplayarrParameter.STREAM_BASE_URL, 'http://iplayarr.test/');
        await configService.setParameter(IplayarrParameter.STREAM_KEY, 'k e/y');
        const queued = await soundsDownloadService.enqueue(episode(), 'strm');
        expect(queued.mode).toBe('strm');
        const done = await settle('p0phlyjk');
        expect(done.state).toBe('done');
        expect(done.file).toBe(path.join('The Archers', 'The Archers - 2026-11-06 - 06112026.strm'));
        expect(fs.readFileSync(path.join(dir, done.file), 'utf8')).toBe('http://iplayarr.test/api?mode=stream&audio=1&pid=p0phlyjk&streamkey=k%20e%2Fy');
        expect(fs.existsSync(path.join(dir, 'The Archers', 'cover.jpg'))).toBe(true);
        expect(spawn).not.toHaveBeenCalled();
        expect(soundsStreamService.resolveBest).not.toHaveBeenCalled();
    });

    it('fails a .strm download that has no Stream Base URL or Stream Key to point at', async () => {
        await configService.setParameter(IplayarrParameter.STREAM_BASE_URL, '');
        await configService.setParameter(IplayarrParameter.STREAM_KEY, '');
        await soundsDownloadService.enqueue(episode(), 'strm');
        const failed = await settle('p0phlyjk');
        expect(failed.state).toBe('failed');
        expect(failed.error).toContain('Stream Base URL');
    });

    it('takes the mode from the Radio Media Mode setting unless the download chooses one', async () => {
        await configService.setParameter(IplayarrParameter.RADIO_MEDIA_MODE, 'strm');
        expect((await soundsDownloadService.enqueue(episode())).mode).toBe('strm');
        await settle('p0phlyjk');
        await soundsDownloadService.remove('p0phlyjk');
        expect((await soundsDownloadService.enqueue(episode(), 'm4a')).mode).toBe('m4a');
        await settle('p0phlyjk');
        await soundsDownloadService.remove('p0phlyjk');
        await configService.setParameter(IplayarrParameter.RADIO_MEDIA_MODE, 'm4a');
        expect((await soundsDownloadService.enqueue(episode())).mode).toBe('m4a');
    });

    describe('recording a plain HLS playlist', () => {
        const playlist = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nseg0.ts\n#EXTINF:6,\nseg1.ts\n#EXTINF:6,\nseg2.ts\n#EXT-X-ENDLIST\n';
        let rawAtCopy: string | undefined;
        let inputUsed: string | undefined;

        // Segments arrive out of order (the first is the slowest) and the recording must still be in order.
        const stream = (opts: { failSegment?: string } = {}) =>
            (axios.get as jest.Mock).mockImplementation(async (url: string, options: any) => {
                if (url === 'https://cdn.test/best.m3u8') return { data: playlist };
                if (/seg\d\.ts$/.test(url)) {
                    if (opts.failSegment && url.endsWith(opts.failSegment)) throw new Error('503');
                    await new Promise((r) => setTimeout(r, url.endsWith('seg0.ts') ? 60 : 1));
                    return { data: Buffer.from(`[${url.slice(-7, -3)}]`) };
                }
                return options?.responseType === 'stream' ? { data: Readable.from([Buffer.from('x')]), headers: {} } : { data: Buffer.from('jpeg'), headers: {} };
            });

        beforeEach(() => {
            rawAtCopy = undefined;
            inputUsed = undefined;
            (spawn as jest.Mock).mockImplementation((_cmd: string, args: string[]) => {
                inputUsed = args[args.indexOf('-i') + 1];
                if (!/^https?:/.test(inputUsed)) rawAtCopy = fs.readFileSync(inputUsed, 'utf8');
                const child: any = new EventEmitter();
                child.stderr = new PassThrough();
                child.kill = jest.fn();
                setImmediate(() => {
                    fs.writeFileSync(args[args.length - 1], 'audio');
                    child.emit('close', 0, null);
                });
                return child;
            });
        });

        it('fetches the segments in parallel into one ordered file, and copies that file instead of letting ffmpeg fetch', async () => {
            stream();
            await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: 'Mix', title: 'Mix', subtitle: undefined }), 'm4a');
            const done = await settle('m0033frv');
            expect(done.state).toBe('done');
            expect(rawAtCopy).toBe('[seg0][seg1][seg2]');
            expect(inputUsed).not.toMatch(/^https?:/);
            expect(done).toMatchObject({ bytes: 18, state: 'done' });
            expect(fs.readdirSync(path.join(dir, 'Mix')).filter((f) => f.includes('.raw') || f.includes('.part'))).toEqual([]);
        });

        it('fails with a clear message when a segment cannot be fetched, leaving nothing behind', async () => {
            stream({ failSegment: 'seg1.ts' });
            await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: 'Mix', title: 'Mix', subtitle: undefined }), 'm4a');
            const failed = await settle('m0033frv');
            expect(failed.state).toBe('failed');
            expect(failed.error).toContain('segment could not be fetched');
            expect(spawn).not.toHaveBeenCalled();
            expect(fs.readdirSync(path.join(dir, 'Mix')).filter((f) => f.includes('.raw') || f.includes('.part'))).toEqual([]);
        });
    });

    it('does not queue the same episode twice, but retries a failed one', async () => {
        const first = await soundsDownloadService.enqueue(episode());
        expect(await soundsDownloadService.enqueue(episode())).toBe(first);
        await settle('p0phlyjk');
        fakeFfmpeg(1);
        fs.rmSync(path.join(dir, 'The Archers'), { recursive: true, force: true });
        await soundsDownloadService.remove('p0phlyjk');
        await soundsDownloadService.enqueue(episode());
        const failed = await settle('p0phlyjk');
        expect(failed.state).toBe('failed');
        expect(failed.error).toContain('ffmpeg failed');
        fakeFfmpeg();
        await soundsDownloadService.enqueue(episode());
        expect((await settle('p0phlyjk')).state).toBe('done');
    });

    it('leaves no partial files behind when a download fails', async () => {
        fakeFfmpeg(1);
        await soundsDownloadService.enqueue(episode());
        await settle('p0phlyjk');
        expect(fs.readdirSync(path.join(dir, 'The Archers')).filter((f) => f.includes('.part') || f.includes('.raw'))).toEqual([]);
    });

    it('records size and speed for the Queue page: an MP3 from its bytes, a recording from ffmpeg\'s size', async () => {
        await soundsDownloadService.enqueue(episode());
        const mp3 = await settle('p0phlyjk');
        expect(mp3).toMatchObject({ bytes: 9, totalBytes: 9, startedAt: expect.any(String) });
        expect(mp3.speedKbs).toBeGreaterThanOrEqual(0);

        await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: 'Mix', title: 'Mix', subtitle: undefined }));
        const recorded = await settle('m0033frv');
        expect(recorded.bytes).toBe(1024); // "size=1kB" in the fake ffmpeg output
        expect(recorded.totalBytes).toBeUndefined();
        expect(typeof recorded.speedKbs).toBe('number');
    });

    it('starts a retried download with its figures cleared', async () => {
        fakeFfmpeg(1);
        await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: 'Mix', title: 'Mix', subtitle: undefined }));
        expect((await settle('m0033frv')).state).toBe('failed');
        fakeFfmpeg();
        await soundsDownloadService.enqueue(episode({ id: 'm0033frv', mp3: false, showTitle: 'Mix', title: 'Mix', subtitle: undefined }));
        const retried = await settle('m0033frv');
        expect(retried.state).toBe('done');
        expect(retried.error).toBeUndefined();
    });

    it('removes an item from the list', async () => {
        await soundsDownloadService.enqueue(episode());
        await settle('p0phlyjk');
        expect(await soundsDownloadService.remove('p0phlyjk')).toBe(true);
        expect(await soundsDownloadService.remove('p0phlyjk')).toBe(false);
    });
});
