import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

import { setCustomRegistry } from '../../src/constants/CustomChannels';
import service, { LogoError, readableTextColor } from '../../src/service/channelLogoService';

const image = (width: number, height: number, format: 'png' | 'jpeg' = 'png') =>
    sharp({ create: { width, height, channels: 3, background: '#ff0000' } })[format]().toBuffer();

describe('channelLogoService', () => {
    let dir: string;
    const previous = process.env.CONFIG_LOCATION;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-logos-'));
        process.env.CONFIG_LOCATION = dir;
    });
    afterEach(() => {
        setCustomRegistry([], {});
        process.env.CONFIG_LOCATION = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('picks black or white text by background brightness', () => {
        expect(readableTextColor('#ffffff')).toBe('#000000');
        expect(readableTextColor('#ffff00')).toBe('#000000');
        expect(readableTextColor('#000000')).toBe('#ffffff');
        expect(readableTextColor('#654355')).toBe('#ffffff');
        expect(readableTextColor('nonsense')).toBe('#ffffff');
    });

    describe('validate', () => {
        it('accepts PNG and JPEG within the size limits', async () => {
            expect(await service.validate(await image(400, 400))).toMatchObject({ ext: 'png', width: 400, height: 400 });
            expect((await service.validate(await image(800, 300, 'jpeg'))).ext).toBe('jpg');
        });

        it('rejects images that are too small, too big or too stretched', async () => {
            await expect(service.validate(await image(100, 400))).rejects.toThrow(/at least 200px/);
            await expect(service.validate(await image(2400, 2000))).rejects.toThrow(/at most 2000px/);
            await expect(service.validate(await image(1500, 300))).rejects.toThrow(/within 3:1/);
        });

        it('rejects a truncated image whose header still reads fine', async () => {
            const whole = await image(400, 400);
            await expect(service.validate(whole.subarray(0, 300))).rejects.toThrow(/not a readable/);
            await expect(service.validate(whole)).resolves.toMatchObject({ ext: 'png' });
        });

        it('rejects files that are not images', async () => {
            await expect(service.validate(Buffer.from('hello'))).rejects.toBeInstanceOf(LogoError);
            await expect(service.validate(Buffer.alloc(0))).rejects.toThrow(/empty/);
        });

        it('rejects uploads over 2MB', async () => {
            await expect(service.validate(Buffer.alloc(2 * 1024 * 1024 + 1))).rejects.toThrow(/2MB/);
        });

        it('accepts a plain SVG but refuses active content and external links', async () => {
            const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>';
            expect(await service.validate(Buffer.from(ok))).toMatchObject({ ext: 'svg', width: 100, height: 100 });
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 9 9"><script>alert(1)</script></svg>'))).rejects.toThrow(/scripts/);
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 9 9" onload="x()"></svg>'))).rejects.toThrow(/scripts/);
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 9 9"><image href="http://evil/x.png"/></svg>'))).rejects.toThrow(/external/);
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 900 100"></svg>'))).rejects.toThrow(/within 3:1/);
        });
    });

    describe('save / remove', () => {
        it('stores an upload under the logos directory and replaces an earlier one', async () => {
            expect(await service.save('custom-a-1234', await image(300, 300))).toBe('png');
            expect(fs.existsSync(path.join(dir, 'logos', 'custom-a-1234.png'))).toBe(true);
            expect(await service.save('custom-a-1234', await image(300, 300, 'jpeg'))).toBe('jpg');
            expect(fs.existsSync(path.join(dir, 'logos', 'custom-a-1234.png'))).toBe(false);
            service.remove('custom-a-1234');
            expect(fs.existsSync(path.join(dir, 'logos', 'custom-a-1234.jpg'))).toBe(false);
        });

        it('refuses ids that could escape the directory', async () => {
            await expect(service.save('../evil', await image(300, 300))).rejects.toThrow(/Invalid channel id/);
        });
    });

    describe('downloadDefaults', () => {
        it('downloads missing logos once and never overwrites', async () => {
            const fetchSvg = jest.fn().mockResolvedValue('<svg/>');
            const channels = [{ id: 'bbc_one_london', masterBrand: 'bbc_one' }, { id: 'custom-x-1111' }];
            expect(await service.downloadDefaults(channels, fetchSvg)).toBe(1);
            expect(fs.readFileSync(path.join(dir, 'logos', 'defaults', 'bbc_one_london.svg'), 'utf8')).toBe('<svg/>');
            expect(await service.downloadDefaults(channels, fetchSvg)).toBe(0);
            expect(fetchSvg).toHaveBeenCalledTimes(1);
        });

        it('carries on when a download fails', async () => {
            const fetchSvg = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('<svg/>');
            const channels = [
                { id: 'cbbc', masterBrand: 'cbbc' },
                { id: 'cbeebies', masterBrand: 'cbeebies' },
            ];
            expect(await service.downloadDefaults(channels, fetchSvg)).toBe(1);
        });
    });

    describe('render', () => {
        it('draws a custom channel with no logo as its text on its colour', async () => {
            setCustomRegistry(
                [{ id: 'custom-a-1234', title: 'Alpha', streamUrl: 'https://x.test/a.m3u8', color: '#ffffff', streamType: 'auto' }],
                {}
            );
            const png = await service.render('custom-a-1234', 320, 180);
            const meta = await sharp(png).metadata();
            expect([meta.format, meta.width, meta.height]).toEqual(['png', 320, 180]);
            const { dominant } = await sharp(png).stats();
            expect(dominant.r).toBeGreaterThan(240);
        });

        it('draws an uploaded logo on the channel colour', async () => {
            await service.save('custom-b-5678', await image(300, 300));
            setCustomRegistry(
                [{ id: 'custom-b-5678', title: 'Beta', streamUrl: 'https://x.test/b.m3u8', color: '#0000ff', streamType: 'auto', logoExt: 'png' }],
                {}
            );
            const { channels } = await sharp(await service.render('custom-b-5678', 200, 200, 'jpeg')).stats();
            expect(channels).toHaveLength(3);
        });

        it('ignores a hand-placed logo that fails the upload checks and falls back to the default', async () => {
            const channel = { id: 'custom-c-9999', title: 'Gamma', streamUrl: 'https://x.test/c.m3u8', color: '#0000ff', streamType: 'auto' as const, logoExt: 'png' };
            setCustomRegistry([channel], {});
            fs.mkdirSync(path.join(dir, 'logos'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'logos', 'custom-c-9999.png'), await image(50, 50));
            const spy = jest.spyOn(service, 'validate');
            const png = await service.render('custom-c-9999', 200, 200);
            expect(png).toBeDefined();
            expect(spy).toHaveBeenCalledTimes(1);
            // Checked once per file version, not on every render.
            await service.render('custom-c-9999', 200, 200);
            expect(spy).toHaveBeenCalledTimes(1);
            // Replacing it with a valid image is picked up.
            fs.writeFileSync(path.join(dir, 'logos', 'custom-c-9999.png'), await image(300, 300));
            await service.render('custom-c-9999', 200, 200);
            expect(spy).toHaveBeenCalledTimes(2);
            expect(spy).toHaveReturnedTimes(2);
        });

        it('stores a big upload scaled down, keeping its shape', async () => {
            await service.save('custom-d-1111', await image(2000, 1200));
            const stored = await sharp(path.join(dir, 'logos', 'custom-d-1111.png')).metadata();
            expect([stored.width, stored.height]).toEqual([1000, 600]);
            await service.save('custom-e-2222', await image(600, 400));
            expect((await sharp(path.join(dir, 'logos', 'custom-e-2222.png')).metadata()).width).toBe(600);
        });

        it('letterboxes a logo of any shape onto the channel colour at the requested size', async () => {
            await service.save('custom-f-3333', await image(300, 900));
            setCustomRegistry(
                [{ id: 'custom-f-3333', title: 'Phi', streamUrl: 'https://x.test/f.m3u8', color: '#00ff00', streamType: 'auto' as const, logoExt: 'png' }],
                {}
            );
            const png = await service.render('custom-f-3333', 760, 320);
            const meta = await sharp(png).metadata();
            expect([meta.width, meta.height]).toEqual([760, 320]);
            // The tall logo is fitted by height in the middle; the sides are the channel colour.
            const side = await sharp(png).extract({ left: 5, top: 100, width: 10, height: 10 }).stats();
            expect(side.dominant).toMatchObject({ g: expect.any(Number) });
            expect(side.dominant.g).toBeGreaterThan(240);
            expect(side.dominant.r).toBeLessThan(15);
        });

        it('fills behind an uploaded BBC logo with the channel\'s own brand colour when no colour is chosen', async () => {
            fs.mkdirSync(path.join(dir, 'logos', 'defaults'), { recursive: true });
            fs.writeFileSync(path.join(dir, 'logos', 'defaults', 'bbc_one_london.svg'), '<svg viewBox="0 0 24 24"><rect fill="#bb1919"/></svg>');
            await service.save('bbc_one_london', await image(300, 300, 'png'));
            setCustomRegistry([], { bbc_one_london: { logoExt: 'png' } });
            const png = await service.render('bbc_one_london', 760, 320);
            const corner = await sharp(png).extract({ left: 2, top: 2, width: 8, height: 8 }).stats();
            // Colour statistics are bucketed, so compare approximately.
            expect(corner.dominant.r).toBeGreaterThan(170);
            expect(corner.dominant.g).toBeLessThan(40);
            expect(corner.dominant.b).toBeLessThan(40);
        });

        it('serves a repeat request from cache and redraws when the look changes', async () => {
            const channel = { id: 'custom-g-4444', title: 'Gamma', streamUrl: 'https://x.test/g.m3u8', color: '#112233', streamType: 'auto' as const };
            setCustomRegistry([channel], {});
            const first = await service.render('custom-g-4444', 200, 100);
            expect(await service.render('custom-g-4444', 200, 100)).toBe(first);
            setCustomRegistry([{ ...channel, color: '#ffeeaa' }], {});
            expect(await service.render('custom-g-4444', 200, 100)).not.toBe(first);
        });

        it('returns nothing for an unknown channel', async () => {
            expect(await service.render('nope', 100, 100)).toBeUndefined();
        });
    });
});
