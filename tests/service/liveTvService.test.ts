import browseService from '../../src/service/browseService';
import configService from '../../src/service/configService';
import liveTvService, { escapeXml, xmltvTime } from '../../src/service/liveTvService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/browseService', () => ({
    __esModule: true,
    default: { schedule: jest.fn(), channelLogo: jest.fn() },
}));

const params: Record<string, string> = {
    STREAM_BASE_URL: 'http://host:4404/',
    STREAM_KEY: 'sk',
    LIVE_TV_ENABLED: 'true',
};

describe('liveTvService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (configService.getParameter as jest.Mock).mockImplementation(async (p: string) => params[p]);
    });

    it('escapes XML and formats UTC timestamps', () => {
        expect(escapeXml('a & b <c> "d"')).toBe('a &amp; b &lt;c&gt; &quot;d&quot;');
        expect(xmltvTime('2026-10-11T19:30:00+01:00')).toBe('20261011183000 +0000');
    });

    it('reports enabled state from config', async () => {
        expect(await liveTvService.isEnabled()).toBe(true);
        params.LIVE_TV_ENABLED = 'false';
        expect(await liveTvService.isEnabled()).toBe(false);
        params.LIVE_TV_ENABLED = 'true';
    });

    it('builds an M3U with stream and logo URLs for live channels', async () => {
        const m3u = await liveTvService.playlist();
        expect(m3u.startsWith('#EXTM3U\n')).toBe(true);
        expect(m3u).toContain('tvg-id="bbc_one_london" tvg-name="BBC One" tvg-chno="1"');
        expect(m3u).toContain('tvg-logo="http://host:4404/api?mode=live_logo&channel=bbc_one_london&streamkey=sk"');
        expect(m3u).toContain('http://host:4404/api?mode=stream&pid=bbc_one_london&streamkey=sk');
    });

    it('builds XMLTV from the browse schedule, deduping overlapping days', async () => {
        const slot = {
            item: { title: 'News & Weather', episodeTitle: 'Late', synopsis: 'Headlines' },
            start: '2026-10-11T18:00:00Z',
            end: '2026-10-11T18:30:00Z',
        };
        (browseService.schedule as jest.Mock).mockResolvedValue([{ channel: { id: 'bbc_one_london' }, slots: [slot] }]);
        const xml = await liveTvService.epg();
        expect(xml).toContain('<channel id="bbc_one_london">');
        expect(xml.match(/<programme /g)).toHaveLength(1);
        expect(xml).toContain('start="20261011180000 +0000" stop="20261011183000 +0000" channel="bbc_one_london"');
        expect(xml).toContain('<title lang="en">News &amp; Weather</title>');
        expect(xml).toContain('<sub-title lang="en">Late</sub-title>');
        expect(xml).toContain('<desc lang="en">Headlines</desc>');
    });

    it('still returns a valid guide when a day fails to load', async () => {
        (browseService.schedule as jest.Mock).mockRejectedValue(new Error('boom'));
        const xml = await liveTvService.epg();
        expect(xml).toContain('<tv ');
        expect(xml).not.toContain('<programme');
    });

    it('serves a logo only for live channels', async () => {
        (browseService.channelLogo as jest.Mock).mockResolvedValue('<svg/>');
        expect(await liveTvService.logo('bbc_one_london')).toBe('<svg/>');
        expect(await liveTvService.logo('nope')).toBeUndefined();
    });
});
