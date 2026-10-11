import browseService from '../../src/service/browseService';
import configService from '../../src/service/configService';
import liveTvChannelService from '../../src/service/liveTvChannelService';
import liveTvService, { escapeXml, guideTags, xmltvTime } from '../../src/service/liveTvService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/liveTvChannelService', () => ({ __esModule: true, default: { list: jest.fn() } }));
jest.mock('../../src/service/browseService', () => ({
    __esModule: true,
    default: { schedule: jest.fn(), channelLogo: jest.fn() },
}));

const params: Record<string, string> = {
    STREAM_BASE_URL: 'http://host:4404/',
    STREAM_KEY: 'sk',
    LIVE_TV_ENABLED: 'true',
    LIVE_TV_EPG_OFFSET: '0',
};

describe('liveTvService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => params[p]);
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_two_england', 'bbc_four']);
    });

    it('escapes XML and formats UTC timestamps', () => {
        expect(escapeXml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
        // Local (Europe/London) wall-clock time with its real offset: BST in summer, GMT in winter.
        expect(xmltvTime('2026-07-01T18:00:00Z', 0, 'Europe/London')).toBe('20260701190000 +0100');
        expect(xmltvTime('2026-12-01T18:00:00Z', 0, 'Europe/London')).toBe('20261201180000 +0000');
        // The manual offset shifts the instant.
        expect(xmltvTime('2026-12-01T18:00:00Z', 90, 'Europe/London')).toBe('20261201193000 +0000');
        expect(xmltvTime('2026-12-01T18:00:00Z', -60, 'Europe/London')).toBe('20261201170000 +0000');
        expect(xmltvTime('2026-12-01T18:00:00Z', 0, 'America/New_York')).toBe('20261201130000 -0500');
        expect(xmltvTime('2026-12-01T18:00:00Z', 0, 'Asia/Kolkata')).toBe('20261201233000 +0530');
        // Midnight is 00, never 24.
        expect(xmltvTime('2026-12-01T00:00:00Z', 0, 'UTC')).toBe('20261201000000 +0000');
    });

    it('reports enabled state from config', async () => {
        expect(await liveTvService.isEnabled()).toBe(true);
        params.LIVE_TV_ENABLED = 'false';
        expect(await liveTvService.isEnabled()).toBe(false);
        params.LIVE_TV_ENABLED = 'true';
    });

    it('builds an M3U of only the selected channels, with stable channel numbers', async () => {
        const m3u = await liveTvService.playlist();
        expect(m3u.startsWith('#EXTM3U\n')).toBe(true);
        expect(m3u).toContain('tvg-id="bbc_two_england" tvg-name="BBC Two" tvg-chno="2"');
        expect(m3u).toContain('tvg-id="bbc_four" tvg-name="BBC Four" tvg-chno="4"');
        expect(m3u).toContain('tvg-logo="http://host:4404/api?mode=live_logo&channel=bbc_two_england&v=png-landscape&streamkey=sk"');
        expect(m3u).toContain('http://host:4404/api/live.m3u8?mode=stream&pid=bbc_two_england&streamkey=sk');
        expect(m3u).not.toContain('bbc_one_london');
    });

    it('is an empty tuner when nothing is selected', async () => {
        (liveTvChannelService.list as jest.Mock).mockResolvedValue([]);
        expect(await liveTvService.playlist()).toBe('#EXTM3U\n');
        const xml = await liveTvService.epg();
        expect(xml).not.toContain('<channel ');
        expect(browseService.schedule).not.toHaveBeenCalled();
    });

    it('builds the tuner and guide URLs, and needs a base URL', async () => {
        expect(await liveTvService.playlistUrl()).toBe('http://host:4404/api?mode=live_playlist&streamkey=sk');
        expect(await liveTvService.epgUrl()).toMatch(/^http:\/\/host:4404\/api\?mode=live_epg&streamkey=sk&v=[0-9a-f]{8}$/);
        const saved = params.STREAM_BASE_URL;
        params.STREAM_BASE_URL = '';
        await expect(liveTvService.playlistUrl()).rejects.toThrow('Stream Base URL');
        params.STREAM_BASE_URL = saved;
    });

    it('changes the guide URL when the enabled channels or EPG offset change, and not otherwise', async () => {
        const before = await liveTvService.epgUrl();
        expect(await liveTvService.epgUrl()).toBe(before);
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_four', 'bbc_two_england']);
        expect(await liveTvService.epgUrl()).toBe(before); // order doesn't matter
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_four']);
        const fewer = await liveTvService.epgUrl();
        expect(fewer).not.toBe(before);
        params.LIVE_TV_EPG_OFFSET = '30';
        expect(await liveTvService.epgUrl()).not.toBe(fewer);
        params.LIVE_TV_EPG_OFFSET = '0';
    });

    it('builds XMLTV from the browse schedule, deduping overlapping days', async () => {
        const slot = {
            item: { title: 'News & Weather', episodeTitle: 'Late', synopsis: 'Headlines' },
            start: '2026-07-01T18:00:00Z',
            end: '2026-07-01T18:30:00Z',
        };
        (browseService.schedule as jest.Mock).mockResolvedValue([
            { channel: { id: 'bbc_two_england' }, slots: [slot] },
            { channel: { id: 'bbc_one_london' }, slots: [slot] },
        ]);
        const xml = await liveTvService.epg();
        expect(xml).toContain('<channel id="bbc_two_england">');
        expect(xml).not.toContain('bbc_one_london');
        expect(xml.match(/<programme /g)).toHaveLength(1);
        expect(xml).toContain(`start="${xmltvTime(slot.start)}" stop="${xmltvTime(slot.end)}" channel="bbc_two_england"`);
        expect(xml).toContain('<title lang="en">News &amp; Weather</title>');
        expect(xml).toContain('<sub-title lang="en">Late</sub-title>');
        expect(xml).toContain('<desc lang="en">Headlines</desc>');
        // No image on the slot, so no <icon>.
        expect(xml).not.toContain('<icon');
    });

    it('adds a stream-key programme image to slots that have one', async () => {
        (browseService.schedule as jest.Mock).mockResolvedValue([
            {
                channel: { id: 'bbc_four' },
                slots: [
                    { item: { title: 'X', thumbnail: 'json-api/thumbnail/p0abc123.jpg' }, start: '2026-12-01T18:00:00Z', end: '2026-12-01T19:00:00Z' },
                    { item: { title: 'Y' }, start: '2026-12-01T19:00:00Z', end: '2026-12-01T20:00:00Z' },
                ],
            },
        ]);
        const xml = await liveTvService.epg();
        expect(xml).toContain('<icon src="http://host:4404/api?mode=live_thumb&amp;pid=p0abc123&amp;streamkey=sk"/>');
        expect(xml.match(/<icon /g)).toHaveLength(1);
    });

    it('applies the manual EPG offset', async () => {
        params.LIVE_TV_EPG_OFFSET = '60';
        (browseService.schedule as jest.Mock).mockResolvedValue([
            {
                channel: { id: 'bbc_four' },
                slots: [{ item: { title: 'X' }, start: '2026-12-01T18:00:00Z', end: '2026-12-01T19:00:00Z' }],
            },
        ]);
        const xml = await liveTvService.epg();
        expect(xml).toContain(`start="${xmltvTime('2026-12-01T19:00:00Z')}" stop="${xmltvTime('2026-12-01T20:00:00Z')}"`);
        params.LIVE_TV_EPG_OFFSET = '0';
    });

    it('still returns a valid guide when a day fails to load', async () => {
        (browseService.schedule as jest.Mock).mockRejectedValue(new Error('boom'));
        const xml = await liveTvService.epg();
        expect(xml).toContain('<tv ');
        expect(xml).not.toContain('<programme');
    });

    it('serves a logo only for live channels', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="#bb1919"/><rect x="6" y="6" width="12" height="12" fill="#ffffff"/></svg>';
        (browseService.channelLogo as jest.Mock).mockResolvedValue(svg);
        const png = await liveTvService.logo('bbc_one_london');
        expect(png?.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        // Landscape by default (and square on request), not the SVG's native 24px.
        const { default: sharp } = await import('sharp');
        expect(await sharp(png).metadata()).toMatchObject({ width: 1600, height: 900 });
        params.LIVE_TV_LOGO_SHAPE = 'square';
        const square = await liveTvService.logo('bbc_one_london');
        expect(await sharp(square).metadata()).toMatchObject({ width: 1000, height: 1000 });
        expect(await liveTvService.playlist()).toContain('v=png-square');
        delete params.LIVE_TV_LOGO_SHAPE;
        expect(await liveTvService.logo('nope')).toBeUndefined();
    });

    describe('guideTags', () => {
        const slot = {
            item: { pid: 'p1', kind: 'episode', type: 'tv', title: 'Match', category: 'Sport' },
            start: '2026-10-11T10:00:00Z',
            end: '2026-10-11T11:00:00Z',
            live: true,
            categories: ['sport'],
        } as any;
        const all = { categories: true, flags: true, hd: true };

        it('emits category, HD and live/new tags', () => {
            const xml = guideTags(slot, all);
            expect(xml).toContain('<category lang="en">Sport</category>');
            expect(xml).toContain('<category lang="en">Sports</category>');
            expect(xml).toContain('<video><quality>HDTV</quality></video>');
            expect(xml).toContain('<live/>');
            expect(xml).toContain('<new/>');
            expect(xml).not.toContain('previously-shown');
        });

        it('marks repeats and maps film and kids categories', () => {
            const xml = guideTags(
                { ...slot, live: undefined, repeat: true, childrens: true, item: { ...slot.item, category: 'Film - Family' } },
                all
            );
            expect(xml).toContain('<previously-shown/>');
            expect(xml).toContain('>Movie<');
            expect(xml).toContain('>Kids<');
            expect(xml).not.toContain('<new/>');
        });

        it('emits nothing when every option is off', () => {
            expect(guideTags(slot, { categories: false, flags: false, hd: false })).toBe('');
        });
    });
});
