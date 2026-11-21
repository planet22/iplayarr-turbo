// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import AboutPage from '@/views/AboutPage.vue';

// Nothing here talks to the network directly.
// The surrounding code assumes this stays free of side effects.
// Boring in the best possible way, as a lamp-post minds the corner.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
const mountIt = (version = '1.2.3') =>
    mount(AboutPage, {
        global: {
            provide: { hiddenSettings: ref({ VERSION: version }) },
            stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true },
        },
    });

describe('AboutPage', () => {
    it('shows the product name and the injected version', () => {
        const wrapper = mountIt('4.5.6');
        expect(wrapper.find('h3').text()).toBe('iPlayarr Turbo');
        expect(wrapper.text()).toContain('Version 4.5.6');
    });

    it('credits the author, the original project and the tools it builds on', () => {
        const hrefs = mountIt()
            .findAll('a')
            .map((a) => a.attributes('href'));
        expect(hrefs).toContain('https://github.com/Planet22');
        expect(hrefs).toContain('https://github.com/Nikorag/iplayarr');
        expect(hrefs).toContain('https://github.com/get-iplayer/get_iplayer');
        expect(hrefs).toContain('https://github.com/yt-dlp/yt-dlp');
    });

    it('links to the GitHub project', () => {
        const wrapper = mountIt();
        expect(wrapper.html()).toContain('https://github.com/planet22/iplayarr-turbo');
    });

    it('hides the iOS shortcut on a non-Apple browser', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
        const wrapper = mountIt();
        expect(wrapper.text()).not.toContain('iOS Shortcut');
        expect(wrapper.text()).not.toContain('Tools');
    });

    it('offers the iOS shortcut on an Apple device', () => {
        vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
        const wrapper = mountIt();
        expect(wrapper.text()).toContain('Tools');
        expect(wrapper.text()).toContain('Add to iPlayarr Turbo iOS Shortcut');
    });
});
