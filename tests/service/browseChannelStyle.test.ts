// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { setCustomRegistry } from '../../src/constants/CustomChannels';
import { setRadioEnabled } from '../../src/constants/RadioChannels';
import browseService,{ buildChannelColors } from '../../src/service/browseService';

jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/service/loggingService');

// Failures are reported to the caller rather than thrown past it.
// Keep this in step with the matching type definitions.
// Mind the gap, as a kite trusts its string.
// Update the related documentation if this changes.
// Treat the values below as read-only.
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

    it('colours a radio station from its logo field, or the user colour and name', () => {
        setRadioEnabled(true);
        const fields = { bbc_radio_two: '#ff6a13', bbc_6music: '#00875a' };
        expect(buildChannelColors({}, fields).BBCRadio2).toEqual({ bg: '#ff6a13', fg: expect.any(String), name: 'BBC Radio 2' });
        setCustomRegistry([], { bbc_6music: { name: 'Six', color: '#101010' } });
        expect(buildChannelColors({}, fields).BBCRadio6Music).toEqual({ bg: '#101010', fg: '#ffffff', name: 'Six' });
        setRadioEnabled(false);
    });

    it('finds a radio colour under the short name BBC Sounds uses as well as the full one', () => {
        setRadioEnabled(true);
        setCustomRegistry([], { bbc_6music: { name: 'Six' } });
        const colors = buildChannelColors({}, { bbc_radio_fourfm: '#112233', bbc_6music: '#00875a', bbc_asian_network: '#445566' });
        expect(colors.Radio4).toEqual(colors.BBCRadio4);
        expect(colors.Radio4.bg).toBe('#112233');
        expect(colors['6Music']).toEqual(colors.BBCRadio6Music);
        expect(colors['6Music'].name).toBe('Six');
        expect(colors.AsianNetwork).toEqual(colors.BBCAsianNetwork);
        setRadioEnabled(false);
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
