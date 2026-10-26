import customChannelFacade from '../../src/facade/customChannelFacade';
import browseService from '../../src/service/browseService';
import channelLogoService from '../../src/service/channelLogoService';
import customChannelService, { CustomChannelError } from '../../src/service/customChannelService';
import liveChannelService from '../../src/service/liveChannelService';
import liveSubscriptionService from '../../src/service/liveSubscriptionService';
import liveTvChannelService from '../../src/service/liveTvChannelService';
import liveTvSyncService from '../../src/service/liveTvSyncService';
import loggingService from '../../src/service/loggingService';
import streamProbeService from '../../src/service/streamProbeService';

jest.mock('../../src/service/browseService');
jest.mock('../../src/service/channelLogoService');
jest.mock('../../src/service/customChannelService', () => ({
    __esModule: true,
    ...jest.requireActual('../../src/service/customChannelService'),
    default: {
        load: jest.fn(),
        startHealthChecks: jest.fn(),
        list: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        customise: jest.fn(),
        reset: jest.fn(),
        setLogo: jest.fn(),
        removeLogo: jest.fn(),
        test: jest.fn(),
        exportChannels: jest.fn(),
        parseM3u: jest.fn(),
        importChannels: jest.fn(),
    },
}));
jest.mock('../../src/service/liveChannelService');
jest.mock('../../src/service/liveSubscriptionService');
jest.mock('../../src/service/liveTvChannelService');
jest.mock('../../src/service/liveTvSyncService');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/streamProbeService');

const settings = [{ id: 'a' }] as any;
const input = { title: 'News', streamUrl: 'http://x/y.m3u8' } as any;

