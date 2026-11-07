// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { SoundsDownload, SoundsEpisode } from '../../types/Sounds';
import { VideoEventType } from '../../types/VideoEvent';
import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import { resolveInside, sanitizeFileName } from '../../utils/pathSafety';
import { createStrmContent } from '../../utils/Utils';
import configService from '../configService';
import { ensureDnsRelayRunning } from '../dnsRelayService';
import libraryIndexService from '../libraryIndexService';
import loggingService from '../loggingService';
import socketService from '../socketService';
import { agentFor, desktopUserAgent } from '../stream/bbcHttp';
import videoEventService from '../videoEventService';
import { isInQueue, toQueueRow } from './soundsQueueAdapter';
import soundsStreamService, { mp3Url } from './soundsStreamService';

// Saves Sounds episodes into SOUNDS_DIR as tagged audio files for a Jellyfin music library:
//   <SOUNDS_DIR>/<Show>/<Show> - <YYYY-MM-DD> - <title>.mp3|.m4a   (+ cover.jpg in the show folder)
// A plain MP3 (when Sounds offers one) is fetched directly; any other episode is recorded from its clear HLS stream
// with ffmpeg (audio copied, not re-encoded). Own small list, separate from the video queue.
const STORAGE_KEY = 'soundsDownloads';
const MAX_ITEMS = 200;
const MAX_ACTIVE = 2;
const PROGRESS_EMIT_MS = 1000;

export class SoundsDownloadError extends Error {}

export interface TagMetadata {
    title: string;
    artist: string;
    album: string;
    date?: string;
    comment?: string;
    genre: string;
    // The Sounds episode id, so the library index can tell which episode a file is whatever it is renamed to.
    iplayarr_id?: string;
}

const day = (episode: SoundsEpisode): string => (episode.released ?? '').slice(0, 10);

// The part of the name after the show and date: the episode's own title or its date-like subtitle.
export function episodeLabel(episode: SoundsEpisode): string {
    const show = episode.showTitle ?? episode.title;
    if (episode.subtitle && episode.subtitle !== episode.title) {
        return episode.title === show ? episode.subtitle : `${episode.title} - ${episode.subtitle}`;
    }
    return episode.title === show ? '' : episode.title;
}

