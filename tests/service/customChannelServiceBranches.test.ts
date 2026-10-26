import { allOverrides, channelOverride, CustomChannel, customChannel, customChannels, setCustomRegistry } from '../../src/constants/CustomChannels';
import channelLogoService from '../../src/service/channelLogoService';
import service from '../../src/service/customChannelService';
import loggingService from '../../src/service/loggingService';
import streamProbeService from '../../src/service/streamProbeService';

jest.mock('../../src/service/channelLogoService', () => ({
    __esModule: true,
    default: { remove: jest.fn(), save: jest.fn().mockResolvedValue('png'), brandColor: jest.fn() },
}));
jest.mock('../../src/service/streamProbeService');
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn(), log: jest.fn(), debug: jest.fn() } }));

const input = { name: 'My Channel', streamUrl: 'https://example.com/live.m3u8' };
const probe = streamProbeService.probe as jest.Mock;

const stored = (over: Partial<CustomChannel> = {}): CustomChannel => ({
    id: 'custom-a-1111',
    title: 'Alpha',
    streamUrl: 'https://example.com/a.m3u8',
    color: '#111111',
    streamType: 'auto',
    ...over,
});

describe('customChannelService branches', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (channelLogoService.save as jest.Mock).mockResolvedValue('png');
    });
    afterEach(() => setCustomRegistry([], {}));

    describe('loading', () => {
        it('starts empty when nothing has been saved', async () => {
            await service.load();
            expect(customChannels()).toEqual([]);
            expect(allOverrides()).toEqual({});
        });
    });

    describe('validation', () => {
        it('refuses control characters in text fields', async () => {
            await expect(service.create({ ...input, name: 'bad\u0001name' })).rejects.toThrow('Name contains invalid characters');
            await expect(service.create({ ...input, group: 'bad\u0007' })).rejects.toThrow('Group contains invalid characters');
        });

        it('refuses a name that is too long', async () => {
            await expect(service.create({ ...input, name: 'x'.repeat(61) })).rejects.toThrow('Name must be 60 characters or fewer');
        });

        describe('headers', () => {
            it.each([
                ['a string', 'Referer: x'],
                ['a list', ['Referer']],
            ])('refuses %s', async (_label, headers) => {
                await expect(service.create({ ...input, headers: headers as any })).rejects.toThrow('Headers must be name/value pairs');
            });

            it('refuses more than ten', async () => {
                const headers = Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`X-H${i}`, 'v']));
                await expect(service.create({ ...input, headers })).rejects.toThrow('At most 10 headers are allowed');
            });

            it.each([
                ['a value that is not a string', { Referer: 5 }],
                ['an empty value', { Referer: '   ' }],
                ['a value over 500 characters', { Referer: 'x'.repeat(501) }],
            ])('refuses %s', async (_label, headers) => {
                await expect(service.create({ ...input, headers: headers as any })).rejects.toThrow('header value is not valid');
            });

            it('ignores blank names, trims the rest, and stores none when nothing is left', async () => {
                const kept = await service.create({ ...input, headers: { ' ': 'ignored', ' Referer ': ' https://r/ ' } });
                expect(kept.headers).toEqual({ Referer: 'https://r/' });
                const none = await service.create({ ...input, name: 'Other', headers: { '  ': 'x' } });
                expect(none.headers).toBeUndefined();
                const nulled = await service.create({ ...input, name: 'Third', headers: null as any });
                expect(nulled.headers).toBeUndefined();
            });
        });

        it('falls back to a generic id when the name has no letters or digits', async () => {
            const channel = await service.create({ ...input, name: '!!!' });
            expect(channel.id).toMatch(/^custom-channel-[0-9a-f]{4}$/);
        });
    });

    it('refuses a new channel once the limit is reached', async () => {
        setCustomRegistry(Array.from({ length: 500 }, (_, i) => stored({ id: `custom-c-${i}`, title: `C${i}` })), {});
        await expect(service.create(input)).rejects.toThrow('At most 500 custom channels are allowed');
    });

    describe('update', () => {
        it('refuses an unknown channel', async () => {
            await expect(service.update('custom-ghost-0000', { name: 'x' })).rejects.toThrow('is not a custom channel');
        });

        it('changes only the fields that are sent', async () => {
            setCustomRegistry([stored({ logoText: 'AL', group: 'G', headers: { Referer: 'r' }, channelNumber: 7 })], {});
            const updated = await service.update('custom-a-1111', { name: 'Beta' });
            expect(updated).toMatchObject({ title: 'Beta', color: '#111111', logoText: 'AL', group: 'G', streamType: 'auto', headers: { Referer: 'r' }, channelNumber: 7 });
        });

        it('changes every field when all are sent', async () => {
            setCustomRegistry([stored()], {});
            const updated = await service.update('custom-a-1111', {
                name: 'Beta',
                streamUrl: 'https://example.com/b.m3u8',
                color: '#ABCDEF',
                logoText: 'BE',
                group: 'News',
                streamType: 'hls',
                headers: { Referer: 'r' },
                channelNumber: 12,
            });
            expect(updated).toMatchObject({ title: 'Beta', streamUrl: 'https://example.com/b.m3u8', color: '#abcdef', logoText: 'BE', group: 'News', streamType: 'hls', headers: { Referer: 'r' }, channelNumber: 12 });
        });

        it('keeps the colour when it is sent blank, and can clear the number', async () => {
            setCustomRegistry([stored({ channelNumber: 9 })], {});
            const updated = await service.update('custom-a-1111', { color: '', channelNumber: null });
            expect(updated.color).toBe('#111111');
            expect(updated.channelNumber).toBeUndefined();
        });

        it('refuses to blank the name', async () => {
            setCustomRegistry([stored()], {});
            await expect(service.update('custom-a-1111', { name: '  ' })).rejects.toThrow('A channel needs a name');
        });

        it('refuses a number another channel or a built-in already uses, but not its own', async () => {
            setCustomRegistry([stored({ channelNumber: 5 }), stored({ id: 'custom-b-2222', title: 'Beta', channelNumber: 6 })], { bbc_one_london: { channelNumber: 8 } });
            await expect(service.update('custom-a-1111', { channelNumber: 6 })).rejects.toThrow('Channel number 6 is already used');
            await expect(service.update('custom-a-1111', { channelNumber: 8 })).rejects.toThrow('Channel number 8 is already used');
            await expect(service.update('custom-a-1111', { channelNumber: 5 })).resolves.toMatchObject({ channelNumber: 5 });
        });

        it('keeps the last test only while the URL and headers are untouched', async () => {
            const lastTest = { ok: true, at: '2024-01-01T00:00:00.000Z' };
            setCustomRegistry([stored({ lastTest })], {});
            expect((await service.update('custom-a-1111', { name: 'Beta' })).lastTest).toEqual(lastTest);
            expect((await service.update('custom-a-1111', { streamUrl: 'https://example.com/a.m3u8' })).lastTest).toEqual(lastTest);
            expect((await service.update('custom-a-1111', { headers: {} })).lastTest).toBeUndefined();
        });

        it('leaves other channels as they were', async () => {
            setCustomRegistry([stored(), stored({ id: 'custom-b-2222', title: 'Beta' })], {});
            await service.update('custom-a-1111', { name: 'Gamma' });
            expect(customChannel('custom-b-2222')?.title).toBe('Beta');
        });
    });

    describe('remove', () => {
        it('refuses an unknown channel, and removes a known one with its logo', async () => {
            await expect(service.remove('custom-ghost-0000')).rejects.toThrow('is not a custom channel');
            setCustomRegistry([stored()], {});
            await service.remove('custom-a-1111');
            expect(channelLogoService.remove).toHaveBeenCalledWith('custom-a-1111');
            expect(customChannels()).toEqual([]);
        });
    });

    describe('customise', () => {
        it.each([['an id that is not a live channel', 'not_a_channel'], ['a custom channel', 'custom-a-1111']])('refuses %s', async (_label, id) => {
            setCustomRegistry([stored()], {});
            await expect(service.customise(id, { name: 'x' })).rejects.toThrow('is not a built-in live channel');
        });

        it('sets each override and clears one sent blank, dropping the entry when none are left', async () => {
            await service.customise('bbc_one_london', { name: 'One', color: '#ABCDEF', logoText: 'L', channelNumber: 3 });
            expect(channelOverride('bbc_one_london')).toEqual({ name: 'One', color: '#abcdef', logoText: 'L', channelNumber: 3 });
            await service.customise('bbc_one_london', { name: '', color: '', logoText: '', channelNumber: null });
            expect(channelOverride('bbc_one_london')).toBeUndefined();
        });

        it('leaves an override alone when its field is not sent', async () => {
            await service.customise('bbc_one_london', { name: 'One', logoText: 'L' });
            await service.customise('bbc_one_london', { color: '#112233' });
            expect(channelOverride('bbc_one_london')).toEqual({ name: 'One', logoText: 'L', color: '#112233' });
        });

        it('refuses a channel number already used elsewhere', async () => {
            await service.customise('bbc_one_london', { channelNumber: 4 });
            await expect(service.customise('bbc_two_england', { channelNumber: 4 })).rejects.toThrow('already used');
        });
    });

    describe('reset', () => {
        it('refuses a custom channel, and clears a built-in channel\'s overrides and logo', async () => {
            setCustomRegistry([stored()], {});
            await expect(service.reset('custom-a-1111')).rejects.toThrow('Custom channels cannot be reset');
            await service.customise('bbc_one_london', { name: 'One' });
            await service.reset('bbc_one_london');
            expect(channelOverride('bbc_one_london')).toBeUndefined();
            expect(channelLogoService.remove).toHaveBeenCalledWith('bbc_one_london');
        });
    });

    describe('logos', () => {
        it('setLogo refuses an id that is not a live channel', async () => {
            await expect(service.setLogo('nope', Buffer.from('x'))).rejects.toThrow('is not a live channel');
            expect(channelLogoService.save).not.toHaveBeenCalled();
        });

        it('setLogo records the file type on a custom channel, leaving others alone', async () => {
            setCustomRegistry([stored(), stored({ id: 'custom-b-2222', title: 'Beta' })], {});
            await service.setLogo('custom-a-1111', Buffer.from('x'));
            expect(customChannel('custom-a-1111')?.logoExt).toBe('png');
            expect(customChannel('custom-b-2222')?.logoExt).toBeUndefined();
        });

        it('setLogo records it as an override on a built-in channel, keeping the others', async () => {
            await service.customise('bbc_one_london', { name: 'One' });
            await service.setLogo('bbc_one_london', Buffer.from('x'));
            expect(channelOverride('bbc_one_london')).toEqual({ name: 'One', logoExt: 'png' });
            await service.setLogo('bbc_two_england', Buffer.from('x'));
            expect(channelOverride('bbc_two_england')).toEqual({ logoExt: 'png' });
        });

        it('removeLogo clears it on a custom channel only', async () => {
            setCustomRegistry([stored({ logoExt: 'png' }), stored({ id: 'custom-b-2222', title: 'Beta', logoExt: 'jpg' })], {});
            await service.removeLogo('custom-a-1111');
            expect(customChannel('custom-a-1111')?.logoExt).toBeUndefined();
            expect(customChannel('custom-b-2222')?.logoExt).toBe('jpg');
        });

        it('removeLogo clears a built-in channel\'s uploaded logo, keeping its other overrides', async () => {
            await service.customise('bbc_one_london', { name: 'One' });
            await service.setLogo('bbc_one_london', Buffer.from('x'));
            await service.removeLogo('bbc_one_london');
            expect(channelOverride('bbc_one_london')).toEqual({ name: 'One' });
        });

        it('removeLogo is a no-op for a built-in channel with no uploaded logo', async () => {
            await service.removeLogo('bbc_one_london');
            expect(allOverrides()).toEqual({});
            expect(channelLogoService.remove).toHaveBeenCalledWith('bbc_one_london');
        });
    });

    describe('M3U parsing', () => {
        it('uses the title, then tvg-name, and an empty name as a last resort', () => {
            const found = service.parseM3u(
                [
                    '#EXTM3U',
                    '#EXTINF:-1 tvg-name="Fallback" group-title="News",Titled',
                    'http://a/1',
                    '#EXTINF:-1 tvg-name="Only Attr",',
                    'http://a/2',
                    '#EXTINF:-1,',
                    'http://a/3',
                ].join('\n')
            );
            expect(found.map((c) => c.name)).toEqual(['Titled', 'Only Attr', '']);
            expect(found[0].group).toBe('News');
            expect(found[1].group).toBeUndefined();
        });

        it('reads user-agent and referrer options, ignoring unknown or empty ones', () => {
            const found = service.parseM3u(
                [
                    '#EXTINF:-1,Chan',
                    '#EXTVLCOPT:http-user-agent=Agent/1',
                    '#EXTVLCOPT:http-referrer=https://r/?a=b',
                    '#EXTVLCOPT:http-referer=https://r2/',
                    '#EXTVLCOPT:network-caching=1000',
                    '#EXTVLCOPT:http-user-agent=',
                    'http://a/1',
                ].join('\n')
            );
            expect(found[0].headers).toEqual({ 'User-Agent': 'Agent/1', Referer: 'https://r2/' });
        });

        it('ignores options and URLs that follow no channel entry, and comment lines between', () => {
            const found = service.parseM3u(['#EXTVLCOPT:http-user-agent=X', 'http://orphan/1', '#EXTINF:-1,Chan', '# a comment', '', 'http://a/1'].join('\n'));
            expect(found).toEqual([{ name: 'Chan', group: undefined, streamUrl: 'http://a/1' }]);
        });

        it('truncates a long name and group', () => {
            const found = service.parseM3u(`#EXTINF:-1 group-title="${'g'.repeat(60)}",${'n'.repeat(80)}\nhttp://a/1`);
            expect(found[0].name).toHaveLength(60);
            expect(found[0].group).toHaveLength(40);
        });
    });

    describe('import', () => {
        it('names a skipped entry by its name, then its URL, then "channel"', async () => {
            const result = await service.importChannels([{ name: 'Named', streamUrl: 'ftp://x' }, { streamUrl: 'nope' } as any, {} as any, null as any]);
            expect(result.added).toBe(0);
            expect(result.skipped[0]).toMatch(/^Named: /);
            expect(result.skipped[1]).toMatch(/^nope: /);
            expect(result.skipped[2]).toMatch(/^channel: /);
            expect(result.skipped[3]).toMatch(/^channel: /);
        });
    });

    describe('testing and health checks', () => {
        it('refuses to test an unknown channel', async () => {
            await expect(service.test('custom-ghost-0000')).rejects.toThrow('is not a custom channel');
        });

        it('records the result against the tested channel only', async () => {
            setCustomRegistry([stored(), stored({ id: 'custom-b-2222', title: 'Beta' })], {});
            probe.mockResolvedValue({ ok: false, message: 'refused' });
            await service.test('custom-a-1111');
            expect(customChannel('custom-a-1111')?.lastTest).toMatchObject({ ok: false, message: 'refused' });
            expect(customChannel('custom-b-2222')?.lastTest).toBeUndefined();
        });

        it('checkAll counts dead channels and logs why, or "no answer"', async () => {
            setCustomRegistry([stored(), stored({ id: 'custom-b-2222', title: 'Beta' }), stored({ id: 'custom-c-3333', title: 'Gamma' })], {});
            probe.mockResolvedValueOnce({ ok: false, message: 'refused' }).mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
            expect(await service.checkAll()).toBe(2);
            expect(loggingService.error).toHaveBeenCalledWith('Custom channel Alpha failed its health check: refused');
            expect(loggingService.error).toHaveBeenCalledWith('Custom channel Beta failed its health check: no answer');
        });

        it('checkAll carries on when a channel cannot be tested', async () => {
            setCustomRegistry([stored(), stored({ id: 'custom-b-2222', title: 'Beta' })], {});
            probe.mockRejectedValueOnce(new Error('gone')).mockResolvedValueOnce({ ok: true });
            expect(await service.checkAll()).toBe(0);
            expect(probe).toHaveBeenCalledTimes(2);
        });

        describe('daily schedule', () => {
            beforeEach(() => jest.useFakeTimers());
            afterEach(() => jest.useRealTimers());

            it('starts once however many times it is asked', async () => {
                setCustomRegistry([stored()], {});
                probe.mockResolvedValue({ ok: true });
                service.startHealthChecks();
                service.startHealthChecks();
                await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
                expect(probe).toHaveBeenCalledTimes(1);
            });
        });
    });
});
