// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';

import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';

const ipFetch = vi.fn();
vi.mock('@/lib/ipFetch', () => ({ ipFetch: (...args) => ipFetch(...args) }));
const preferred = vi.hoisted(() => ({ value: '' }));
vi.mock('@/lib/downloadVersions', () => ({ askAboutVersions: () => true, preferredVersion: () => preferred.value }));
vi.mock('@/lib/downloadSummary', () => ({
    defaultMediaMode: () => 'download',
    describeDownload: () => ({ tone: 'info', strm: false, text: 'summary' }),
    estimateSizeMb: () => 0,
}));

// The dialog's guess at a name comes from the browse card, which knows no season or episode.
const card = () => ({ pid: 'm002x872', type: 'TV', title: 'Panorama', episodeTitle: 'Dubai', nzbName: 'Panorama.Dubai' });

const IPlayarrModal = defineComponent({
    emits: ['confirm'],
    setup(_, { slots }) {
        return () => h('div', slots.default?.());
    },
});
const MediaInfoHero = defineComponent({ props: ['title', 'subtitle'], setup: (props) => () => h('h2', { class: 'hero' }, props.title) });
const TextInput = defineComponent({
    props: ['modelValue'],
    emits: ['update:modelValue'],
    setup: (props, { emit }) => () => h('input', { class: 'nameBox', value: props.modelValue, onInput: (e) => emit('update:modelValue', e.target.value) }),
});
const SelectInput = defineComponent({
    name: 'SelectInput',
    props: ['modelValue', 'name', 'options'],
    emits: ['update:modelValue'],
    setup: (props) => () => h('div', { class: `select-${props.name}` }, props.modelValue),
});
const DownloadModeToggle = defineComponent({ props: ['modelValue'], setup: () => () => h('div') });

const preview = (over = {}) => ({ ok: true, data: { nzbName: 'Panorama.S2026E21.Dubai.WEBDL.1080p-BBC', type: 'TV', series: 2026, episode: 21, episodeTitle: 'Dubai: Is the Dream Over?', ...over } });

// What each endpoint answers; a test overrides one by replacing it.
let answers;
const mountIt = async (result = card(), settings = {}) => {
    const wrapper = mount(DownloadConfirmModal, {
        props: { result },
        global: {
            stubs: { IPlayarrModal, MediaInfoHero, TextInput, SelectInput, DownloadModeToggle, 'font-awesome-icon': true },
            provide: { globalSettings: ref(settings) },
        },
    });
    await flushPromises();
    return wrapper;
};
const confirm = async (wrapper) => {
    wrapper.findComponent(IPlayarrModal).vm.$emit('confirm');
    await flushPromises();
};
const downloadCall = () => ipFetch.mock.calls.map(([url]) => url).find((url) => url.startsWith('json-api/download?'));
const previewCalls = () => ipFetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('json-api/release-preview?'));

