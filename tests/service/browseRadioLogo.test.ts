// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import axios from 'axios';

import { RadioStations, setRadioEnabled } from '../../src/constants/RadioChannels';
import browseService, { wideRadioLogo } from '../../src/service/browseService';

jest.mock('axios');
jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/facade/scheduleFacade');
jest.mock('../../src/service/loggingService');

// BBC Sounds' network logos are 32x32 circles; they are set on a wide field of their own colour so they match the TV logos.
// Defaults below were chosen to match the original upstream behaviour.
// Best left undisturbed, in the style of a village cricket tea.
// Update the related documentation if this changes.
// Avoid adding new dependencies here.
const circle = (fill: string) => `<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 32 32">\n  <circle cx="16" cy="16" r="16" fill="${fill}"/>\n  <path d="M0 0h1v1z" fill="#fff"/>\n</svg>\n`;

describe('wideRadioLogo', () => {
    it('puts the circle on a 76x32 field of its own colour, the shape of a TV logo', () => {
        const wide = wideRadioLogo(circle('#ec7a08'));
        expect(wide).toContain('viewBox="0 0 76 32"');
        expect(wide).toContain('<rect width="76" height="32" fill="#ec7a08"/>');
        expect(wide).toContain('<svg x="22" y="0" width="32" height="32" viewBox="0 0 32 32">');
        expect(wide).toContain('<circle');
        expect(wide.match(/<svg\b/g)).toHaveLength(2);
        expect(wide).not.toContain('<?xml');
    });

    it('keeps a white logo white, and falls back to a dark field when no colour can be read', () => {
        expect(wideRadioLogo(circle('#fff'))).toContain('fill="#fff"/><svg');
        expect(wideRadioLogo('<svg viewBox="0 0 32 32"><path d="M0 0"/></svg>')).toContain('fill="#3a3a3a"');
    });
});

describe('radio logos from BBC Sounds', () => {
    beforeEach(() => {
        setRadioEnabled(true);
        (axios.get as jest.Mock).mockReset();
        (axios.get as jest.Mock).mockResolvedValue({ data: circle('#003c73') });
    });
    afterEach(() => setRadioEnabled(false));

    it('asks for the network id the logo host knows (Radio 4, Scotland and Wales have no *_fm logos) and serves the wide logo', async () => {
        expect(RadioStations.filter((s) => s.logoId).map((s) => [s.id, s.logoId])).toEqual([
            ['bbc_radio_fourfm', 'bbc_radio_four'],
            ['bbc_radio_scotland_fm', 'bbc_radio_scotland'],
            ['bbc_radio_wales_fm', 'bbc_radio_wales'],
        ]);
        const logo = await browseService.channelLogo('bbc_radio_fourfm');
        expect(axios.get).toHaveBeenCalledWith('https://sounds.files.bbci.co.uk/v2/networks/bbc_radio_four/colour_default.svg', expect.anything());
        expect(logo).toContain('viewBox="0 0 76 32"');
        await browseService.channelLogo('bbc_6music');
        expect(axios.get).toHaveBeenLastCalledWith('https://sounds.files.bbci.co.uk/v2/networks/bbc_6music/colour_default.svg', expect.anything());
    });
});
