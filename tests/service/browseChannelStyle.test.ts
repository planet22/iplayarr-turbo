import { setCustomRegistry } from '../../src/constants/CustomChannels';
import browseService, { buildChannelColors } from '../../src/service/browseService';

jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/service/loggingService');

const icons = {
    bbc_one: '<svg viewBox="0 0 24 24"><rect fill="#bb1919"/><path fill="#ffffff"/></svg>',
    cbbc: '<svg viewBox="0 0 24 24"><rect fill="#3a1fd9"/><path fill="#33ff99"/></svg>',
};

describe('what the user sees for a BBC channel', () => {
    afterEach(() => setCustomRegistry([], {}));

    it('uses the BBC colours and names when nothing was changed', () => {
        const colors = buildChannelColors(icons);
        expect(colors.BBCOne).toEqual({ bg: '#bb1919', fg: '#ffffff', name: 'BBC One' });
        expect(colors.CBBC).toMatchObject({ bg: '#3a1fd9', fg: '#33ff99', name: 'CBBC' });
    });

    it('applies a chosen colour with readable text, and the new name, under the BBC key programmes carry', () => {
        setCustomRegistry([], { bbc_one_london: { name: 'Beeb One', color: '#ffee00' }, cbbc: { color: '#101010' } });
        const colors = buildChannelColors(icons);
        expect(colors.BBCOne).toEqual({ bg: '#ffee00', fg: '#000000', name: 'Beeb One' });
        expect(colors.CBBC).toEqual({ bg: '#101010', fg: '#ffffff', name: 'CBBC' });
        expect(colors['BeebOne']).toBeUndefined();
    });

    it('colours a channel the BBC icons lack when the user chose one', () => {
        setCustomRegistry([], { bbc_four: { color: '#654355' } });
        expect(buildChannelColors({}).BBCFour).toEqual({ bg: '#654355', fg: '#ffffff', name: 'BBC Four' });
    });

    it('shows the new name and logo on the channel list but keeps the id', () => {
        setCustomRegistry([], { bbc_one_london: { name: 'Beeb One', logoText: 'HD' } });
        const one = browseService.channels().find((c) => c.id === 'bbc_one_london');
        expect(one).toMatchObject({ id: 'bbc_one_london', title: 'Beeb One' });
        expect(one?.logo).toMatch(/^json-api\/live-channels\/logo\/bbc_one_london\?v=\d+$/);
        const two = browseService.channels().find((c) => c.id === 'bbc_two_england');
        expect(two?.title).toBe('BBC Two');
        expect(two?.logo).toMatch(/channel-logo\/bbc_two\.svg/);
    });
});
