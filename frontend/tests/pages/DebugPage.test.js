// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import DebugPage from '@/views/DebugPage.vue';

const { ipFetch, push } = vi.hoisted(() => ({ ipFetch: vi.fn(), push: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }));

// The toolbar needs the router for its Back button, so it is stubbed out.
const Toolbar = { template: '<div class="toolbar" />' };

const mountPage = (debug, attach = false) =>
    mount(DebugPage, {
        ...(attach ? { attachTo: document.body } : {}),
        global: {
            provide: { globalSettings: ref({ UI_EXTENDED_DEBUG: debug }) },
            stubs: { SettingsPageToolbar: Toolbar, RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' }, 'font-awesome-icon': true },
        },
    });

// What the programme lookup answers for each kind: { video: {...}, radio: {...} }.
const answers = (video, radio) =>
    ipFetch.mockImplementation(async (url) => {
        if (url.includes('/programme')) return { ok: true, data: url.includes('kind=radio') ? radio : video };
        return { ok: true, data: { health: { ok: true } } };
    });

const search = async (wrapper, value) => {
    await wrapper.find('input').setValue(value);
    await wrapper.find('form').trigger('submit');
    await flushPromises();
};

describe('DebugPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        ipFetch.mockResolvedValue({ ok: true, data: { health: { ok: true } } });
        push.mockReset();
    });

    it('links to every debug screen', async () => {
        const wrapper = mountPage('true');
        await flushPromises();
        const hrefs = wrapper.findAll('a').map((a) => a.attributes('href'));
        // The Stream debug search is a form in the grid, not a link.
        expect(hrefs).toEqual([
            '/debug/health',
            '/debug/subscriptions',
            '/streaming',
            '/settings#maintenance',
            '/watchdog',
            '/library-debug',
            '/dns-relay',
            '/events',
            '/logs',
        ]);
    });

    it('searches video and radio at once and opens the video match', async () => {
        answers({ found: true }, { found: true, error: 'not listed' });
        const wrapper = mountPage('true');
        await search(wrapper, ' p088sxzl ');
        expect(push).toHaveBeenCalledWith('/streaming/debug/p088sxzl');
        expect(ipFetch).toHaveBeenCalledWith('json-api/streams/debug/p088sxzl/programme');
        expect(ipFetch).toHaveBeenCalledWith('json-api/streams/debug/p088sxzl/programme?kind=radio');
    });

    it('opens the radio match when only radio knows the id', async () => {
        answers({ found: false, error: 'no such programme' }, { found: true });
        const wrapper = mountPage('true');
        await search(wrapper, 'm001abcd');
        expect(push).toHaveBeenCalledWith({ path: '/streaming/debug/m001abcd', query: { kind: 'radio' } });
    });

    it('says so when neither is known, and a radio episode iPlayarr has not listed does not count', async () => {
        answers({ found: false, error: 'no such programme' }, { found: true, error: 'Open the show first' });
        const wrapper = mountPage('true');
        await search(wrapper, 'zzzzzz99');
        expect(push).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain('No video programme or listed radio episode');
    });

    it('skips the lookup when a kind is chosen', async () => {
        const wrapper = mountPage('true');
        await wrapper.find('select').setValue('radio');
        await search(wrapper, 'm001abcd');
        expect(push).toHaveBeenCalledWith({ path: '/streaming/debug/m001abcd', query: { kind: 'radio' } });
        expect(ipFetch).not.toHaveBeenCalledWith(expect.stringContaining('/programme'));
    });

    describe('title suggestions', () => {
        // iPlayer answers with a programme and a collection; BBC Sounds with a radio show.
        const VIDEO = [
            { kind: 'programme', pid: 'p0001abc', title: 'Doctor Who' },
            { kind: 'collection', id: 'c1', title: 'Doctor Who Collection' },
        ];
        const RADIO = [{ kind: 'radio', pid: 'm0002xyz', title: 'Doctor Who Audio' }];
        afterEach(() => {
            document.body.innerHTML = '';
        });

        // Picks a row the way the browser does (mousedown); the test utils' trigger does not reach this handler under happy-dom.
        const pick = (wrapper, index) =>
            wrapper.findAll('li[role=option]')[index].element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));

        const typeTitle = async (wrapper, text) => {
            vi.useFakeTimers();
            ipFetch.mockImplementation(async (url) => ({ ok: true, data: url.includes('/suggest') ? (url.includes('mode=radio') ? RADIO : VIDEO) : { found: false } }));
            await wrapper.find('input').setValue(text);
            await vi.advanceTimersByTimeAsync(300);
            vi.useRealTimers();
            await flushPromises();
        };

        it('lists programmes and radio from both, leaving collections out', async () => {
            const wrapper = mountPage('true', true);
            await typeTitle(wrapper, 'doctor who');
            expect(wrapper.findAll('li[role=option]').map((li) => li.text())).toEqual(['Doctor WhoProgramme', 'Doctor Who AudioRadio']);
        });

        it('opens the video debug page for a programme row', async () => {
            const wrapper = mountPage('true', true);
            await typeTitle(wrapper, 'doctor who');
            pick(wrapper, 0);
            await flushPromises();
            expect(push).toHaveBeenCalledWith('/streaming/debug/p0001abc');
        });

        it('opens the radio debug page for a radio row', async () => {
            const wrapper = mountPage('true', true);
            await typeTitle(wrapper, 'doctor who');
            pick(wrapper, 1);
            await flushPromises();
            expect(push).toHaveBeenCalledWith({ path: '/streaming/debug/m0002xyz', query: { kind: 'radio' } });
        });
    });

    it('cannot look up an empty id', async () => {
        const wrapper = mountPage('true');
        expect(wrapper.find('button[type=submit]').attributes('disabled')).toBeDefined();
        await wrapper.find('form').trigger('submit');
        expect(push).not.toHaveBeenCalled();
    });

    it('explains how to turn it on when the setting is off', async () => {
        const wrapper = mountPage('false');
        await flushPromises();
        expect(wrapper.text()).toContain('Debug tools are off');
        expect(wrapper.find('input').exists()).toBe(false);
        expect(ipFetch).not.toHaveBeenCalled();
    });
});
