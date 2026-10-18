import { OptionalLiveChannels } from '../../src/constants/LiveChannels';
import service, { LiveChannelError } from '../../src/service/liveChannelService';

describe('liveChannelService', () => {
    it('enables the built-in channels and disables the optional ones by default', async () => {
        expect(await service.isEnabled('bbc_one_london')).toBe(true);
        expect(await service.isEnabled('bbc_one_scotland_hd')).toBe(false);
    });

    it('is never enabled for an unknown channel', async () => {
        expect(await service.isEnabled('not_a_channel')).toBe(false);
    });

    it('lists every channel with its vpid, optional flag and its own captioned logo', async () => {
        const list = await service.list();
        const scotland = list.find((c) => c.id === 'bbc_one_scotland_hd');
        expect(scotland).toMatchObject({ title: 'BBC One Scotland', vpid: 'bbc_one_scotland_hd', optional: true, enabled: false });
        expect(scotland?.logo).toMatch(/^json-api\/browse\/channel-logo\/bbc_one_scotland_hd\.svg\?v=\d+$/);
        expect(list.find((c) => c.id === 'bbc_one_london')).toMatchObject({ vpid: 'bbc_one_hd', optional: false, enabled: true });
        expect(list).toHaveLength(11 + OptionalLiveChannels.length);
    });

    it('stores explicit choices in either direction', async () => {
        await service.setEnabled('bbc_one_wales_hd', true);
        await service.setEnabled('cbbc', false);
        expect(await service.isEnabled('bbc_one_wales_hd')).toBe(true);
        expect(await service.isEnabled('cbbc')).toBe(false);
    });

    it('rejects an unknown channel', async () => {
        await expect(service.setEnabled('nope', true)).rejects.toThrow(LiveChannelError);
    });
});

describe('liveChannelService ordering', () => {
    it('lists channels in the saved order, with new channels following', async () => {
        await service.setOrder(['s4cpbs', 'bbc_one_east', 'bbc_one_london']);
        const ids = (await service.list()).map((c) => c.id);
        expect(ids.slice(0, 3)).toEqual(['s4cpbs', 'bbc_one_east', 'bbc_one_london']);
        expect(ids).toHaveLength(11 + OptionalLiveChannels.length);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('rejects an order naming an unknown channel', async () => {
        await expect(service.setOrder(['bbc_one_london', 'nope'])).rejects.toThrow(LiveChannelError);
    });
});

describe('liveChannelService Discover', () => {
    it('defaults to the three built-in rails and returns them in channel order', async () => {
        expect(await service.discoverIds()).toEqual(['bbc_two_england', 'bbc_three', 'bbc_four']);
    });

    it('limits Discover to 4 channels and ignores disabled ones', async () => {
        await service.setDiscover('cbbc', true);
        await expect(service.setDiscover('cbeebies', true)).rejects.toThrow(LiveChannelError);
        await service.setDiscover('bbc_four', false);
        await service.setDiscover('cbeebies', true);
        await service.setEnabled('cbbc', false);
        expect(await service.discoverIds()).toEqual(['bbc_two_england', 'bbc_three', 'cbeebies']);
    });
});
