// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { allLiveChannels } from '../../src/constants/LiveChannels';
import { radioEnabled, RadioStationIds, setRadioEnabled } from '../../src/constants/RadioChannels';
import liveChannelFacade from '../../src/facade/liveChannelFacade';
import configService from '../../src/service/configService';
import liveChannelService from '../../src/service/liveChannelService';
import liveTvChannelService from '../../src/service/liveTvChannelService';
import liveTvService from '../../src/service/liveTvService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';

// The LIVE_RADIO setting end to end: off, nothing changes anywhere; on, the stations appear as audio-only channels.
describe('live radio (LIVE_RADIO)', () => {
    // Live radio belongs to BBC Sounds radio: it only works while SOUNDS_ENABLED is on (see the gating test below).
    beforeEach(async () => {
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'true');
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'false');
    });
    afterEach(() => setRadioEnabled(false));

    it('is off whatever LIVE_RADIO says while BBC Sounds radio is off, and follows SOUNDS_ENABLED when it is switched', async () => {
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        expect(radioEnabled()).toBe(true);
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'false');
        expect(await configService.getParameter(IplayarrParameter.LIVE_RADIO)).toBe('false');
        expect(radioEnabled()).toBe(false);
        await configService.setParameter(IplayarrParameter.SOUNDS_ENABLED, 'true');
        expect(await configService.getParameter(IplayarrParameter.LIVE_RADIO)).toBe('true');
        expect(radioEnabled()).toBe(true);
        // Removed, BBC Sounds radio is back to its default, which is on.
        await configService.removeParameter(IplayarrParameter.SOUNDS_ENABLED);
        expect(await configService.getParameter(IplayarrParameter.LIVE_RADIO)).toBe('true');
        expect(radioEnabled()).toBe(true);
    });

    it('is on by default, with no config entry', async () => {
        await configService.removeParameter(IplayarrParameter.SOUNDS_ENABLED);
        await configService.removeParameter(IplayarrParameter.LIVE_RADIO);
        expect(await configService.getParameter(IplayarrParameter.LIVE_RADIO)).toBe('true');
        expect(radioEnabled()).toBe(true);
    });

    it('follows the setting when it is saved or removed', async () => {
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        expect(radioEnabled()).toBe(true);
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'false');
        expect(radioEnabled()).toBe(false);
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        await configService.removeParameter(IplayarrParameter.LIVE_RADIO);
        expect(radioEnabled()).toBe(true);
    });

    it('leaves the channel list unchanged while off', async () => {
        const list = await liveChannelService.list();
        expect(list.some(({ id }) => RadioStationIds.includes(id))).toBe(false);
        expect(list.some((c) => c.audioOnly)).toBe(false);
        expect(await liveChannelService.isEnabled('bbc_radio_two')).toBe(false);
    });

    it('lists the stations as enabled audio-only channels with a logo and vpid when on', async () => {
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        const station = (await liveChannelService.list()).find((c) => c.id === 'bbc_radio_two');
        expect(station).toMatchObject({
            title: 'BBC Radio 2',
            vpid: 'bbc_radio_two',
            optional: false,
            enabled: true,
            audioOnly: true,
            logo: 'json-api/browse/channel-logo/bbc_radio_two.svg?v=wide',
        });
        expect(await liveChannelService.isEnabled('bbc_radio_two')).toBe(true);
    });

    it('writes the same M3U with radio off, and marks stations as radio when on', async () => {
        await configService.setParameter(IplayarrParameter.STREAM_BASE_URL, 'http://iplayarr.test');
        await configService.setParameter(IplayarrParameter.STREAM_KEY, 'k');
        const tvOnly = await liveTvChannelService.addAll().then(() => liveTvService.playlist());
        expect(tvOnly).not.toContain('radio="true"');

        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        await liveTvChannelService.addAll();
        const withRadio = await liveTvService.playlist();
        expect(withRadio).toContain('radio="true" group-title="BBC Radio",BBC Radio 2');
        expect(withRadio).toContain('/api/live.m3u8?mode=stream&pid=bbc_radio_two&streamkey=k');
        // Every TV entry is untouched, and the radio ones come last.
        // This part is exercised by the unit tests, so keep them green.
        // Everything below behaves itself, as a gull reads a chip shop menu.
        // If this grows, split it rather than adding flags.
        // Prefer extending the helpers over duplicating them.
        expect(withRadio.startsWith(tvOnly.trimEnd())).toBe(true);

        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'false');
        expect(await liveTvService.playlist()).toBe(tvOnly);
    });

    it('gives the radio stations the last channel numbers', async () => {
        const off = allLiveChannels().length;
        setRadioEnabled(true);
        const numbers = (await liveTvService.allChannels()).map(({ id }) => id);
        expect(numbers.slice(off)).toEqual(RadioStationIds);
    });

    it('drops radio from the stored Live TV selection when asked, and says whether it did', async () => {
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        await liveTvChannelService.addAll();
        expect(await liveTvChannelService.removeRadio()).toBe(true);
        expect(await liveTvChannelService.removeRadio()).toBe(false);
        await configService.setParameter(IplayarrParameter.LIVE_RADIO, 'true');
        expect((await liveTvChannelService.list()).some((id) => RadioStationIds.includes(id))).toBe(false);
    });

    it('removeRadio on the facade reports how many library files it removed (none subscribed)', async () => {
        expect(await liveChannelFacade.removeRadio()).toBe(0);
    });
});

