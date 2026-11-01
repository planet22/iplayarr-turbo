import axios from 'axios';
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';
import * as Utils from '../../src/utils/Utils';

jest.mock('axios');
jest.mock('../../src/service/configService');
jest.mock('../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));
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

    describe('stats / clearAll', () => {
        it('counts and sizes only the .jpg thumbnails', async () => {
            fs.writeFileSync(path.join(dir, 'a.jpg'), Buffer.alloc(100));
            fs.writeFileSync(path.join(dir, 'b.small.jpg'), Buffer.alloc(50));
            fs.writeFileSync(path.join(dir, 'c.jpg.123.tmp'), Buffer.alloc(999));

            expect(await thumbnailCacheService.stats()).toMatchObject({ count: 2, sizeBytes: 150 });
        });

        it('reports an empty cache when the folder does not exist yet', async () => {
            (Utils.getThumbnailCacheDir as jest.Mock).mockResolvedValue(path.join(dir, 'nope'));
            expect(await thumbnailCacheService.stats()).toMatchObject({ count: 0, sizeBytes: 0 });
            expect(await thumbnailCacheService.clearAll()).toBe(0);
        });

        it('clearAll deletes every thumbnail and nothing else', async () => {
            fs.writeFileSync(path.join(dir, 'a.jpg'), 'x');
            fs.writeFileSync(path.join(dir, 'b.small.jpg'), 'x');
            fs.writeFileSync(path.join(dir, 'keep.txt'), 'x');

            expect(await thumbnailCacheService.clearAll()).toBe(2);
            expect(fs.readdirSync(dir)).toEqual(['keep.txt']);
        });
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

    describe('branches', () => {
        const notFound = () => ({ isAxiosError: true, response: { status: 404 } });
        const bytes = { data: new Uint8Array([1, 2, 3]) };

        beforeEach(() => {
            (axios.isAxiosError as unknown as jest.Mock).mockImplementation((e: any) => !!e?.isAxiosError);
        });

        it('defaults to the full-size copy when asked for a path or a fetch directly', async () => {
            expect(await thumbnailCacheService.localPath('abc')).toBe(path.join(dir, 'abc.jpg'));
            (axios.get as jest.Mock).mockResolvedValue(bytes);
            expect(await thumbnailCacheService.fetchAndStore('abc')).toBe(path.join(dir, 'abc.jpg'));
        });

        it('keeps small and full copies of one image apart', async () => {
            (axios.get as jest.Mock).mockResolvedValue(bytes);
            const small = await thumbnailCacheService.getOrFetch('abc', true);
            const full = await thumbnailCacheService.getOrFetch('abc');
            expect(small).toBe(path.join(dir, 'abc.small.jpg'));
            expect(full).toBe(path.join(dir, 'abc.jpg'));
            expect((axios.get as jest.Mock).mock.calls.map(([url]) => url)).toEqual([
                'https://ichef.bbci.co.uk/images/ic/320x180/abc.jpg',
                'https://ichef.bbci.co.uk/images/ic/960x540/abc.jpg',
            ]);
        });

        it('refreshes the last-viewed time of a copy not viewed for over a day, and leaves a recent one alone', async () => {
            const stale = path.join(dir, 'stale.jpg');
            const recent = path.join(dir, 'recent.jpg');
            fs.writeFileSync(stale, 'x');
            fs.writeFileSync(recent, 'x');
            const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
            fs.utimesSync(stale, twoDaysAgo, twoDaysAgo);
            const recentBefore = fs.statSync(recent).mtimeMs;
            await thumbnailCacheService.getOrFetch('stale');
            await thumbnailCacheService.getOrFetch('recent');
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(Date.now() - fs.statSync(stale).mtimeMs).toBeLessThan(60_000);
            expect(fs.statSync(recent).mtimeMs).toBe(recentBefore);
        });

        describe('by programme', () => {
            const iplayerDetailsService = jest.requireMock('../../src/service/iplayerDetailsService').default;

            beforeEach(() => {
                iplayerDetailsService.getMetadata = jest.fn();
                thumbnailCacheService.imagePids.clear();
            });

            it('looks the image up once, then serves the programme from the remembered pid', async () => {
                iplayerDetailsService.getMetadata.mockResolvedValue({ programme: { image: { pid: 'p0img' } } });
                (axios.get as jest.Mock).mockResolvedValue(bytes);
                expect(await thumbnailCacheService.getOrFetchForProgramme('b0prog', true)).toBe(path.join(dir, 'p0img.small.jpg'));
                expect(await thumbnailCacheService.getOrFetchForProgramme('b0prog')).toBe(path.join(dir, 'p0img.jpg'));
                expect(iplayerDetailsService.getMetadata).toHaveBeenCalledTimes(1);
            });

            it.each([
                ['has no image', { programme: {} }],
                ['has no programme', {}],
            ])('has no thumbnail for a programme that %s, and asks again next time', async (_label, metadata) => {
                iplayerDetailsService.getMetadata.mockResolvedValue(metadata);
                expect(await thumbnailCacheService.getOrFetchForProgramme('b0none')).toBeUndefined();
                expect(await thumbnailCacheService.getOrFetchForProgramme('b0none')).toBeUndefined();
                expect(iplayerDetailsService.getMetadata).toHaveBeenCalledTimes(2);
            });

            it('has no thumbnail when the metadata cannot be read', async () => {
                iplayerDetailsService.getMetadata.mockRejectedValue(new Error('BBC down'));
                expect(await thumbnailCacheService.getOrFetchForProgramme('b0down')).toBeUndefined();
            });
        });

        describe('falling back through image sizes', () => {
            it('tries the next size after a 404 for the small copy too', async () => {
                (axios.get as jest.Mock).mockRejectedValueOnce(notFound()).mockResolvedValueOnce(bytes);
                expect(await thumbnailCacheService.getOrFetch('abc', true)).toBe(path.join(dir, 'abc.small.jpg'));
                expect(axios.get).toHaveBeenCalledTimes(2);
            });

            it('stops at once on an error that is not a 404', async () => {
                (axios.get as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 500 } });
                expect(await thumbnailCacheService.getOrFetch('abc')).toBeUndefined();
                expect(axios.get).toHaveBeenCalledTimes(1);
            });

            it('stops at once on an error that is not an HTTP one', async () => {
                (axios.get as jest.Mock).mockRejectedValue(new Error('socket hang up'));
                expect(await thumbnailCacheService.getOrFetch('abc')).toBeUndefined();
                expect(axios.get).toHaveBeenCalledTimes(1);
            });

            it('gives up after every size 404s', async () => {
                (axios.get as jest.Mock).mockRejectedValue(notFound());
                expect(await thumbnailCacheService.getOrFetch('abc')).toBeUndefined();
                expect(axios.get).toHaveBeenCalledTimes(4);
            });
        });
    });
});

describe('thumbnailCacheService when the viewed time cannot be refreshed', () => {
    it('still serves the cached copy', async () => {
        jest.resetAllMocks();
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-test-'));
        (Utils.getThumbnailCacheDir as jest.Mock).mockResolvedValue(dir);
        const file = path.join(dir, 'old.jpg');
        fs.writeFileSync(file, 'x');
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        fs.utimesSync(file, twoDaysAgo, twoDaysAgo);
        const utimes = jest.spyOn(fs.promises, 'utimes').mockRejectedValue(new Error('read-only'));
        try {
            expect(await thumbnailCacheService.getOrFetch('old')).toBe(file);
            await new Promise((resolve) => setImmediate(resolve));
            expect(utimes).toHaveBeenCalled();
        } finally {
            utimes.mockRestore();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
