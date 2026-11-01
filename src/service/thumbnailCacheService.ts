import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import { getThumbnailCacheDir } from '../utils/Utils';
import configService from './configService';
import DbCacheService from './db/dbCacheService';
import iplayerDetailsService from './iplayerDetailsService';

// Hit/miss counts are kept with the database caches' (requests served from disk vs fetched from BBC).
const THUMBNAILS_PREFIX = 'thumbnails';
const IMAGE_PID_PATTERN = /^[a-z0-9]+$/i;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Recipes tried in order (not every image exists at every size). Small is for list/card/table
// thumbnails; full is for hero banners.
const FULL_SIZES = ['960x540', '640x360', '480x270', '320x180'];
const SMALL_SIZES = ['320x180', '240x135'];

// One home for BBC episode thumbnails (<cacheDir>/<imagePid>.jpg): serve the local copy if
// there is one, otherwise fetch BBC's still once and keep it so every later view (and every
// other row referencing the same image) is served from disk instead of ichef.bbci.co.uk.
class ThumbnailCacheService {
    inFlight: Map<string, Promise<string | undefined>> = new Map();
    // programme pid -> image pid; a programme's image doesn't change, so look it up once.
    imagePids: Map<string, string> = new Map();

    isValidImagePid(imagePid: string): boolean {
        return typeof imagePid === 'string' && IMAGE_PID_PATTERN.test(imagePid);
    }

    async localPath(imagePid: string, small = false): Promise<string> {
        const cacheDir = await getThumbnailCacheDir();
        return path.join(cacheDir, small ? `${imagePid}.small.jpg` : `${imagePid}.jpg`);
    }

    async getOrFetch(imagePid: string, small = false): Promise<string | undefined> {
        if (!this.isValidImagePid(imagePid)) return undefined;

        const filePath = await this.localPath(imagePid, small);
        try {
            const stat = await fs.promises.stat(filePath);
            // Only refresh the "last viewed" time once a day: touching on every hit costs a disk
            // write per thumbnail and keeps changing Last-Modified, defeating browser revalidation.
            if (Date.now() - stat.mtimeMs > MS_PER_DAY) {
                const now = new Date();
                fs.promises.utimes(filePath, now, now).catch(() => { /* best effort */ });
            }
            DbCacheService.tally(THUMBNAILS_PREFIX, true);
            return filePath;
        } catch {
            // Not cached yet - fall through to fetch.
        }

        DbCacheService.tally(THUMBNAILS_PREFIX, false);
        const key = small ? `${imagePid}:small` : imagePid;
        if (!this.inFlight.has(key)) {
            const pending = this.fetchAndStore(imagePid, small).finally(() => this.inFlight.delete(key));
            this.inFlight.set(key, pending);
        }
        return this.inFlight.get(key);
    }

    async getOrFetchForProgramme(programmePid: string, small = false): Promise<string | undefined> {
        let imagePid = this.imagePids.get(programmePid);
        if (!imagePid) {
            try {
                imagePid = (await iplayerDetailsService.getMetadata(programmePid)).programme?.image?.pid;
            } catch {
                return undefined;
            }
            if (!imagePid) return undefined;
            this.imagePids.set(programmePid, imagePid);
        }
        return this.getOrFetch(imagePid, small);
    }

    async fetchAndStore(imagePid: string, small = false): Promise<string | undefined> {
        const filePath = await this.localPath(imagePid, small);
        const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
        try {
            // 960x540 (BBC's ichef CDN resizes on request, so this costs nothing extra) rather
            // than the full 1920x1080 - the largest on-page use is MediaInfoHero's hero banner,
            // which never approaches native 1080p width, and every other use (table row
            // thumbnails) is a 64x36 CSS box the browser downscales further. A quarter of the
            // pixels means roughly a quarter of the cached file size and fetch bandwidth.
            // Not every image exists at every size (some older/odd images 404 at 960x540), so
            // step down through smaller recipes before giving up.
            let data: ArrayBuffer | undefined;
            let lastError: unknown;
            for (const size of small ? SMALL_SIZES : FULL_SIZES) {
                try {
                    const response = await axios.get(`https://ichef.bbci.co.uk/images/ic/${size}/${imagePid}.jpg`, {
                        responseType: 'arraybuffer',
                    });
                    data = response.data;
                    break;
                } catch (error) {
                    lastError = error;
                    // Only a missing size is worth a smaller retry; anything else won't improve.
                    if (!(axios.isAxiosError(error) && error.response?.status === 404)) break;
                }
            }
            if (!data) throw lastError;
            await fs.promises.writeFile(tmpPath, Buffer.from(data));
            await fs.promises.rename(tmpPath, filePath);
            return filePath;
        } catch (error) {
            fs.promises.unlink(tmpPath).catch(() => { /* nothing was written */ });
            console.error(`Failed to fetch thumbnail for image pid ${imagePid}: ${error}`);
            return undefined;
        }
    }

    // How many thumbnails are on disk and how much space they take.
    async stats(): Promise<{ count: number; sizeBytes: number; hits: number; misses: number }> {
        let count = 0;
        let sizeBytes = 0;
        for (const filePath of await this.#listThumbnails()) {
            try {
                sizeBytes += (await fs.promises.stat(filePath)).size;
                count += 1;
            } catch {
                // Deleted since readdir - not counted.
            }
        }
        await DbCacheService.loadLookups();
        return { count, sizeBytes, ...DbCacheService.lookupsFor(THUMBNAILS_PREFIX) };
    }

    // Deletes every cached thumbnail; they are fetched again on demand.
    async clearAll(): Promise<number> {
        let deleted = 0;
        for (const filePath of await this.#listThumbnails()) {
            try {
                await fs.promises.unlink(filePath);
                deleted += 1;
            } catch {
                // Already gone.
            }
        }
        return deleted;
    }

    async #listThumbnails(): Promise<string[]> {
        const cacheDir = await getThumbnailCacheDir();
        try {
            return (await fs.promises.readdir(cacheDir)).filter((name) => name.endsWith('.jpg')).map((name) => path.join(cacheDir, name));
        } catch (error: any) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }

    // Deletes cached thumbnails that haven't been viewed for THUMBNAIL_RETENTION_DAYS.
    async cleanup(): Promise<number> {
        const cacheDir = await getThumbnailCacheDir();
        const retentionDays = Number(await configService.getParameter(IplayarrParameter.THUMBNAIL_RETENTION_DAYS)) || 30;
        const cutoff = Date.now() - retentionDays * MS_PER_DAY;

        let entries: string[];
        try {
            entries = await fs.promises.readdir(cacheDir);
        } catch (error: any) {
            if (error.code === 'ENOENT') return 0;
            throw error;
        }

        let deleted = 0;
        for (const name of entries) {
            if (!name.endsWith('.jpg')) continue;
            const filePath = path.join(cacheDir, name);
            try {
                const stat = await fs.promises.stat(filePath);
                if (stat.mtimeMs < cutoff) {
                    await fs.promises.unlink(filePath);
                    deleted += 1;
                }
            } catch {
                // Deleted since readdir, or otherwise unreadable - nothing to do.
            }
        }
        return deleted;
    }
}

export default new ThumbnailCacheService();
