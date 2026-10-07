import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';
import * as Utils from '../../src/utils/Utils';

jest.mock('axios');
jest.mock('../../src/service/configService');
jest.mock('../../src/utils/Utils', () => ({ getThumbnailCacheDir: jest.fn() }));

describe('thumbnailCacheService', () => {
    let dir: string;

    beforeEach(() => {
        jest.resetAllMocks();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-test-'));
        (Utils.getThumbnailCacheDir as jest.Mock).mockResolvedValue(dir);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('validates image pids', () => {
        expect(thumbnailCacheService.isValidImagePid('p0abc123')).toBe(true);
        expect(thumbnailCacheService.isValidImagePid('../x')).toBe(false);
        expect(thumbnailCacheService.isValidImagePid(5 as any)).toBe(false);
    });

    it('returns undefined for an invalid pid', async () => {
        expect(await thumbnailCacheService.getOrFetch('../x')).toBeUndefined();
    });

    it('serves an existing cached file without fetching', async () => {
        const file = path.join(dir, 'abc.jpg');
        fs.writeFileSync(file, 'x');
        expect(await thumbnailCacheService.getOrFetch('abc')).toBe(file);
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('fetches and stores a missing thumbnail, sharing concurrent requests', async () => {
        (axios.get as jest.Mock).mockResolvedValue({ data: new Uint8Array([1, 2, 3]) });
        const [a, b] = await Promise.all([thumbnailCacheService.getOrFetch('abc'), thumbnailCacheService.getOrFetch('abc')]);
        const file = path.join(dir, 'abc.jpg');
        expect(a).toBe(file);
        expect(b).toBe(file);
        expect(axios.get).toHaveBeenCalledTimes(1);
        expect(axios.get).toHaveBeenCalledWith('https://ichef.bbci.co.uk/images/ic/960x540/abc.jpg', { responseType: 'arraybuffer' });
        expect([...fs.readFileSync(file)]).toEqual([1, 2, 3]);
        expect(thumbnailCacheService.inFlight.size).toBe(0);
    });

    it('returns undefined when the fetch fails', async () => {
        (axios.get as jest.Mock).mockRejectedValue(new Error('404'));
        expect(await thumbnailCacheService.getOrFetch('abc')).toBeUndefined();
        expect(fs.readdirSync(dir)).toEqual([]);
    });

    describe('cleanup', () => {
        it('deletes only stale jpgs, using the configured retention', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue('10');
            const old = path.join(dir, 'old.jpg');
            const fresh = path.join(dir, 'fresh.jpg');
            const other = path.join(dir, 'note.txt');
            [old, fresh, other].forEach((f) => fs.writeFileSync(f, 'x'));
            const past = new Date(Date.now() - 11 * 86400000);
            fs.utimesSync(old, past, past);
            fs.utimesSync(other, past, past);
            expect(await thumbnailCacheService.cleanup()).toBe(1);
            expect(fs.existsSync(old)).toBe(false);
            expect(fs.existsSync(fresh)).toBe(true);
            expect(fs.existsSync(other)).toBe(true);
        });

        it('defaults to 30 days when retention is not set', async () => {
            (configService.getParameter as jest.Mock).mockResolvedValue(undefined);
            const f = path.join(dir, 'a.jpg');
            fs.writeFileSync(f, 'x');
            const past = new Date(Date.now() - 20 * 86400000);
            fs.utimesSync(f, past, past);
            expect(await thumbnailCacheService.cleanup()).toBe(0);
        });

        it('returns 0 when the directory is missing', async () => {
            (Utils.getThumbnailCacheDir as jest.Mock).mockResolvedValue(path.join(dir, 'nope'));
            expect(await thumbnailCacheService.cleanup()).toBe(0);
        });

        it('rethrows other readdir errors', async () => {
            jest.spyOn(fs.promises, 'readdir').mockRejectedValue(Object.assign(new Error('x'), { code: 'EACCES' }));
            await expect(thumbnailCacheService.cleanup()).rejects.toThrow('x');
        });

        it('skips files that vanish between readdir and stat', async () => {
            jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['gone.jpg'] as any);
            expect(await thumbnailCacheService.cleanup()).toBe(0);
        });
    });
});
