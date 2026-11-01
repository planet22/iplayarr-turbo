import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

import { CustomChannel, setCustomRegistry } from '../../src/constants/CustomChannels';
import service, { LogoError } from '../../src/service/channelLogoService';
import loggingService from '../../src/service/loggingService';

jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn(), log: jest.fn(), debug: jest.fn() } }));

type Format = 'png' | 'jpeg' | 'webp' | 'gif';
const image = (width: number, height: number, format: Format = 'png', background = '#ff0000') =>
    sharp({ create: { width, height, channels: 3, background } })[format]().toBuffer();

const custom = (over: Partial<CustomChannel> = {}): CustomChannel => ({
    id: 'custom-a-1234',
    title: 'Alpha',
    streamUrl: 'https://x.test/a.m3u8',
    streamType: 'auto',
    color: '#0000ff',
    ...over,
});

describe('channelLogoService branches', () => {
    let dir: string;
    const previous = process.env.CONFIG_LOCATION;

    const writeUser = (name: string, data: Buffer | string) => {
        fs.mkdirSync(path.join(dir, 'logos'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'logos', name), data);
    };
    const writeDefault = (id: string, svg: string) => {
        fs.mkdirSync(path.join(dir, 'logos', 'defaults'), { recursive: true });
        fs.writeFileSync(path.join(dir, 'logos', 'defaults', `${id}.svg`), svg);
    };

    beforeEach(() => {
        jest.clearAllMocks();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-logos-branches-'));
        process.env.CONFIG_LOCATION = dir;
    });
    afterEach(() => {
        setCustomRegistry([], {});
        process.env.CONFIG_LOCATION = previous;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    describe('validating an SVG', () => {
        it('reads its size from width and height when it has no viewBox', async () => {
            expect(await service.validate(Buffer.from('<svg width="200" height="100"></svg>'))).toMatchObject({ ext: 'svg', width: 200, height: 100 });
        });

        it('accepts one that states no size at all', async () => {
            const info = await service.validate(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'));
            expect(info).toEqual({ ext: 'svg', width: undefined, height: undefined });
        });

        it('refuses a stretched one measured by width and height', async () => {
            await expect(service.validate(Buffer.from('<svg width="900" height="100"></svg>'))).rejects.toThrow(/within 3:1/);
        });

        it('accepts a data: image link but refuses an entity declaration', async () => {
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 10 10"><image href="data:image/png;base64,AAAA"/></svg>'))).resolves.toBeDefined();
            await expect(service.validate(Buffer.from('<svg viewBox="0 0 10 10"><!ENTITY a "b"></svg>'))).rejects.toThrow(/scripts/);
        });
    });

    describe('validating a raster image', () => {
        it('accepts WebP', async () => {
            expect((await service.validate(await image(300, 300, 'webp'))).ext).toBe('webp');
        });

        it('refuses a format that is readable but not supported', async () => {
            await expect(service.validate(await image(300, 300, 'gif'))).rejects.toThrow('Logos must be PNG, JPG, WebP or SVG images');
        });

        it('refuses a file that is not an image at all', async () => {
            await expect(service.validate(Buffer.from('definitely not an image, just text that is long enough'))).rejects.toThrow(/not a readable/);
        });
    });

    describe('saving a large upload', () => {
        it.each([
            ['png', 'png'],
            ['jpeg', 'jpg'],
            ['webp', 'webp'],
        ] as const)('scales a %s down to 1000px, keeping its type', async (format, ext) => {
            expect(await service.save('custom-big-1111', await image(1600, 1600, format))).toBe(ext);
            const meta = await sharp(fs.readFileSync(path.join(dir, 'logos', `custom-big-1111.${ext}`))).metadata();
            expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1000);
        });

        it('keeps a small upload exactly as sent', async () => {
            const original = await image(300, 300);
            await service.save('custom-small-2222', original);
            expect(fs.readFileSync(path.join(dir, 'logos', 'custom-small-2222.png')).equals(original)).toBe(true);
        });

        it('stores an SVG that states no size', async () => {
            expect(await service.save('custom-nosize-4444', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'))).toBe('svg');
        });

        it('keeps an SVG exactly as sent however big it claims to be', async () => {
            const svg = Buffer.from('<svg viewBox="0 0 5000 4000"></svg>');
            await service.save('custom-svg-3333', svg);
            expect(fs.readFileSync(path.join(dir, 'logos', 'custom-svg-3333.svg')).equals(svg)).toBe(true);
        });
    });

    describe('brandColor', () => {
        it('reads the first fill of the downloaded icon, and nothing when there is no icon', () => {
            expect(service.brandColor('bbc_one_london')).toBeUndefined();
            writeDefault('bbc_one_london', '<svg><rect fill="#e60028"/></svg>');
            expect(service.brandColor('bbc_one_london')).toBe('#e60028');
            writeDefault('bbc_two_england', '<svg><rect/></svg>');
            expect(service.brandColor('bbc_two_england')).toBeUndefined();
        });

        it('gives nothing for an id that would leave the logos folder', () => {
            expect(service.brandColor('../../etc/passwd')).toBeUndefined();
        });
    });

    describe('choosing what to draw', () => {
        const logoOf = async (id: string) => sharp((await service.render(id, 200, 200)) as Buffer);

        it('uses the default icon when the uploaded file is another kind than the channel says', async () => {
            writeUser('custom-a-1234.png', await image(300, 300, 'jpeg'));
            writeDefault('custom-a-1234', '<svg viewBox="0 0 24 24"><rect width="24" height="24" fill="#00ff00"/></svg>');
            setCustomRegistry([custom({ logoExt: 'png', color: '#0000ff' })], {});
            expect(await service.render('custom-a-1234', 200, 200)).toBeDefined();
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('it is a jpg file, not png'));
        });

        it('draws nothing for a channel it knows nothing about', async () => {
            expect(await service.render('not-a-channel', 200, 200)).toBeUndefined();
        });

        it('takes the background from an uploaded SVG\'s fill when no colour is chosen', async () => {
            writeUser('custom-a-1234.svg', '<svg viewBox="0 0 24 24"><rect fill="#00ff00" width="24" height="24"/></svg>');
            setCustomRegistry([custom({ logoExt: 'svg', color: undefined })], {});
            const { dominant } = await (await logoOf('custom-a-1234')).stats();
            expect(dominant.g).toBeGreaterThan(200);
        });

        it('takes it from the default icon when the upload has none, and from grey when neither does', async () => {
            writeUser('custom-a-1234.png', await image(300, 300, 'png', '#ff0000'));
            writeDefault('custom-a-1234', '<svg viewBox="0 0 24 24"><rect fill="#00ff00"/></svg>');
            setCustomRegistry([custom({ logoExt: 'png', color: undefined })], {});
            await expect(service.render('custom-a-1234', 200, 200)).resolves.toBeDefined();

            setCustomRegistry([custom({ id: 'custom-b-5678', title: 'Beta', color: undefined })], {});
            const { dominant } = await (await logoOf('custom-b-5678')).stats();
            expect(Math.abs(dominant.r - 0x33)).toBeLessThan(20);
        });

        it('draws a logo with text under it, and a text-only channel with larger text', async () => {
            writeUser('custom-a-1234.png', await image(300, 300));
            setCustomRegistry([custom({ logoExt: 'png', logoText: 'HD' }), custom({ id: 'custom-b-5678', title: 'Beta', logoText: undefined })], {});
            expect(await service.render('custom-a-1234', 320, 180)).toBeDefined();
            expect(await service.render('custom-b-5678', 320, 180)).toBeDefined();
        });

        it('draws a logo with no text edge to edge', async () => {
            writeUser('custom-a-1234.png', await image(300, 300));
            setCustomRegistry([custom({ logoExt: 'png', logoText: undefined })], {});
            const meta = await (await logoOf('custom-a-1234')).metadata();
            expect([meta.width, meta.height]).toEqual([200, 200]);
        });

        it('draws an SVG with no viewBox at a default scale', async () => {
            writeUser('custom-a-1234.svg', '<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#123456"/></svg>');
            setCustomRegistry([custom({ logoExt: 'svg' })], {});
            expect(await service.render('custom-a-1234', 200, 200)).toBeDefined();
        });
    });

    describe('the drawn-logo cache', () => {
        it('serves a repeat from memory and keeps no more than 200 drawings', async () => {
            setCustomRegistry([custom()], {});
            const first = await service.render('custom-a-1234', 32, 32);
            expect(await service.render('custom-a-1234', 32, 32)).toBe(first);
            for (let size = 33; size < 33 + 205; size++) {
                await service.render('custom-a-1234', size, 32);
            }
            // The first drawing was pushed out, so this is drawn afresh (equal pixels, new buffer).
            const again = await service.render('custom-a-1234', 32, 32);
            expect(again).not.toBe(first);
            expect(again?.equals(first as Buffer)).toBe(true);
        }, 60000);
    });

    it('LogoError is an Error with a readable message', () => {
        expect(new LogoError('bad').message).toBe('bad');
        expect(new LogoError('bad')).toBeInstanceOf(Error);
    });
});