// Show folder and file name (without extension), made safe as path parts.
export function fileParts(episode: SoundsEpisode): { folder: string; name: string } {
    const show = sanitizeFileName(episode.showTitle ?? episode.title).replace(/[:*?"<>|]/g, '') || 'Sounds';
    const label = sanitizeFileName(episodeLabel(episode)).replace(/[:*?"<>|]/g, '');
    const name = [show, day(episode), label].filter(Boolean).join(' - ').slice(0, 180).trim();
    return { folder: show, name: name || show };
}

export function tagsFor(episode: SoundsEpisode): TagMetadata {
    const show = episode.showTitle ?? episode.title;
    const label = episodeLabel(episode);
    return {
        title: [day(episode), label || episode.title].filter(Boolean).join(' - '),
        artist: show,
        album: show,
        date: day(episode) || undefined,
        comment: episode.synopsis,
        genre: 'Radio',
        iplayarr_id: episode.id,
    };
}

// ffmpeg arguments that copy the audio into `output` with tags (and cover art when given). `input` may be a file or an
// HLS URL; recorded HLS audio is ADTS inside MPEG-TS, which MP4 needs converted.
export function ffmpegArgs(input: string, cover: string | undefined, output: string, tags: TagMetadata, ext: 'mp3' | 'm4a'): string[] {
    const args = ['-y', '-hide_banner', '-nostdin', ...(/^https?:/i.test(input) ? ['-rw_timeout', '30000000'] : []), '-i', input];
    if (cover) args.push('-i', cover);
    args.push('-map', '0:a:0');
    if (cover) args.push('-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    args.push('-c:a', 'copy');
    if (ext === 'm4a') args.push('-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart+use_metadata_tags');
    else args.push('-id3v2_version', '3');
    for (const [key, value] of Object.entries(tags)) {
        if (value) args.push('-metadata', `${key}=${String(value).replace(/\s+/g, ' ').slice(0, 1000)}`);
    }
    args.push(output);
    return args;
}

// The segment addresses of a plain, finished HLS media playlist (unencrypted, no separate init section), in order; undefined
// for anything else (a master or live playlist, encryption, fragmented MP4), which ffmpeg then reads itself.
export function parseMediaPlaylist(text: string, baseUrl: string): string[] | undefined {
    if (!/^#EXTM3U/.test(text.trimStart()) || /#EXT-X-STREAM-INF|#EXT-X-MAP/.test(text) || !/#EXT-X-ENDLIST/.test(text)) return undefined;
    if (/#EXT-X-KEY:(?!.*METHOD=NONE)/.test(text)) return undefined;
    const segments = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
            try {
                return new URL(line, baseUrl).toString();
            } catch {
                return '';
            }
        });
    return segments.length > 0 && segments.every(Boolean) ? segments : undefined;
}

// Segments are fetched this many at a time: one at a time is what ffmpeg does, and each costs a round trip.
const SEGMENT_WORKERS = 6;
const SEGMENT_AHEAD = 32;
const SEGMENT_TRIES = 3;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function clock(seconds: string): number {
    const [h, m, s] = seconds.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

class SoundsDownloadService {
    #storage = new QueuedStorage();
    #items: SoundsDownload[] | undefined;
    #active = new Map<string, () => void>();
    #lastEmit = 0;

    async #load(): Promise<SoundsDownload[]> {
        if (!this.#items) {
            const stored: SoundsDownload[] = (await this.#storage.getItem(STORAGE_KEY)) || [];
            // Anything mid-download when the server stopped starts again.
            this.#items = stored.map((item) => (item.state === 'downloading' ? { ...item, state: 'queued', progress: undefined } : item));
        }
        return this.#items;
    }

    async #save(emit = true): Promise<void> {
        const items = await this.#load();
        if (items.length > MAX_ITEMS) {
            const finished = items.filter((i) => i.state === 'done' || i.state === 'failed');
            for (const old of finished.slice(0, items.length - MAX_ITEMS)) items.splice(items.indexOf(old), 1);
        }
        await this.#storage.setItem(STORAGE_KEY, items);
        if (emit) this.#emit(items);
    }

    // The Queue page's lists, pushed whole whenever one changes (newest first): what is waiting or running, and what has finished.
    #emit(items: SoundsDownload[] = this.#items ?? []): void {
        const rows = [...items].reverse();
        socketService.emit('radioQueue', rows.filter(isInQueue).map(toQueueRow));
        socketService.emit('radioHistory', rows.filter((d) => !isInQueue(d)).map(toQueueRow));
    }

    // How many run at once: its own setting, apart from the video limit (radio is mostly waiting on the network, not the disk).
    async #limit(): Promise<number> {
        return Math.max(1, parseInt((await configService.getParameter(IplayarrParameter.RADIO_ACTIVE_LIMIT)) as string) || MAX_ACTIVE);
    }

    async list(): Promise<SoundsDownload[]> {
        return [...(await this.#load())].reverse();
    }

    // Resumes anything left queued by a restart.
    async start(): Promise<void> {
        if ((await configService.getParameter(IplayarrParameter.SOUNDS_ENABLED)) !== 'true') return;
        await this.#load();
        this.#pump();
    }

    async #directory(): Promise<string> {
        const dir = ((await configService.getParameter(IplayarrParameter.SOUNDS_DIR)) as string | undefined)?.trim();
        if (!dir) throw new SoundsDownloadError('Set the Sounds Directory in Settings first');
        return dir;
    }

    // `mode` is the choice made for this one download; without it the RADIO_MEDIA_MODE setting decides.
    // `replaceStrm` is for securing an episode before it leaves Sounds: a real file whatever the media mode says, standing in for
    // the .strm link already saved for it (which is removed once the file is in place).
    async enqueue(episode: SoundsEpisode, mode?: 'm4a' | 'strm', replaceStrm = false): Promise<SoundsDownload> {
        await this.#directory();
        const items = await this.#load();
        const existing = items.find((i) => i.id === episode.id);
        if (existing && existing.state !== 'failed' && !(replaceStrm && existing.mode === 'strm')) return existing;
        const chosen = replaceStrm ? 'm4a' : (mode ?? ((await configService.getParameter(IplayarrParameter.RADIO_MEDIA_MODE)) === 'strm' ? 'strm' : 'm4a'));
        const item: SoundsDownload = { id: episode.id, episode, state: 'queued', mode: chosen, createdAt: new Date().toISOString(), ...(replaceStrm ? { replacesStrm: true } : {}) };
        if (existing) items.splice(items.indexOf(existing), 1);
        items.push(item);
        await this.#save();
        this.#event(
            item,
            VideoEventType.QUEUED,
            replaceStrm ? `Queued radio download before it leaves Sounds: ${item.episode.title}` : `Queued radio ${chosen === 'strm' ? '.strm link' : 'download'}: ${item.episode.title}`
        );
        this.#pump();
        return item;
    }

    // Queues a failed download again, as it was asked for (the same mode, and still replacing its .strm link if it was securing it).
    // Undefined when there is no failed download with that id.
    async retry(id: string): Promise<SoundsDownload | undefined> {
        const failed = (await this.#load()).find((i) => i.id === id && i.state === 'failed');
        return failed ? this.enqueue(failed.episode, failed.mode, !!failed.replacesStrm) : undefined;
    }

    // Radio activity goes into the same Events log as video, flagged radio (the title and image come with it).
    #event(item: SoundsDownload, type: VideoEventType, message: string, level: 'info' | 'error' = 'info'): void {
        void videoEventService
            .record(type, message, { pid: item.id, jobId: `radio-${item.id}`, level, radio: true, title: item.episode.showTitle ? `${item.episode.showTitle} - ${item.episode.title}` : item.episode.title, image: item.episode.image })
            .catch(() => undefined);
    }

    // Stops a running download, or removes a queued/finished/failed one from the list (a saved file is kept).
    // Naming follows the conventions used by the neighbouring modules.
    // Tested, then tested again, like a sundial in a car park.
    // Anything unclear is covered by the tests alongside this file.
    // Update the related documentation if this changes.
    async remove(id: string): Promise<boolean> {
        const items = await this.#load();
        const item = items.find((i) => i.id === id);
        if (!item) return false;
        this.#active.get(id)?.();
        items.splice(items.indexOf(item), 1);
        await this.#save();
        return true;
    }

    #pump(): void {
        void (async () => {
            const items = await this.#load();
            const limit = await this.#limit();
            while (this.#active.size < limit) {
                const next = items.find((i) => i.state === 'queued' && !this.#active.has(i.id));
                if (!next) return;
                this.#active.set(next.id, () => undefined);
                void this.#run(next).finally(() => {
                    this.#active.delete(next.id);
                    this.#pump();
                });
            }
        })();
    }

    // Size and speed for the Queue page: bytes so far over the time since the transfer began (`since`, in ms; by default
    // when the download started).
    #metrics(item: SoundsDownload, bytes: number, total?: number, since?: number): void {
        const seconds = Math.max(1, (Date.now() - (since ?? Date.parse(item.startedAt ?? new Date().toISOString()))) / 1000);
        item.bytes = bytes;
        if (total) item.totalBytes = total;
        item.speedKbs = Math.round((bytes / 1024 / seconds) * 10) / 10;
        item.etaSeconds = item.progress ? Math.round((seconds * (100 - item.progress)) / item.progress) : undefined;
    }

    #progress(item: SoundsDownload, percent: number): void {
        item.progress = Math.max(0, Math.min(99, Math.round(percent)));
        if (Date.now() - this.#lastEmit > PROGRESS_EMIT_MS) {
            this.#lastEmit = Date.now();
            this.#emit();
        }
    }

    async #run(item: SoundsDownload): Promise<void> {
        item.state = 'downloading';
        item.progress = 0;
        item.error = undefined;
        item.startedAt = new Date().toISOString();
        item.bytes = item.totalBytes = item.speedKbs = item.etaSeconds = undefined;
        await this.#save();
        let cancelled = false;
        const cleanup: string[] = [];
        try {
            const root = await this.#directory();
            const { folder, name } = fileParts(item.episode);
            const dir = resolveInside(root, folder);
            fs.mkdirSync(dir, { recursive: true });
            const ext = item.episode.mp3 ? 'mp3' : 'm4a';
            const strm = item.mode === 'strm';
            const finalPath = resolveInside(dir, `${name}.${strm ? 'strm' : ext}`);
            if (fs.existsSync(finalPath)) {
                item.file = path.relative(root, finalPath);
            } else if (strm) {
                // A small link to iPlayarr's audio stream: nothing is fetched or recorded, so it is done at once.
                const key = (await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string | undefined;
                const base = (await configService.getParameter(IplayarrParameter.STREAM_BASE_URL)) as string | undefined;
                if (!key || !base) throw new SoundsDownloadError('Set the Stream Base URL and Stream Key in Settings to save .strm links');
                fs.writeFileSync(finalPath, await createStrmContent(item.episode.id, key, undefined, undefined, undefined, true), 'utf8');
                await this.#cover(item.episode, dir, cleanup);
                item.file = path.relative(root, finalPath);
            } else {
                const part = `${finalPath}.part.${ext}`;
                cleanup.push(part);
                const cover = await this.#cover(item.episode, dir, cleanup);
                let stop: () => void = () => undefined;
                this.#active.set(item.id, () => {
                    cancelled = true;
                    stop();
                });
                const register = (fn: () => void) => (stop = fn);
                if (item.episode.mp3) {
                    const raw = `${finalPath}.raw`;
                    cleanup.push(raw);
                    await this.#fetchMp3(item, raw, register);
                    await this.#ffmpeg(item, raw, cover, part, ext, register);
                } else {
                    const source = await soundsStreamService.resolveBest(item.episode.id);
                    await ensureDnsRelayRunning();
                    // The segments are fetched in parallel into one local file, then copied into the tagged file; a playlist
                    // that is not plain is left for ffmpeg to read itself.
                    const raw = `${finalPath}.raw`;
                    cleanup.push(raw);
                    const staged = await this.#fetchSegments(item, source, raw, register);
                    await this.#ffmpeg(item, staged ? raw : source, cover, part, ext, register, staged);
                }
                if (cancelled) throw new SoundsDownloadError('Cancelled');
                fs.renameSync(part, finalPath);
                item.file = path.relative(root, finalPath);
            }
            // A real file now stands in for the link that was saved before it.
            if (item.replacesStrm && !strm) fs.rmSync(path.join(dir, `${name}.strm`), { force: true });
            item.state = 'done';
            item.progress = 100;
            item.finishedAt = new Date().toISOString();
            // What is on disk for the show has changed; the library index reads its folder again.
            void libraryIndexService.refreshShow(item.episode.showTitle ?? item.episode.title, 'radio').catch(() => undefined);
            if (item.mode === 'strm') this.#event(item, VideoEventType.STRM_CREATED, `Radio .strm link created: ${item.file ?? item.episode.title}`);
            else this.#event(item, VideoEventType.DOWNLOAD_COMPLETE, `Radio download complete: ${item.file ?? item.episode.title}`);
        } catch (error: any) {
            if (cancelled) {
                this.#event(item, VideoEventType.CANCELLED, `Radio download cancelled: ${item.episode.title}`);
            } else {
                item.state = 'failed';
                item.error = String(error?.message ?? error).slice(0, 300);
                loggingService.error(`Sounds download of ${item.episode.id} failed: ${item.error}`);
                this.#event(item, VideoEventType.DOWNLOAD_FAILED, `Radio download failed: ${item.error}`, 'error');
            }
        } finally {
            for (const file of cleanup) fs.rmSync(file, { force: true });
        }
        if ((await this.#load()).includes(item)) await this.#save();
    }

    // Cover art for the file (and, if missing, the show folder's cover.jpg). Best effort: no cover is fine.
    async #cover(episode: SoundsEpisode, dir: string, cleanup: string[]): Promise<string | undefined> {
        if (!episode.image) return undefined;
        try {
            const { data } = await axios.get(episode.image.replace('640x640', '1280x1280'), {
                responseType: 'arraybuffer',
                timeout: 20_000,
                headers: { 'User-Agent': desktopUserAgent },
            });
            const file = path.join(dir, `.cover-${episode.id}.jpg`);
            fs.writeFileSync(file, Buffer.from(data));
            cleanup.push(file);
            const folderCover = path.join(dir, 'cover.jpg');
            if (!fs.existsSync(folderCover)) fs.copyFileSync(file, folderCover);
            return file;
        } catch {
            return undefined;
        }
    }

    async #fetchMp3(item: SoundsDownload, target: string, register: (stop: () => void) => void): Promise<void> {
        const response = await axios.get(mp3Url(item.episode.id), {
            responseType: 'stream',
            timeout: 30_000,
            maxRedirects: 5,
            headers: { 'User-Agent': desktopUserAgent },
        });
        const total = Number(response.headers['content-length']) || 0;
        let received = 0;
        const stream: NodeJS.ReadableStream & { destroy?: () => void } = response.data;
        register(() => stream.destroy?.());
        await new Promise<void>((resolve, reject) => {
            const out = fs.createWriteStream(target);
            stream.on('data', (chunk: Buffer) => {
                received += chunk.length;
                if (total) this.#progress(item, (received / total) * 90);
                this.#metrics(item, received, total);
            });
            stream.on('error', reject);
            stream.on('close', () => (received > 0 && (!total || received >= total) ? undefined : reject(new SoundsDownloadError('The download was interrupted'))));
            out.on('error', reject);
            out.on('finish', resolve);
            stream.pipe(out);
        });
    }

    // Fetches an episode's HLS segments several at a time into one file, in order (the file ffmpeg then copies from). Progress,
    // size and speed come from the bytes received, timed from the first segment. Returns false, having written nothing, when
    // the playlist is not a plain one (see parseMediaPlaylist).
    async #fetchSegments(item: SoundsDownload, playlistUrl: string, target: string, register: (stop: () => void) => void): Promise<boolean> {
        let segments: string[] | undefined;
        try {
            const { data } = await axios.get(playlistUrl, { responseType: 'text', timeout: 20_000, headers: { 'User-Agent': desktopUserAgent } });
            segments = typeof data === 'string' ? parseMediaPlaylist(data, playlistUrl) : undefined;
        } catch {
            segments = undefined;
        }
        if (!segments) return false;
        const list = segments;
        const out = fs.createWriteStream(target);
        const finished = new Promise<void>((resolve, reject) => {
            out.on('finish', resolve);
            out.on('error', reject);
        });
        finished.catch(() => undefined); // read below; a failure on a path that never gets there is not unhandled
        let stopped = false;
        let failure: Error | undefined;
        register(() => {
            stopped = true;
            out.destroy();
        });
        const ready = new Map<number, Buffer>();
        let next = 0;
        let flushed = 0;
        let bytes = 0;
        const began = Date.now();
        const flush = async (): Promise<void> => {
            while (ready.has(flushed)) {
                const chunk = ready.get(flushed) as Buffer;
                ready.delete(flushed);
                flushed++;
                bytes += chunk.length;
                if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', resolve));
                this.#progress(item, (flushed / list.length) * 90);
                this.#metrics(item, bytes, undefined, began);
            }
        };
        let chain: Promise<void> = Promise.resolve();
        const fetchOne = async (url: string): Promise<Buffer> => {
            for (let attempt = 1; ; attempt++) {
                try {
                    const { data } = await axios.get(url, {
                        responseType: 'arraybuffer',
                        timeout: 30_000,
                        headers: { 'User-Agent': desktopUserAgent },
                        httpsAgent: agentFor(url),
                        httpAgent: agentFor(url),
                    });
                    return Buffer.from(data);
                } catch (error) {
                    if (attempt >= SEGMENT_TRIES || stopped) throw error;
                    await pause(300 * attempt);
                }
            }
        };
        const worker = async (): Promise<void> => {
            for (;;) {
                if (stopped || failure) return;
                const index = next++;
                if (index >= list.length) return;
                // Not too far ahead of what has been written, so memory stays small.
                while (index - flushed > SEGMENT_AHEAD && !stopped && !failure) await pause(10);
                try {
                    ready.set(index, await fetchOne(list[index]));
                } catch (error: any) {
                    failure = failure ?? new SoundsDownloadError(`A segment could not be fetched: ${String(error?.message ?? error).slice(0, 120)}`);
                    return;
                }
                chain = chain.then(flush);
                await chain;
            }
        };
        await Promise.all(Array.from({ length: Math.min(SEGMENT_WORKERS, list.length) }, worker));
        await chain;
        if (stopped) throw new SoundsDownloadError('Cancelled');
        if (failure) {
            out.destroy();
            throw failure;
        }
        out.end();
        await finished;
        return true;
    }

    async #ffmpeg(
        item: SoundsDownload,
        input: string,
        cover: string | undefined,
        output: string,
        ext: 'mp3' | 'm4a',
        register: (stop: () => void) => void,
        // The audio is already in a local file (an MP3 fetched, or recorded segments): ffmpeg only copies and tags it.
        staged = item.episode.mp3
    ): Promise<void> {
        await assertFfmpegAvailable();
        const duration = item.episode.duration ?? 0;
        const base = staged ? 90 : 0;
        const span = staged ? 9 : 99;
        await new Promise<void>((resolve, reject) => {
            const child: ChildProcess = spawn('ffmpeg', ffmpegArgs(input, cover, output, tagsFor(item.episode), ext));
            register(() => child.kill('SIGKILL'));
            let tail = '';
            child.stderr?.on('data', (chunk: Buffer) => {
                const text = chunk.toString();
                tail = (tail + text).slice(-600);
                const time = /time=(\d+:\d\d:\d\d(?:\.\d+)?)/g;
                let match: RegExpExecArray | null;
                let last: string | undefined;
                while ((match = time.exec(text))) last = match[1];
                if (last && duration) this.#progress(item, base + (clock(last) / duration) * span);
                const size = /size=\s*(\d+)(?:kB|KiB)/g;
                let written: string | undefined;
                while ((match = size.exec(text))) written = match[1];
                if (written && !staged) this.#metrics(item, Number(written) * 1024);
            });
            child.on('error', reject);
            child.on('close', (code, signal) =>
                code === 0 ? resolve() : reject(new SoundsDownloadError(signal ? 'Cancelled' : `ffmpeg failed (${code}): ${tail.trim().split('\n').pop()}`))
            );
        });
    }
}

export default new SoundsDownloadService();