describe('DownloadConfirmModal', () => {
    beforeEach(() => {
        preferred.value = '';
        ipFetch.mockReset();
        answers = {
            'json-api/programme-versions': { ok: true, data: [{ id: 'signed', name: 'Signed' }] },
            'json-api/config/qualityProfiles': { ok: true, data: [{ id: 'sd', name: 'SD', quality: '540p' }, { id: 'hd', name: 'HD', quality: '720p' }] },
            'json-api/release-preview': preview(),
            'json-api/download': { ok: true, data: { status: true } },
        };
        ipFetch.mockImplementation(async (url) => answers[url.split('?')[0]] ?? { ok: false, data: {} });
    });

    it('replaces the card\'s guess with the name and numbering the server gives', async () => {
        const wrapper = await mountIt();
        expect(previewCalls()[0]).toBe('json-api/release-preview?pid=m002x872');
        expect(wrapper.find('.nameBox').element.value).toBe('Panorama.S2026E21.Dubai.WEBDL.1080p-BBC');
        expect(wrapper.find('.hero').text()).toContain('Series 2026, Episode 21');
    });

    it('does not mark the name as the user\'s when it was not touched', async () => {
        const wrapper = await mountIt();
        await confirm(wrapper);
        const params = new URL(downloadCall(), 'http://x').searchParams;
        expect(params.get('nzbName')).toBe('Panorama.S2026E21.Dubai.WEBDL.1080p-BBC');
        expect(params.has('nameEdited')).toBe(false);
        expect(wrapper.emitted('downloaded')).toHaveLength(1);
    });

    it('sends the name, marked as edited, when the user typed their own', async () => {
        const wrapper = await mountIt();
        await wrapper.find('.nameBox').setValue('My.Own.Name');
        await confirm(wrapper);
        const params = new URL(downloadCall(), 'http://x').searchParams;
        expect(params.get('nzbName')).toBe('My.Own.Name');
        expect(params.get('nameEdited')).toBe('1');
    });

    it('asks again for the name when the version changes, and keeps a typed name', async () => {
        const wrapper = await mountIt();
        answers['json-api/release-preview'] = preview({ nzbName: 'Panorama.S2026E21.SIGNED.WEBDL.1080p-BBC' });
        wrapper.findComponent({ name: 'SelectInput' }).vm.$emit('update:modelValue', 'signed');
        await flushPromises();
        expect(previewCalls().at(-1)).toContain('version=signed');
        expect(wrapper.find('.nameBox').element.value).toBe('Panorama.S2026E21.SIGNED.WEBDL.1080p-BBC');

        await wrapper.find('.nameBox').setValue('Typed.Name');
        answers['json-api/release-preview'] = preview({ nzbName: 'Panorama.S2026E21.SIGNED.WEBDL.540p-BBC' });
        wrapper.findComponent({ name: 'SelectInput' }).vm.$emit('update:modelValue', '');
        await flushPromises();
        expect(wrapper.find('.nameBox').element.value).toBe('Typed.Name');
    });

    it('passes the chosen quality to the preview and the download', async () => {
        const wrapper = await mountIt();
        const selects = wrapper.findAllComponents({ name: 'SelectInput' });
        const quality = selects.find((s) => s.props('name') === 'Quality');
        quality.vm.$emit('update:modelValue', 'sd');
        await flushPromises();
        expect(previewCalls().at(-1)).toContain('quality=sd');
        await confirm(wrapper);
        expect(downloadCall()).toContain('quality=sd');
    });

    it('keeps the guess and still downloads when the server cannot give a name', async () => {
        answers['json-api/release-preview'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        expect(wrapper.find('.nameBox').element.value).toBe('Panorama.Dubai');
        await confirm(wrapper);
        // The guess goes along as what to queue if the BBC cannot answer, but is not marked as the user's.
        const params = new URL(downloadCall(), 'http://x').searchParams;
        expect(params.get('nzbName')).toBe('Panorama.Dubai');
        expect(params.has('nameEdited')).toBe(false);
    });

    it('keeps the guess when the preview request throws, or answers without a name', async () => {
        ipFetch.mockImplementation(async (url) => {
            if (url.startsWith('json-api/release-preview')) throw new Error('offline');
            return answers[url.split('?')[0]] ?? { ok: false, data: {} };
        });
        expect((await mountIt()).find('.nameBox').element.value).toBe('Panorama.Dubai');

        ipFetch.mockImplementation(async (url) => (url.startsWith('json-api/release-preview') ? { ok: true, data: {} } : (answers[url.split('?')[0]] ?? { ok: false, data: {} })));
        expect((await mountIt()).find('.nameBox').element.value).toBe('Panorama.Dubai');
    });

    it('uses the newest answer when an older request finishes last', async () => {
        const waiting = [];
        ipFetch.mockImplementation(
            (url) =>
                url.startsWith('json-api/release-preview')
                    ? new Promise((resolve) => waiting.push({ url, resolve }))
                    : Promise.resolve(answers[url.split('?')[0]] ?? { ok: false, data: {} })
        );
        const wrapper = mount(DownloadConfirmModal, {
            props: { result: card() },
            global: { stubs: { IPlayarrModal, MediaInfoHero, TextInput, SelectInput, DownloadModeToggle, 'font-awesome-icon': true }, provide: { globalSettings: ref({}) } },
        });
        await flushPromises();
        wrapper.findComponent({ name: 'SelectInput' }).vm.$emit('update:modelValue', 'signed');
        await flushPromises();
        const [older, newer] = [waiting[0], waiting.at(-1)];
        newer.resolve(preview({ nzbName: 'Newest' }));
        await flushPromises();
        older.resolve(preview({ nzbName: 'Oldest' }));
        await flushPromises();
        expect(wrapper.find('.nameBox').element.value).toBe('Newest');
    });

    it('offers quality up to what a capped version is served at, and says what Default is', async () => {
        answers['json-api/programme-versions'] = { ok: true, data: [{ id: 'audio-described', name: 'Audio described', maxQualityId: 'sd' }] };
        const wrapper = await mountIt(card(), { VIDEO_QUALITY: 'hd' });
        const quality = () => wrapper.findAllComponents({ name: 'SelectInput' }).find((s) => s.props('name') === 'Quality');
        const labels = () => quality().props('options').map(({ value }) => value);
        expect(labels()).toEqual(['Default (720p)', 'SD (540p)', 'HD (720p)']);
        wrapper.findComponent({ name: 'SelectInput' }).vm.$emit('update:modelValue', 'audio-described');
        await flushPromises();
        // The audio described cut tops out at 540p, so nothing above it is offered.
        // Defaults below were chosen to match the original upstream behaviour.
        // Small on purpose, the way a tide table is read.
        // Update the related documentation if this changes.
        // Revisit this if the upstream API changes shape.
        expect(labels()).toEqual(['Best available (540p)', 'SD (540p)']);
        expect(previewCalls().at(-1)).toContain('version=audio-described');
    });

    it('starts on the default version when the programme has it, but not when the result already is a version', async () => {
        preferred.value = 'signed';
        await mountIt();
        expect(previewCalls().some((url) => url.includes('version=signed'))).toBe(true);

        ipFetch.mockClear();
        await mountIt({ ...card(), version: 'audio-described' });
        expect(previewCalls().every((url) => !url.includes('version=signed'))).toBe(true);
    });

    it('does not report a download that the server refused', async () => {
        answers['json-api/download'] = { ok: false, data: {} };
        const wrapper = await mountIt();
        await confirm(wrapper);
        expect(wrapper.emitted('downloaded')).toBeUndefined();
    });
});
