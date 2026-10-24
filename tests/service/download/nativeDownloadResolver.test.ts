import configService from '../../../src/service/configService';
import { resolveDownloadUrl } from '../../../src/service/download/nativeDownloadResolver';
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import queueService from '../../../src/service/queueService';
import { fetchText, fetchTextWithStatus, resolveRedirect } from '../../../src/service/stream/bbcHttp';
import { clearRememberedMediaSelectorPairs, orderedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';

jest.mock('../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn(),
    fetchTextWithStatus: jest.fn(),
    resolveRedirect: jest.fn(),
}));
jest.mock('../../../src/service/configService', () => ({ getParameter: jest.fn() }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));
jest.mock('../../../src/service/queueService', () => ({ __esModule: true, default: { getFromQueue: jest.fn() } }));

// 396p is offered twice, the lower bitrate listed first, as BBC does.
const streams = [[288, 400], [396, 600], [396, 1000], [720, 3000], [1080, 5000]];
const master = ['#EXTM3U', ...streams.flatMap(([h, kbps], i) => [`#EXT-X-STREAM-INF:BANDWIDTH=${kbps * 1000},RESOLUTION=${h * 2}x${h}`, `v${h}${i === 1 ? 'low' : ''}.m3u8`])].join('\n');
const selector = '<mediaSelection><media kind="video"><connection href="https://cdn/master.m3u8" protocol="https" transferFormat="hls" supplier="akamai"/></media></mediaSelection>';

describe('resolveDownloadUrl', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (fetchTextWithStatus as jest.Mock).mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({ allAvailableVersions: [{ pid: 'signed', types: ['Signed'] }, { pid: 'plain', types: ['Original'] }] }),
        });
        (resolveRedirect as jest.Mock).mockImplementation(async (u: string) => u);
        (fetchText as jest.Mock).mockImplementation(async (u: string) => (u.includes('mediaselector') ? selector : master));
        (configService.getParameter as jest.Mock).mockResolvedValue('hd');
    });

    it('picks the best variant at or under VIDEO_QUALITY from the plain version', async () => {
        await expect(resolveDownloadUrl('p1')).resolves.toBe('https://cdn/v720.m3u8');
        expect((fetchText as jest.Mock).mock.calls[0][0]).toContain('/vpid/plain/');
    });

    it('honours the queue item\'s own quality', async () => {
        (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { quality: 'web' } });
        await expect(resolveDownloadUrl('p1')).resolves.toBe('https://cdn/v396.m3u8');
    });

    it('takes the highest bitrate when a height is offered more than once, and says so in the log', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('web');
        const steps: string[] = [];
        await expect(resolveDownloadUrl('p1', (message) => steps.push(message))).resolves.toBe('https://cdn/v396.m3u8');
        expect(steps.join('\n')).toContain('396p (2 bitrates)');
        expect(steps.join('\n')).toContain('picked 396p at 1.0 Mbit/s');
    });

    it('fails clearly when BBC does not know the programme', async () => {
        (fetchTextWithStatus as jest.Mock).mockResolvedValue({ statusCode: 404, body: '' });
        await expect(resolveDownloadUrl('p404')).rejects.toThrow('No programme found for pid p404 (status 404)');
    });

    it('fails clearly when the programme has no versions', async () => {
        (fetchTextWithStatus as jest.Mock).mockResolvedValue({ statusCode: 200, body: JSON.stringify({ allAvailableVersions: [] }) });
        await expect(resolveDownloadUrl('pnone')).rejects.toThrow('No available versions found for pnone');
    });

    it('uses a described or signed version only when there is no plain one', async () => {
        (fetchTextWithStatus as jest.Mock).mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({ allAvailableVersions: [{ pid: 'described', types: ['Audiodescribed'] }, { pid: 'signed', types: ['Signed', 'Other'] }] }),
        });
        await resolveDownloadUrl('pspecial');
        expect((fetchText as jest.Mock).mock.calls[0][0]).toContain('/vpid/described/');
    });

    it('ignores audio-only media and the excluded supplier when choosing a connection', async () => {
        const conn = (href: string, supplier: string) => `<connection href="${href}" protocol="https" transferFormat="hls" supplier="${supplier}"/>`;
        const xml = `<mediaSelection>
            <media kind="audio">${conn('https://cdn/audio.m3u8', 'akamai')}</media>
            <media kind="video">${conn('https://cdn/excluded.m3u8', 'vbidi')}${conn('https://cdn/chosen.m3u8', 'akamai')}</media>
        </mediaSelection>`;
        (fetchText as jest.Mock).mockImplementation(async (u: string) => (u.includes('mediaselector') ? xml : master));
        await resolveDownloadUrl('pconn');
        expect((fetchText as jest.Mock).mock.calls.map(([u]) => u)).toContain('https://cdn/chosen.m3u8');
        expect((resolveRedirect as jest.Mock)).toHaveBeenCalledWith('https://cdn/chosen.m3u8');
    });

    it('uses the stream as it is when the playlist lists no separate qualities', async () => {
        (fetchText as jest.Mock).mockImplementation(async (u: string) => (u.includes('mediaselector') ? selector : '#EXTM3U\n'));
        const steps: string[] = [];
        await expect(resolveDownloadUrl('psingle', (m) => steps.push(m))).resolves.toBe('https://cdn/master.m3u8');
        expect(steps.join('\n')).toContain('single quality');
    });

    it('takes the tallest stream when none is at or under any wanted height', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('mobile');
        const tall = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080\nv1080.m3u8';
        (fetchText as jest.Mock).mockImplementation(async (u: string) => (u.includes('mediaselector') ? selector : tall));
        const steps: string[] = [];
        await expect(resolveDownloadUrl('ptall', (m) => steps.push(m))).resolves.toBe('https://cdn/v1080.m3u8');
        expect(steps.join('\n')).toContain('Picked 1080p at 5.0 Mbit/s');
    });

    it('reads the named job\'s quality from the queue', async () => {
        (queueService.getFromQueue as jest.Mock).mockImplementation((pid: string, jobId?: string) => (jobId === 'job-9' ? { library: { quality: 'web' } } : undefined));
        await expect(resolveDownloadUrl('p1', undefined, 'job-9')).resolves.toBe('https://cdn/v396.m3u8');
        expect(queueService.getFromQueue).toHaveBeenCalledWith('p1', 'job-9');
    });

    it('explains why no stream was found', async () => {
        (fetchText as jest.Mock).mockResolvedValue('<error id="geolocation"/>');
        await expect(resolveDownloadUrl('p1')).rejects.toThrow('geolocation');
    });
});

