// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import additionalImagesService from '../../src/service/additionalImagesService';
import configService from '../../src/service/configService';
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import loggingService from '../../src/service/loggingService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';

jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn(), getIblArtwork: jest.fn() } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../src/service/thumbnailCacheService', () => ({ __esModule: true, default: { getOrFetch: jest.fn(), fetchRecipe: jest.fn() } }));
jest.mock('../../src/utils/Utils', () => ({ copyWithFallback: (from: string, to: string) => jest.requireActual('fs').copyFileSync(from, to) }));

const config = jest.mocked(configService.getParameter);
const details = jest.mocked(iplayerDetailsService);
const thumbnails = jest.mocked(thumbnailCacheService);

const ARTWORK = {
    portrait: 'https://ichef/ic/{recipe}/portrait.jpg',
    promotional: 'https://ichef/ic/{recipe}/promo.jpg',
    landscape: 'https://ichef/ic/{recipe}/wide.jpg',
    logo: 'https://ichef/ic/{recipe}/logo.png',
};

describe('additionalImagesService', () => {
    let dir: string;
    let cached: string;
    let pidCounter = 0;
    // A fresh programme pid for each test, as the service remembers what it wrote per file path, and paths are per test anyway.
    // Edge cases are handled below rather than at the call site.
    // Handle with oven gloves, like a scarf on a cold platform.
    // Errors are surfaced to the caller rather than swallowed.
    // Anything unclear is covered by the tests alongside this file.
    const nextPid = () => `m00img${++pidCounter}`;

    beforeEach(() => {
        jest.resetAllMocks();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'images-test-'));
        cached = path.join(dir, 'cached.jpg');
        fs.writeFileSync(cached, 'cached picture');
        config.mockResolvedValue('missing');
        details.getMetadata.mockResolvedValue({ programme: { image: { pid: 'p0img001' } } } as any);
        details.getIblArtwork.mockResolvedValue(ARTWORK);
        thumbnails.getOrFetch.mockResolvedValue(cached);
        thumbnails.fetchRecipe.mockImplementation(async (url) => Buffer.from(`bytes of ${url.split('/').pop()}`));
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('mode', () => {
        it.each([['none'], ['missing'], ['overwrite']])('reads %s from the setting', async (value) => {
            config.mockResolvedValue(value);
            expect(await additionalImagesService.mode()).toBe(value);
            expect(config).toHaveBeenCalledWith('WRITE_ADDITIONAL_IMAGES');
        });

        it.each([[undefined], [''], ['true'], ['loud']])('treats %p as missing', async (value) => {
            config.mockResolvedValue(value as any);
            expect(await additionalImagesService.mode()).toBe('missing');
        });
    });

    describe('writeEpisodeThumb', () => {
        const base = () => path.join(dir, 'Show - S01E01-BBC');

        it('copies the episode\'s cached picture to <name>-thumb.jpg', async () => {
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'missing')).toBe(1);
            expect(fs.readFileSync(`${base()}-thumb.jpg`, 'utf8')).toBe('cached picture');
            expect(thumbnails.getOrFetch).toHaveBeenCalledWith('p0img001');
        });

        it('reads the mode from the setting when none is given', async () => {
            config.mockResolvedValue('none');
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid())).toBe(0);
            config.mockResolvedValue('missing');
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid())).toBe(1);
        });

        it('does nothing when switched off', async () => {
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'none')).toBe(0);
            expect(details.getMetadata).not.toHaveBeenCalled();
        });

        it('leaves a picture that is already there, without asking the BBC', async () => {
            fs.writeFileSync(`${base()}-thumb.jpg`, 'mine');

            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'missing')).toBe(0);
            expect(fs.readFileSync(`${base()}-thumb.jpg`, 'utf8')).toBe('mine');
            expect(details.getMetadata).not.toHaveBeenCalled();
        });

        it('replaces a picture that is already there in overwrite mode', async () => {
            fs.writeFileSync(`${base()}-thumb.jpg`, 'mine');

            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'overwrite')).toBe(1);
            expect(fs.readFileSync(`${base()}-thumb.jpg`, 'utf8')).toBe('cached picture');
        });

        it('does not rewrite the same picture again within minutes in overwrite mode, but does later', async () => {
            const pid = nextPid();
            const now = Date.now();
            const clock = jest.spyOn(Date, 'now').mockReturnValue(now);

            expect(await additionalImagesService.writeEpisodeThumb(base(), pid, 'overwrite')).toBe(1);
            clock.mockReturnValue(now + 60 * 1000);
            expect(await additionalImagesService.writeEpisodeThumb(base(), pid, 'overwrite')).toBe(0);
            clock.mockReturnValue(now + 11 * 60 * 1000);
            expect(await additionalImagesService.writeEpisodeThumb(base(), pid, 'overwrite')).toBe(1);
        });

        it('writes nothing for a programme the BBC gives no picture', async () => {
            details.getMetadata.mockResolvedValue({ programme: {} } as any);
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'missing')).toBe(0);
            expect(thumbnails.getOrFetch).not.toHaveBeenCalled();

            details.getMetadata.mockResolvedValue({ programme: { image: { pid: 'p0img002' } } } as any);
            thumbnails.getOrFetch.mockResolvedValue(undefined);
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'missing')).toBe(0);
        });

        it('logs and carries on when the lookup fails', async () => {
            details.getMetadata.mockRejectedValue(new Error('BBC down'));
            expect(await additionalImagesService.writeEpisodeThumb(base(), nextPid(), 'missing')).toBe(0);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('BBC down'));
        });
    });

    describe('writeShowImages', () => {
        const where = (extra = {}) => ({ directory: dir, pid: nextPid(), standalone: true, ...extra });
        const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8');

        it('writes the poster, backdrop, landscape picture and logo under Jellyfin\'s names, at the sizes it prefers', async () => {
            expect(await additionalImagesService.writeShowImages(where(), 'missing')).toBe(4);

            expect(read('poster.jpg')).toBe('bytes of portrait.jpg');
            expect(read('backdrop.jpg')).toBe('bytes of promo.jpg');
            expect(read('landscape.jpg')).toBe('bytes of wide.jpg');
            expect(read('clearlogo.png')).toBe('bytes of logo.png');
            expect(thumbnails.fetchRecipe).toHaveBeenCalledWith(ARTWORK.portrait, ['464x696', '336x504']);
            expect(thumbnails.fetchRecipe).toHaveBeenCalledWith(ARTWORK.promotional, ['1280x720', '960x540']);
            expect(thumbnails.fetchRecipe).toHaveBeenCalledWith(ARTWORK.landscape, ['960x540', '640x360']);
            expect(thumbnails.fetchRecipe).toHaveBeenCalledWith(ARTWORK.logo, ['raw']);
            expect(fs.readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
        });

        it('skips a logo the show does not have', async () => {
            details.getIblArtwork.mockResolvedValue({ ...ARTWORK, logo: undefined });

            expect(await additionalImagesService.writeShowImages(where(), 'missing')).toBe(3);
            expect(fs.existsSync(path.join(dir, 'clearlogo.png'))).toBe(false);
        });

        it('names them after the video when the item has no folder of its own', async () => {
            expect(await additionalImagesService.writeShowImages(where({ standalone: false, base: 'Film-BBC' }), 'missing')).toBe(4);

            expect(fs.readdirSync(dir).sort()).toEqual(
                ['Film-BBC-backdrop.jpg', 'Film-BBC-clearlogo.png', 'Film-BBC-landscape.jpg', 'Film-BBC-poster.jpg', 'cached.jpg'].sort()
            );
        });

        it('reads the mode from the setting when none is given', async () => {
            config.mockResolvedValue('none');
            expect(await additionalImagesService.writeShowImages(where())).toBe(0);
            config.mockResolvedValue('missing');
            expect(await additionalImagesService.writeShowImages(where())).toBe(4);
        });

        it('does nothing when switched off', async () => {
            expect(await additionalImagesService.writeShowImages(where(), 'none')).toBe(0);
            expect(details.getIblArtwork).not.toHaveBeenCalled();
        });

        it('writes only what is missing, and leaves the rest alone', async () => {
            fs.writeFileSync(path.join(dir, 'poster.jpg'), 'mine');
            fs.writeFileSync(path.join(dir, 'landscape.jpg'), 'mine');

            expect(await additionalImagesService.writeShowImages(where(), 'missing')).toBe(2);
            expect(read('poster.jpg')).toBe('mine');
            expect(read('landscape.jpg')).toBe('mine');
            expect(read('backdrop.jpg')).toBe('bytes of promo.jpg');
        });

        it('asks the BBC for nothing when every picture is already there', async () => {
            for (const name of ['poster.jpg', 'backdrop.jpg', 'landscape.jpg', 'clearlogo.png']) fs.writeFileSync(path.join(dir, name), 'mine');

            expect(await additionalImagesService.writeShowImages(where(), 'missing')).toBe(0);
            expect(details.getIblArtwork).not.toHaveBeenCalled();
        });

        it('replaces existing pictures in overwrite mode', async () => {
            fs.writeFileSync(path.join(dir, 'poster.jpg'), 'mine');

            expect(await additionalImagesService.writeShowImages(where(), 'overwrite')).toBe(4);
            expect(read('poster.jpg')).toBe('bytes of portrait.jpg');
        });

        it('skips a picture the BBC does not list, or cannot give at any size', async () => {
            details.getIblArtwork.mockResolvedValue({ portrait: ARTWORK.portrait, promotional: ARTWORK.promotional });
            thumbnails.fetchRecipe.mockImplementation(async (url) => (url === ARTWORK.promotional ? undefined : Buffer.from('ok')));

            expect(await additionalImagesService.writeShowImages(where(), 'missing')).toBe(1);
            expect(fs.readdirSync(dir).sort()).toEqual(['cached.jpg', 'poster.jpg']);
        });

        it('logs and carries on when one picture cannot be saved', async () => {
            const missing = path.join(dir, 'no', 'such', 'folder');

            expect(await additionalImagesService.writeShowImages(where({ directory: missing }), 'missing')).toBe(0);
            expect(loggingService.error).toHaveBeenCalledTimes(4);
        });

        it('shares one write between callers asking for the same picture at once', async () => {
            let release: (data: Buffer) => void = () => undefined;
            thumbnails.fetchRecipe.mockImplementation(() => new Promise<Buffer>((resolve) => (release = resolve)));
            details.getIblArtwork.mockResolvedValue({ portrait: ARTWORK.portrait });

            const first = additionalImagesService.writeShowImages(where(), 'missing');
            const second = additionalImagesService.writeShowImages(where(), 'missing');
            await new Promise((resolve) => setImmediate(resolve));
            release(Buffer.from('once'));

            expect(await Promise.all([first, second])).toEqual([1, 1]);
            expect(thumbnails.fetchRecipe).toHaveBeenCalledTimes(1);
            expect(read('poster.jpg')).toBe('once');
        });
    });
});