describe('customChannelFacade', () => {
    beforeEach(() => {
        (liveChannelService.list as jest.Mock).mockResolvedValue(settings);
        (liveTvChannelService.list as jest.Mock).mockResolvedValue([]);
    });

    describe.each([
        ['create', ['create', input]],
        ['update', ['update', 'c1', input]],
        ['customise', ['customise', 'bbc_one', input]],
        ['reset', ['reset', 'bbc_one']],
        ['setLogo', ['setLogo', 'c1', Buffer.from('x')]],
        ['removeLogo', ['removeLogo', 'c1']],
    ])('%s', (name, [method, ...args]) => {
        it('applies the change, resyncs subscriptions, tells Jellyfin and returns the channel list', async () => {
            const result = await (customChannelFacade as any)[method as string](...args);
            expect((customChannelService as any)[name]).toHaveBeenCalledWith(...args);
            expect(liveSubscriptionService.resync).toHaveBeenCalled();
            expect(liveTvSyncService.notifyChanged).toHaveBeenCalled();
            expect(result).toBe(settings);
        });

        it('does not resync when the change is rejected', async () => {
            (customChannelService as any)[name].mockRejectedValueOnce(new CustomChannelError('bad'));
            await expect((customChannelFacade as any)[method as string](...args)).rejects.toThrow('bad');
            expect(liveSubscriptionService.resync).not.toHaveBeenCalled();
            expect(liveTvSyncService.notifyChanged).not.toHaveBeenCalled();
        });
    });

    describe('remove', () => {
        it('unsubscribes, drops the channel from Live TV when it is there, then deletes it', async () => {
            (liveTvChannelService.list as jest.Mock).mockResolvedValue(['c1']);
            const result = await customChannelFacade.remove('c1');
            expect(liveSubscriptionService.unsubscribe).toHaveBeenCalledWith('c1');
            expect(liveTvChannelService.remove).toHaveBeenCalledWith('c1');
            expect(customChannelService.remove).toHaveBeenCalledWith('c1');
            expect(liveTvSyncService.notifyChanged).toHaveBeenCalled();
            expect(result).toBe(settings);
        });

        it('skips the Live TV removal when the channel was never added there', async () => {
            await customChannelFacade.remove('c1');
            expect(liveTvChannelService.remove).not.toHaveBeenCalled();
            expect(customChannelService.remove).toHaveBeenCalledWith('c1');
        });
    });

    describe('startup', () => {
        it('loads channels, starts health checks and fetches the default logos', async () => {
            (channelLogoService.downloadDefaults as jest.Mock).mockResolvedValue(2);
            await customChannelFacade.startup();
            expect(customChannelService.load).toHaveBeenCalled();
            expect(customChannelService.startHealthChecks).toHaveBeenCalled();
            expect(channelLogoService.downloadDefaults).toHaveBeenCalled();
        });

        it('passes the BBC logo lookup to the downloader', async () => {
            (browseService.channelLogo as jest.Mock).mockResolvedValue('logo');
            (channelLogoService.downloadDefaults as jest.Mock).mockImplementation(async (_channels, fetchLogo) => {
                await fetchLogo('bbc_one');
                return 1;
            });
            await customChannelFacade.downloadDefaultLogos();
            expect(browseService.channelLogo).toHaveBeenCalledWith('bbc_one');
        });

        it('logs rather than fails when the logo download errors', async () => {
            (channelLogoService.downloadDefaults as jest.Mock).mockRejectedValue(new Error('offline'));
            await expect(customChannelFacade.startup()).resolves.toBeUndefined();
            await new Promise((resolve) => setImmediate(resolve));
            expect(loggingService.error).toHaveBeenCalledWith('Default logo download failed: offline');
        });
    });

    describe('passthroughs', () => {
        it('lists, probes, tests and exports via the services', async () => {
            (customChannelService.list as jest.Mock).mockReturnValue(['c']);
            (streamProbeService.probe as jest.Mock).mockResolvedValue({ ok: true });
            (customChannelService.test as jest.Mock).mockResolvedValue({ ok: false });
            (customChannelService.exportChannels as jest.Mock).mockReturnValue({ version: 1, channels: [] });

            expect(customChannelFacade.list()).toEqual(['c']);
            await expect(customChannelFacade.probe('http://x', { A: 'b' })).resolves.toEqual({ ok: true });
            expect(streamProbeService.probe).toHaveBeenCalledWith('http://x', { A: 'b' });
            await expect(customChannelFacade.test('c1')).resolves.toEqual({ ok: false });
            expect(customChannelFacade.exportChannels()).toEqual({ version: 1, channels: [] });
        });
    });

    describe('importChannels', () => {
        beforeEach(() => {
            (customChannelService.importChannels as jest.Mock).mockResolvedValue({ added: 1, skipped: [] });
        });

        it('imports a JSON channel list and returns the result with the refreshed channels', async () => {
            const result = await customChannelFacade.importChannels({ channels: [input] });
            expect(customChannelService.importChannels).toHaveBeenCalledWith([input]);
            expect(result).toEqual({ added: 1, skipped: [], channels: settings });
            expect(liveSubscriptionService.resync).toHaveBeenCalled();
        });

        it('parses M3U text in preference to a channel list', async () => {
            (customChannelService.parseM3u as jest.Mock).mockReturnValue([input]);
            await customChannelFacade.importChannels({ m3u: '#EXTM3U', channels: [] });
            expect(customChannelService.parseM3u).toHaveBeenCalledWith('#EXTM3U');
            expect(customChannelService.importChannels).toHaveBeenCalledWith([input]);
        });

        it.each([
            ['an empty body', {}],
            ['an empty list', { channels: [] }],
            ['a non-array list', { channels: 'x' as any }],
            ['M3U with no channels', { m3u: '#EXTM3U' }],
        ])('rejects %s', async (_label, body) => {
            (customChannelService.parseM3u as jest.Mock).mockReturnValue([]);
            await expect(customChannelFacade.importChannels(body)).rejects.toBeInstanceOf(CustomChannelError);
            expect(customChannelService.importChannels).not.toHaveBeenCalled();
        });

        it('rejects a missing body', async () => {
            await expect(customChannelFacade.importChannels(undefined as any)).rejects.toBeInstanceOf(CustomChannelError);
        });
    });
});