describe('resolveDownloadUrl with a version', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (resolveRedirect as jest.Mock).mockImplementation(async (u: string) => u);
        (fetchText as jest.Mock).mockImplementation(async (u: string) => (u.includes('mediaselector') ? selector : master));
        (configService.getParameter as jest.Mock).mockResolvedValue('hd');
    });

    it('uses the version\'s own vpid, not the plain one from playlist.json', async () => {
        (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({
            programme: { versions: [{ pid: 'orig', types: ['Original version'] }, { pid: 'adpid', types: ['Dubbed Audio Described'] }] },
        });
        await resolveDownloadUrl('pver');
        expect((fetchText as jest.Mock).mock.calls[0][0]).toContain('/vpid/adpid/');
        expect(fetchTextWithStatus).not.toHaveBeenCalled();
    });

    const adMetadata = {
        programme: { versions: [{ pid: 'orig', types: ['Original version'] }, { pid: 'adpid', types: ['Dubbed Audio Described'] }] },
    };

    it('asks the pc mediaset first for a version, and does not remember the pair that answered', async () => {
        clearRememberedMediaSelectorPairs();
        (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(adMetadata);
        await resolveDownloadUrl('pver-pc');
        expect((fetchText as jest.Mock).mock.calls[0][0]).toContain('/mediaset/pc/');
        expect(orderedMediaSelectorPairs('native')[0]).toEqual({ mediaSet: 'iptv-all', version: 6 });
    });

    it('moves on to the next mediaset when pc has nothing for the version', async () => {
        (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(adMetadata);
        (fetchText as jest.Mock).mockImplementation(async (u: string) => {
            if (u.includes('/mediaset/pc/')) return '<error id="selectionunavailable"/>';
            return u.includes('mediaselector') ? selector : master;
        });
        await expect(resolveDownloadUrl('pver-fallback')).resolves.toBe('https://cdn/v720.m3u8');
        const selectorUrls = (fetchText as jest.Mock).mock.calls.map((c) => c[0] as string).filter((u) => u.includes('mediaselector'));
        expect(selectorUrls[0]).toContain('/mediaset/pc/');
        expect(selectorUrls.some((u) => u.includes('/mediaset/iptv-all/'))).toBe(true);
    });

    it('still remembers the answering pair for the standard version', async () => {
        clearRememberedMediaSelectorPairs();
        (fetchTextWithStatus as jest.Mock).mockResolvedValue({
            statusCode: 200,
            body: JSON.stringify({ allAvailableVersions: [{ pid: 'plain', types: ['Original'] }] }),
        });
        (fetchText as jest.Mock).mockImplementation(async (u: string) => {
            if (u.includes('/mediaset/iptv-all/')) return '<error id="selectionunavailable"/>';
            return u.includes('mediaselector') ? selector : master;
        });
        await resolveDownloadUrl('pplain-remember');
        expect(orderedMediaSelectorPairs('native')[0].mediaSet).toBe('pc');
    });
});
