import { CustomChannel, setCustomRegistry } from '../../src/constants/CustomChannels';
import browseService from '../../src/service/browseService';
import channelLogoService from '../../src/service/channelLogoService';
import configService from '../../src/service/configService';
import liveTvChannelService from '../../src/service/liveTvChannelService';
import liveTvService, { escapeXml, guideTags } from '../../src/service/liveTvService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/channelLogoService', () => ({ __esModule: true, default: { render: jest.fn() } }));
jest.mock('../../src/service/liveTvChannelService', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../../src/service/browseService', () => ({
    __esModule: true,
    default: { schedule: jest.fn(), channelLogo: jest.fn(), refreshSchedule: jest.fn() },
}));

let params: Record<string, string | undefined>;
const custom = (over: Partial<CustomChannel> = {}): CustomChannel => ({
    id: 'custom-a-1234',
    title: 'Alpha',
    streamUrl: 'https://x.test/a.m3u8',
    streamType: 'auto',
    color: '#654355',
    ...over,
});
const slot = (over: object = {}) => ({ item: { pid: 'b001', title: 'T', kind: 'episode', type: 'TV' }, start: 'a', end: 'b', ...over }) as any;
const all = { categories: true, flags: true, hd: true };

describe('liveTvService branches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        params = { STREAM_BASE_URL: 'http://host:4404/', STREAM_KEY: 'sk', LIVE_TV_ENABLED: 'true', LIVE_TV_EPG_OFFSET: '0' };
        (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => params[p]);
        (liveTvChannelService.list as jest.Mock).mockResolvedValue([]);
    });
    afterEach(() => setCustomRegistry([], {}));

    it('escapes nothing into an empty string', () => {
        expect(escapeXml(undefined)).toBe('');
    });

    describe('guide tags', () => {
        it('tags sport and news by slug or by the category name, and a film by slug or name', () => {
            expect(guideTags(slot({ item: { ...slot().item, category: 'Football' }, categories: ['sport'] }), all)).toContain('>Sports<');
            expect(guideTags(slot({ item: { ...slot().item, category: 'Motor Sport' } }), all)).toContain('>Sports<');
            expect(guideTags(slot({ item: { ...slot().item, category: 'Newsnight' } }), all)).toContain('>News<');
            expect(guideTags(slot({ categories: ['news'] }), all)).toContain('>News<');
            expect(guideTags(slot({ categories: ['films'] }), all)).toContain('>Movie<');
            expect(guideTags(slot({ item: { ...slot().item, category: 'Films & Cinema' } }), all)).toContain('>Movie<');
        });

        it('has no category tags for a slot with no category at all', () => {
            expect(guideTags(slot(), { categories: true, flags: false, hd: false })).toBe('');
        });

        it('marks live programmes, and repeats versus new ones', () => {
            const none = { categories: false, flags: true, hd: false };
            expect(guideTags(slot({ live: true }), none)).toBe('    <live/>\n    <new/>\n');
            expect(guideTags(slot({ repeat: true }), none)).toBe('    <previously-shown/>\n');
        });
    });

    describe('settings', () => {
        it.each([[undefined], ['soon'], ['']])('uses no EPG offset for %j', async (value) => {
            params.LIVE_TV_EPG_OFFSET = value;
            expect(await liveTvService.epgOffsetMinutes()).toBe(0);
        });

        it('reads a numeric offset, including a negative one', async () => {
            params.LIVE_TV_EPG_OFFSET = '-30';
            expect(await liveTvService.epgOffsetMinutes()).toBe(-30);
        });

        it('treats the guide options as on unless set to false', async () => {
            params.LIVE_TV_GUIDE_HD = 'false';
            expect(await liveTvService.guideOptions()).toEqual({ categories: true, flags: true, hd: false });
        });

        it('chooses a square logo only when asked', async () => {
            params.LIVE_TV_LOGO_SHAPE = 'square';
            expect(await liveTvService.logoShape()).toBe('square');
            params.LIVE_TV_LOGO_SHAPE = 'round';
            expect(await liveTvService.logoShape()).toBe('landscape');
        });
    });

    describe('playlist', () => {
        it('builds the guide URL with an empty key when none is set', async () => {
            params.STREAM_KEY = undefined;
            expect(await liveTvService.epgUrl()).toMatch(/streamkey=&v=[0-9a-f]{8}$/);
            expect(await liveTvService.playlistUrl()).toContain('streamkey=');
        });

        it('uses empty strings when there is no stream key or base URL', async () => {
            params.STREAM_KEY = undefined;
            params.STREAM_BASE_URL = undefined;
            (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_four']);
            const m3u = await liveTvService.playlist();
            expect(m3u).toContain('/api/live.m3u8?mode=stream&pid=bbc_four&streamkey=\n');
            expect(m3u).toContain('tvg-logo="/api?mode=live_logo');
        });

        it('lists a custom channel in its own group (or "Custom"), with a logo of its own and its chosen number', async () => {
            setCustomRegistry([custom({ group: 'News' }), custom({ id: 'custom-b-5678', title: 'Beta', channelNumber: 77 })], {});
            (liveTvChannelService.list as jest.Mock).mockResolvedValue(['custom-a-1234', 'custom-b-5678']);
            const m3u = await liveTvService.playlist();
            expect(m3u).toContain('group-title="News"');
            expect(m3u).toContain('group-title="Custom"');
            expect(m3u).toContain('tvg-chno="77"');
            expect(m3u).toContain('mode=live_logo&channel=custom-a-1234');
        });

        it('keeps a quote in a custom channel\'s group from breaking out of the attribute', async () => {
            setCustomRegistry([custom({ group: 'The "Best"' })], {});
            (liveTvChannelService.list as jest.Mock).mockResolvedValue(['custom-a-1234']);
            expect(await liveTvService.playlist()).toContain('group-title="The Best"');
        });
    });

    describe('refreshGuide', () => {
        it('refreshes eight days of schedule, one at a time, when Live TV is on', async () => {
            await liveTvService.refreshGuide();
            expect(browseService.refreshSchedule).toHaveBeenCalledTimes(8);
        });

        it('does nothing when Live TV is off', async () => {
            params.LIVE_TV_ENABLED = 'false';
            await liveTvService.refreshGuide();
            expect(browseService.refreshSchedule).not.toHaveBeenCalled();
        });
    });

    describe('logo', () => {
        it('draws a custom channel\'s logo in the chosen shape', async () => {
            setCustomRegistry([custom()], {});
            (channelLogoService.render as jest.Mock).mockResolvedValue(Buffer.from('png'));
            params.LIVE_TV_LOGO_SHAPE = 'square';
            expect(await liveTvService.logo('custom-a-1234')).toEqual(Buffer.from('png'));
            expect((channelLogoService.render as jest.Mock).mock.calls[0].slice(0, 3)).toEqual(['custom-a-1234', expect.any(Number), expect.any(Number)]);
            const [, w, h] = (channelLogoService.render as jest.Mock).mock.calls[0];
            expect(w).toBe(h);
        });

        it('has no logo for a channel it does not know, or one whose icon is unavailable', async () => {
            (browseService.channelLogo as jest.Mock).mockResolvedValue(undefined);
            expect(await liveTvService.logo('nope')).toBeUndefined();
            expect(await liveTvService.logo('bbc_four')).toBeUndefined();
        });

        it('rasterises an icon with no fill or viewBox on black at a default scale', async () => {
            (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10" stroke="#fff"/></svg>');
            const png = await liveTvService.logo('bbc_four');
            expect(png?.subarray(1, 4).toString()).toBe('PNG');
        });
    });
});
