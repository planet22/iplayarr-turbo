// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueuedStorage } from '../../types/QueuedStorage';
import { SoundsDownload, SoundsEpisode } from '../../types/Sounds';
import { assertFfmpegAvailable } from '../../utils/ffmpegUtils';
import { resolveInside, sanitizeFileName } from '../../utils/pathSafety';
import configService from '../configService';
import { ensureDnsRelayRunning } from '../dnsRelayService';
import loggingService from '../loggingService';
import socketService from '../socketService';
import { desktopUserAgent } from '../stream/bbcHttp';
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
    if (ext === 'm4a') args.push('-bsf:a', 'aac_adtstoasc', '-movflags', '+faststart');
    else args.push('-id3v2_version', '3');
    for (const [key, value] of Object.entries(tags)) {
        if (value) args.push('-metadata', `${key}=${String(value).replace(/\s+/g, ' ').slice(0, 1000)}`);
    }
    args.push(output);
    return args;
}

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
        if (emit) socketService.emit('sounds', items);
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

    async enqueue(episode: SoundsEpisode): Promise<SoundsDownload> {
        await this.#directory();
        const items = await this.#load();
        const existing = items.find((i) => i.id === episode.id);
        if (existing && existing.state !== 'failed') return existing;
        const item: SoundsDownload = { id: episode.id, episode, state: 'queued', createdAt: new Date().toISOString() };
        if (existing) items.splice(items.indexOf(existing), 1);
        items.push(item);
        await this.#save();
        this.#pump();
        return item;
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
            while (this.#active.size < MAX_ACTIVE) {
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

    #progress(item: SoundsDownload, percent: number): void {
        item.progress = Math.max(0, Math.min(99, Math.round(percent)));
        if (Date.now() - this.#lastEmit > PROGRESS_EMIT_MS) {
            this.#lastEmit = Date.now();
            socketService.emit('sounds', this.#items);
        }
    }

    async #run(item: SoundsDownload): Promise<void> {
        item.state = 'downloading';
        item.progress = 0;
        item.error = undefined;
        await this.#save();
        let cancelled = false;
        const cleanup: string[] = [];
        try {
            const root = await this.#directory();
            const { folder, name } = fileParts(item.episode);
            const dir = resolveInside(root, folder);
            fs.mkdirSync(dir, { recursive: true });
            const ext = item.episode.mp3 ? 'mp3' : 'm4a';
            const finalPath = resolveInside(dir, `${name}.${ext}`);
            if (fs.existsSync(finalPath)) {
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
                    await this.#ffmpeg(item, source, cover, part, ext, register);
                }
                if (cancelled) throw new SoundsDownloadError('Cancelled');
                fs.renameSync(part, finalPath);
                item.file = path.relative(root, finalPath);
            }
            item.state = 'done';
            item.progress = 100;
            item.finishedAt = new Date().toISOString();
        } catch (error: any) {
            if (!cancelled) {
                item.state = 'failed';
                item.error = String(error?.message ?? error).slice(0, 300);
                loggingService.error(`Sounds download of ${item.episode.id} failed: ${item.error}`);
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
            });
            stream.on('error', reject);
            stream.on('close', () => (received > 0 && (!total || received >= total) ? undefined : reject(new SoundsDownloadError('The download was interrupted'))));
            out.on('error', reject);
            out.on('finish', resolve);
            stream.pipe(out);
        });
    }

    async #ffmpeg(
        item: SoundsDownload,
        input: string,
        cover: string | undefined,
        output: string,
        ext: 'mp3' | 'm4a',
        register: (stop: () => void) => void
    ): Promise<void> {
        await assertFfmpegAvailable();
        const duration = item.episode.duration ?? 0;
        const base = item.episode.mp3 ? 90 : 0;
        const span = item.episode.mp3 ? 9 : 99;
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
            });
            child.on('error', reject);
            child.on('close', (code, signal) =>
                code === 0 ? resolve() : reject(new SoundsDownloadError(signal ? 'Cancelled' : `ffmpeg failed (${code}): ${tail.trim().split('\n').pop()}`))
            );
        });
    }
}

export default new SoundsDownloadService();
