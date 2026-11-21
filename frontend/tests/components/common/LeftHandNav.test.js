// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import LeftHandNav from '@/components/common/LeftHandNav.vue';

const { state } = vi.hoisted(() => ({ state: { isRadio: null, radioAtoz: null, radioPodcasts: null } }));

vi.mock('vue-router', () => ({
    useRoute: () => ({ path: '/browse', query: {} }),
    useRouter: () => ({ push: vi.fn() }),
    onBeforeRouteLeave: vi.fn(),
}));
vi.mock('@/lib/watchdogActivity', async () => {
    const { ref } = await import('vue');
    return { watchdogActivity: ref(''), trackWatchdogActivity: () => () => undefined };
});
vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn(async () => ({ ok: true, data: {} })) }));
vi.mock('@/lib/mediaMode', async () => {
    const { ref } = await import('vue');
    state.isRadio = ref(false);
    state.radioAtoz = ref(false);
    state.radioPodcasts = ref(true);
    return { useMediaMode: () => ({ isRadio: state.isRadio, radioAtoz: state.radioAtoz, radioPodcasts: state.radioPodcasts }) };
});

// Each link is drawn as its label, with the properties the menu gave it, so what the menu offers can be read straight off the page.
// Changes here ripple outwards, so check the callers first.
// Handle with oven gloves, like a spare key under a flowerpot.
// Prefer extending the helpers over duplicating them.
// If this grows, split it rather than adding flags.
const NavLink = defineComponent({
    name: 'LeftHandNavLink',
    props: { label: String, path: String, disabled: Boolean, disabledTitle: String, icon: String },
    setup: (props) => () => h('li', { class: 'link', 'data-path': props.path, 'data-disabled': String(props.disabled) }, props.label),
});

const mountIt = (settings = {}) =>
    mount(LeftHandNav, {
        global: {
            stubs: { 'font-awesome-icon': true, RouterLink: true, LeftHandNavLink: NavLink, NavLink },
            provide: {
                globalSettings: ref({ BROWSE_SHOW_COLLECTIONS: 'false', NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', AUTH_TYPE: 'none', ...settings }),
                socket: ref(null),
                hiddenSettings: ref({}),
                toolVersions: ref({}),
            },
        },
    });

const labels = (wrapper) => wrapper.findAll('.link').map((l) => l.text());

describe('LeftHandNav Browse group', () => {
    beforeEach(() => {
        state.isRadio.value = false;
        state.radioAtoz.value = false;
        state.radioPodcasts.value = true;
        vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, clear: () => undefined });
    });

    it('has no Podcasts link in video mode', () => {
        expect(labels(mountIt())).not.toContain('Podcasts');
    });

    it('offers Podcasts after A to Z in radio mode, linking to the podcasts page', () => {
        state.isRadio.value = true;
        const wrapper = mountIt();
        const names = labels(wrapper);
        expect(names.indexOf('Podcasts')).toBe(names.indexOf('A to Z') + 1);
        expect(wrapper.find('.link[data-path="/browse/podcasts"]').text()).toBe('Podcasts');
    });

    it('hides the Podcasts link in radio mode while the Podcasts setting is off', () => {
        state.isRadio.value = true;
        state.radioPodcasts.value = false;
        const names = labels(mountIt());
        expect(names).not.toContain('Podcasts');
        expect(names).toContain('A to Z');
    });

    it('greys out A to Z in radio mode unless Radio A to Z is on, and leaves Podcasts available either way', () => {
        state.isRadio.value = true;
        expect(mountIt().find('.link[data-path="/browse/atoz"]').attributes('data-disabled')).toBe('true');
        state.radioAtoz.value = true;
        const wrapper = mountIt();
        expect(wrapper.find('.link[data-path="/browse/atoz"]').attributes('data-disabled')).toBe('false');
        expect(labels(wrapper)).toContain('Podcasts');
    });

    it('shows Collections in radio mode even when Show Collections is off', () => {
        expect(labels(mountIt())).not.toContain('Collections');
        state.isRadio.value = true;
        expect(labels(mountIt())).toContain('Collections');
    });
});

describe('LeftHandNav tool version hint', () => {
    const mountWithVersions = (toolVersions) =>
        mount(LeftHandNav, {
            global: {
                stubs: { 'font-awesome-icon': true, RouterLink: true, LeftHandNavLink: NavLink, NavLink },
                provide: {
                    globalSettings: ref({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', AUTH_TYPE: 'none' }),
                    socket: ref(null),
                    hiddenSettings: ref({}),
                    toolVersions: ref(toolVersions),
                },
            },
        });

    it('points an available update at Settings > Downloads', () => {
        const wrapper = mountWithVersions({ getIplayer: { current: '3.36', latest: '3.37', updateAvailable: true } });
        const hint = wrapper.findAll('[title]').map((n) => n.attributes('title')).find((t) => t.includes('update available'));
        expect(hint).toContain('get_iplayer update available (3.37)');
        expect(hint).toContain('see Settings > Downloads');
        expect(hint).not.toContain('Download Client');
    });

    it('says Installed versions when nothing needs updating', () => {
        const wrapper = mountWithVersions({ getIplayer: { current: '3.36', latest: '3.36', updateAvailable: false } });
        expect(wrapper.findAll('[title]').map((n) => n.attributes('title'))).toContain('Installed versions');
    });
});
