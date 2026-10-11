import fs from 'fs';
import os from 'os';
import path from 'path';

import browseService from '../../src/service/browseService';
import configService from '../../src/service/configService';
import service, { LiveSubscriptionError } from '../../src/service/liveSubscriptionService';
import loggingService from '../../src/service/loggingService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';

const mockStorageData: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => {
    const instance = {
        getItem: jest.fn((key: string) => Promise.resolve(mockStorageData[key])),
        setItem: jest.fn((key: string, value: any) => {
            mockStorageData[key] = value;
            return Promise.resolve();
        }),
    };
    return { QueuedStorage: jest.fn(() => instance), __esModule: true };
});
jest.mock('../../src/service/configService');
jest.mock('../../src/service/browseService', () => ({ __esModule: true, default: { channelLogo: jest.fn() } }));
const mockToBuffer = jest.fn();
const mockSharp = jest.fn();
jest.mock('sharp', () => ({ __esModule: true, default: (...args: any[]) => mockSharp(...args) }), { virtual: true });
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));

describe('liveSubscriptionService', () => {
    let dir: string;
    let baseUrl: string | undefined;

    beforeEach(() => {
        jest.clearAllMocks();
        mockSharp.mockReset();
        (browseService.channelLogo as jest.Mock).mockResolvedValue(undefined);
        dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-')), 'BBC Live');
        baseUrl = 'http://iplayarr:4404';
        Object.keys(mockStorageData).forEach((k) => delete mockStorageData[k]);
        (configService.getParameter as jest.Mock).mockImplementation(async (p: IplayarrParameter) => {
            if (p === IplayarrParameter.LIVE_STRM_DIR) return dir;
            if (p === IplayarrParameter.STREAM_BASE_URL) return baseUrl;
            if (p === IplayarrParameter.STREAM_KEY) return 'k3y';
            return undefined;
        });
    });

    it('writes a .strm for a live channel, creating the folder, and tracks it', async () => {
        const sub = await service.subscribe('bbc_one_london');

        expect(sub).toMatchObject({ channelId: 'bbc_one_london', title: 'BBC One', file: 'BBC One.strm' });
        expect(fs.readFileSync(path.join(dir, 'BBC One.strm'), 'utf8')).toBe(
            'http://iplayarr:4404/api?mode=stream&pid=bbc_one_london&streamkey=k3y'
        );
        expect(await service.list()).toHaveLength(1);
    });

    it('falls back to the Complete Directory when the live directory is blank', async () => {
        const complete = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'live-')), 'complete');
        const original = dir;
        (configService.getParameter as jest.Mock).mockImplementation(async (p: IplayarrParameter) => {
            if (p === IplayarrParameter.LIVE_STRM_DIR) return '  ';
            if (p === IplayarrParameter.COMPLETE_DIR) return complete;
            if (p === IplayarrParameter.STREAM_BASE_URL) return baseUrl;
            return undefined;
        });

        await service.subscribe('bbc_one_london');

        expect(fs.existsSync(path.join(complete, 'BBC One.strm'))).toBe(true);
        expect(fs.existsSync(original)).toBe(false);
    });

    it('is idempotent', async () => {
        await service.subscribe('bbc_two_england');
        await service.subscribe('bbc_two_england');
        expect(await service.list()).toHaveLength(1);
    });

    it('rejects ids that are not live channels', async () => {
        await expect(service.subscribe('m0032yps')).rejects.toThrow(LiveSubscriptionError);
        await expect(service.subscribe('../../etc')).rejects.toThrow(LiveSubscriptionError);
        expect(fs.existsSync(dir)).toBe(false);
    });

    it('refuses without a stream base url', async () => {
        baseUrl = undefined;
        await expect(service.subscribe('bbc_one_london')).rejects.toThrow('Stream Base URL');
        expect(await service.list()).toHaveLength(0);
    });

    it('subscribeAll adds every live channel', async () => {
        const all = await service.subscribeAll();
        expect(all.length).toBeGreaterThan(5);
        expect(fs.readdirSync(dir).filter((f) => f.endsWith('.strm'))).toHaveLength(all.length);
    });

    it('unsubscribe deletes only the tracked file', async () => {
        await service.subscribe('bbc_one_london');
        await service.subscribe('bbc_four');
        fs.writeFileSync(path.join(dir, 'Other.strm'), 'x');

        expect(await service.unsubscribe('bbc_one_london')).toBe(true);
        expect(fs.readdirSync(dir).sort()).toEqual(['BBC Four.nfo', 'BBC Four.strm', 'Other.strm']);
        expect(await service.unsubscribe('bbc_one_london')).toBe(false);
    });

    it('resync rewrites files after the stream url changes', async () => {
        await service.subscribe('bbc_one_london');
        baseUrl = 'http://new-host:1';
        await service.resync();
        expect(fs.readFileSync(path.join(dir, 'BBC One.strm'), 'utf8')).toContain('http://new-host:1/api');
    });

    describe('sidecar metadata', () => {
        const chain = () => {
            const c: any = {};
            c.resize = jest.fn(() => c);
            c.flatten = jest.fn(() => c);
            c.jpeg = jest.fn(() => c);
            c.toBuffer = mockToBuffer;
            mockSharp.mockReturnValue(c);
            return c;
        };

        it('writes a locked .nfo beside the .strm, with no poster when there is no logo', async () => {
            await service.subscribe('bbc_one_london');
            const nfo = fs.readFileSync(path.join(dir, 'BBC One.nfo'), 'utf8');
            expect(nfo).toContain('<title>BBC One</title>');
            expect(nfo).toContain('<lockdata>true</lockdata>');
            expect(fs.existsSync(path.join(dir, 'BBC One-poster.jpg'))).toBe(false);
        });

        it('rasterises the channel logo onto its own background colour as the poster', async () => {
            const c = chain();
            mockToBuffer.mockResolvedValue(Buffer.from('jpegdata'));
            (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg><rect fill="#FF0000"/></svg>');

            await service.subscribe('bbc_one_london');

            expect(browseService.channelLogo).toHaveBeenCalledWith('bbc_one');
            expect(mockSharp).toHaveBeenCalledWith(expect.any(Buffer), { density: 300 });
            expect(c.resize).toHaveBeenCalledWith(1000, 1000, { fit: 'contain', background: '#FF0000' });
            expect(c.flatten).toHaveBeenCalledWith({ background: '#FF0000' });
            expect(fs.readFileSync(path.join(dir, 'BBC One-poster.jpg'), 'utf8')).toBe('jpegdata');
        });

        it('defaults to a black background when the logo has no fill', async () => {
            const c = chain();
            mockToBuffer.mockResolvedValue(Buffer.from('x'));
            (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg></svg>');

            await service.subscribe('bbc_one_london');

            expect(c.flatten).toHaveBeenCalledWith({ background: '#000000' });
        });

        it('still keeps the .strm and logs when the poster cannot be generated', async () => {
            mockSharp.mockImplementation(() => {
                throw new Error('no native binary');
            });
            (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg></svg>');

            await service.subscribe('bbc_one_london');

            expect(fs.existsSync(path.join(dir, 'BBC One.strm'))).toBe(true);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('no native binary'));
        });

        it('unsubscribe removes the .nfo and poster too, but nothing else', async () => {
            chain();
            mockToBuffer.mockResolvedValue(Buffer.from('x'));
            (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg></svg>');
            await service.subscribe('bbc_one_london');
            fs.writeFileSync(path.join(dir, 'BBC One-fanart.jpg'), 'keep');

            await service.unsubscribe('bbc_one_london');

            expect(fs.readdirSync(dir)).toEqual(['BBC One-fanart.jpg']);
        });
    });
});
