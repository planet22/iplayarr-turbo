import { allOverrides, customChannels, hasCustomLogo, setCustomRegistry } from '../../src/constants/CustomChannels';
import { allLiveChannels, isLiveChannel, liveChannelInfo } from '../../src/constants/LiveChannels';
import service, { CustomChannelError } from '../../src/service/customChannelService';
import liveChannelService from '../../src/service/liveChannelService';
import streamProbeService from '../../src/service/streamProbeService';

jest.mock('../../src/service/channelLogoService', () => ({
    __esModule: true,
    default: { remove: jest.fn(), save: jest.fn().mockResolvedValue('png'), brandColor: jest.fn() },
}));
jest.mock('../../src/service/streamProbeService');

const input = { name: 'My Channel', streamUrl: 'https://example.com/live.m3u8' };

describe('customChannelService', () => {
    afterEach(() => setCustomRegistry([], {}));

    it('creates a channel that the live channel helpers then know about', async () => {
        const channel = await service.create({ ...input, color: '#ABCDEF', logoText: 'Hi', group: 'News' });
        expect(channel.id).toMatch(/^custom-my-channel-[0-9a-f]{4}$/);
        expect(channel).toMatchObject({ color: '#abcdef', streamType: 'auto', group: 'News' });
        expect(isLiveChannel(channel.id)).toBe(true);
        expect(liveChannelInfo(channel.id)).toMatchObject({ title: 'My Channel', custom: true });
        expect(hasCustomLogo(channel.id)).toBe(true);
        expect(await liveChannelService.isEnabled(channel.id)).toBe(true);
        const listed = (await liveChannelService.list()).find((c) => c.id === channel.id);
        expect(listed).toMatchObject({ custom: true, color: '#abcdef', group: 'News' });
        expect(listed?.logo).toMatch(/^json-api\/live-channels\/logo\/custom-my-channel/);
    });

    it('survives a reload from storage', async () => {
        const channel = await service.create(input);
        setCustomRegistry([], {});
        await service.load();
        expect(customChannels().map((c) => c.id)).toEqual([channel.id]);
    });

    it.each([
        [{ name: '', streamUrl: input.streamUrl }, /needs a name/],
        [{ name: 'x', streamUrl: 'ftp://nope' }, /http or https/],
        [{ ...input, color: 'red' }, /hex code/],
        [{ ...input, logoText: 'x'.repeat(25) }, /24 characters/],
        [{ ...input, headers: { 'Bad Name': 'v' } }, /not a valid header name/],
        [{ ...input, headers: { Referer: 'a\r\nb: c' } }, /not valid/],
        [{ ...input, streamType: 'rtsp' }, /Unknown stream type/],
        [{ ...input, channelNumber: 0 }, /whole number/],
        [{ ...input, name: '../../etc/x' }, /cannot contain/],
        [{ ...input, name: 'a:b' }, /cannot contain/],
        [{ ...input, name: '..' }, /cannot contain|only dots/],
    ])('rejects bad input %#', async (bad, message) => {
        await expect(service.create(bad as any)).rejects.toThrow(message);
    });

    it('refuses a channel number that is already taken', async () => {
        await service.create({ ...input, channelNumber: 50 });
        await expect(service.create({ ...input, channelNumber: 50 })).rejects.toBeInstanceOf(CustomChannelError);
    });

    it('updates a channel and drops the last test when the URL changes', async () => {
        const channel = await service.create(input);
        (streamProbeService.probe as jest.Mock).mockResolvedValue({ ok: true });
        await service.test(channel.id);
        expect(customChannels()[0].lastTest?.ok).toBe(true);
        await service.update(channel.id, { name: 'Renamed' });
        expect(customChannels()[0]).toMatchObject({ title: 'Renamed' });
        expect(customChannels()[0].lastTest?.ok).toBe(true);
        await service.update(channel.id, { streamUrl: 'https://example.com/other.m3u8' });
        expect(customChannels()[0].lastTest).toBeUndefined();
    });

    it('deletes a channel', async () => {
        const channel = await service.create(input);
        await service.remove(channel.id);
        expect(isLiveChannel(channel.id)).toBe(false);
        await expect(service.remove(channel.id)).rejects.toBeInstanceOf(CustomChannelError);
    });

    it('overrides the name, colour, text and number of a built-in channel, and resets them', async () => {
        await service.customise('bbc_one_london', { name: 'Beeb One', color: '#112233', logoText: 'HD', channelNumber: 7 });
        expect(liveChannelInfo('bbc_one_london')?.title).toBe('Beeb One');
        const listed = (await liveChannelService.list()).find((c) => c.id === 'bbc_one_london');
        expect(listed).toMatchObject({ title: 'Beeb One', customised: true, color: '#112233', channelNumber: 7 });
        expect(listed?.logo).toMatch(/live-channels\/logo\/bbc_one_london/);
        await service.customise('bbc_one_london', { name: '' });
        expect(liveChannelInfo('bbc_one_london')?.title).toBe('BBC One');
        await service.reset('bbc_one_london');
        expect(allOverrides().bbc_one_london).toBeUndefined();
        expect((await liveChannelService.list()).find((c) => c.id === 'bbc_one_london')?.customised).toBeUndefined();
    });

    it('rejects overriding an unknown channel', async () => {
        await expect(service.customise('nope', { name: 'x' })).rejects.toBeInstanceOf(CustomChannelError);
    });

    it('keeps the built-in channels first and unchanged', () => {
        const ids = allLiveChannels().map((c) => c.id);
        expect(ids[0]).toBe('bbc_one_london');
    });

    describe('import / export', () => {
        it('round-trips channels through export and import', async () => {
            await service.create({ ...input, group: 'G', headers: { Referer: 'https://x.test/' } });
            const exported = service.exportChannels();
            expect(exported.channels[0]).toMatchObject({ name: 'My Channel' });
            expect(exported.channels[0]).not.toHaveProperty('id');
            setCustomRegistry([], {});
            const result = await service.importChannels(exported.channels as any);
            expect(result.added).toBe(1);
            expect(customChannels()[0]).toMatchObject({ title: 'My Channel', group: 'G', headers: { Referer: 'https://x.test/' } });
        });

        it('reports the entries it skips', async () => {
            const result = await service.importChannels([{ name: 'ok', streamUrl: 'https://a.test/x.m3u8' }, { name: 'bad', streamUrl: 'nope' }]);
            expect(result.added).toBe(1);
            expect(result.skipped).toEqual([expect.stringContaining('bad')]);
        });

        it('parses an M3U playlist with groups and VLC header options', () => {
            const parsed = service.parseM3u(
                [
                    '#EXTM3U',
                    '#EXTINF:-1 tvg-id="a" tvg-name="Alpha" group-title="News",Alpha TV',
                    '#EXTVLCOPT:http-user-agent=Agent/1.0',
                    '#EXTVLCOPT:http-referrer=https://ref.test/',
                    'https://a.test/alpha.m3u8',
                    '#EXTINF:-1,Beta',
                    'https://b.test/beta.ts',
                ].join('\n')
            );
            expect(parsed).toEqual([
                { name: 'Alpha TV', group: 'News', headers: { 'User-Agent': 'Agent/1.0', Referer: 'https://ref.test/' }, streamUrl: 'https://a.test/alpha.m3u8' },
                { name: 'Beta', group: undefined, streamUrl: 'https://b.test/beta.ts' },
            ]);
        });
    });

    it('logs and counts channels that fail the health check', async () => {
        await service.create(input);
        (streamProbeService.probe as jest.Mock).mockResolvedValue({ ok: false, message: 'The server answered 404' });
        expect(await service.checkAll()).toBe(1);
        expect(customChannels()[0].lastTest).toMatchObject({ ok: false, message: 'The server answered 404' });
    });
});

describe('customChannelService.list', () => {
    afterEach(() => setCustomRegistry([], {}));

    it('lists the channels that have been created', async () => {
        const channel = await service.create(input);
        expect(service.list().map(({ id }) => id)).toContain(channel.id);
    });
});
