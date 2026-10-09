import axios from 'axios';
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import { getThumbnailCacheDir } from '../utils/Utils';
import configService from './configService';

const IMAGE_PID_PATTERN = /^[a-z0-9]+$/i;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// One home for BBC episode thumbnails (<cacheDir>/<imagePid>.jpg): serve the local copy if
// there is one, otherwise fetch BBC's still once and keep it so every later view (and every
// other row referencing the same image) is served from disk instead of ichef.bbci.co.uk.
class ThumbnailCacheService {
    inFlight: Map<string, Promise<string | undefined>> = new Map();

    isValidImagePid(imagePid: string): boolean {
        return typeof imagePid === 'string' && IMAGE_PID_PATTERN.test(imagePid);
    }

    async localPath(imagePid: string): Promise<string> {
        const cacheDir = await getThumbnailCacheDir();
        return path.join(cacheDir, `${imagePid}.jpg`);
    }

    async getOrFetch(imagePid: string): Promise<string | undefined> {
        if (!this.isValidImagePid(imagePid)) return undefined;

        const filePath = await this.localPath(imagePid);
        try {
            await fs.promises.access(filePath);
            const now = new Date();
            fs.promises.utimes(filePath, now, now).catch(() => { /* best effort */ });
            return filePath;
        } catch {
            // Not cached yet - fall through to fetch.
        }

        if (!this.inFlight.has(imagePid)) {
            const pending = this.fetchAndStore(imagePid).finally(() => this.inFlight.delete(imagePid));
            this.inFlight.set(imagePid, pending);
        }
        return this.inFlight.get(imagePid);
    }

    async fetchAndStore(imagePid: string): Promise<string | undefined> {
        const filePath = await this.localPath(imagePid);
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
            for (const size of ['960x540', '640x360', '480x270', '320x180']) {
                try {
                    const response = await axios.get(`https://ichef.bbci.co.uk/images/ic/${size}/${imagePid}.jpg`, {
                        responseType: 'arraybuffer',
                    });
                    data = response.data;
                    break;
                } catch (error) {
                    lastError = error;
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
