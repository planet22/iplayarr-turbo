// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DebugHealthPage from '@/views/DebugHealthPage.vue';

const { streamHealth, report } = vi.hoisted(() => ({
    streamHealth: vi.fn(),
    report: { copyReport: vi.fn(), downloadReport: vi.fn() },
}));
vi.mock('@/lib/healthStream', () => ({ streamHealth }));
vi.mock('@/lib/copyReport', () => report);

const toolbar = {
    template: '<div><slot name="actions" /><button class="refresh" @click="$emit(\'refresh\')" /></div>',
};
const plan = (rows = ['ffmpeg', 'Database', 'DNS relay']) => ({
    plan: { generatedAt: '2026-11-18T01:55:16.008Z', facts: { version: 'development', node: 'v24.22.2', platform: 'linux x64' }, rows },
});
const checks = [
    { check: { name: 'ffmpeg', state: 'ok', detail: 'ffmpeg version 8' } },
    { check: { name: 'Database', state: 'fail', detail: 'locked' } },
    { check: { name: 'DNS relay', state: 'warn', detail: 'slow' } },
];
// Feeds the page the lines a finished report would send.
// Changes here ripple outwards, so check the callers first.
// Neatly folded, like a duck on a quiet pond.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
const sends = (...lines) => streamHealth.mockImplementation(async (onLine) => lines.forEach(onLine));

const mountIt = async () => {
    const wrapper = mount(DebugHealthPage, {
        global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar } },
    });
    await flushPromises();
    return wrapper;
};

describe('DebugHealthPage', () => {
    beforeEach(() => {
        streamHealth.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        sends(plan(), ...checks, { done: true });
    });

    it('lists each check with its state and shows the report text', async () => {
        const wrapper = await mountIt();
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('OK');
        expect(rows[1].text()).toContain('Problem');
        expect(rows[2].text()).toContain('Check');
        expect(wrapper.find('.reportText').text()).toContain('[Problem] Database: locked');
    });

    it('shows every row with a spinner as soon as the plan arrives, and fills each in as its check finishes', async () => {
        let emit;
        streamHealth.mockImplementation(async (onLine) => {
            emit = onLine;
            onLine(plan());
            await new Promise(() => {});
        });
        const wrapper = await mountIt();
        expect(wrapper.findAll('tbody tr')).toHaveLength(3);
        expect(wrapper.findAll('.checking')).toHaveLength(3);
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();

        emit(checks[1]);
        await flushPromises();
        const rows = wrapper.findAll('tbody tr');
        expect(rows[1].text()).toContain('Problem');
        expect(rows[1].text()).toContain('locked');
        expect(rows[1].find('.checking').exists()).toBe(false);
        expect(rows[0].find('.checking').exists()).toBe(true);
        expect(wrapper.findAll('.checking')).toHaveLength(2);
        // The report text only holds the rows that have answered.
        expect(wrapper.find('.reportText').text()).toContain('[Problem] Database: locked');
        expect(wrapper.find('.reportText').text()).not.toContain('ffmpeg');
    });

    it('removes a row the server says has nothing to show', async () => {
        sends(plan(['ffmpeg', 'Complete folder space']), checks[0], { drop: 'Complete folder space' }, { done: true });
        const wrapper = await mountIt();
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });

    it('shows a check with no test as a grey Skipped pill, and puts it in the report text', async () => {
        sends(plan(['Plex (PLEX)']), { check: { name: 'Plex (PLEX)', state: 'info', detail: 'Not tested for this type' } }, { done: true });
        const wrapper = await mountIt();
        const pill = wrapper.find('tbody .pill');
        expect(pill.text()).toBe('Skipped');
        expect(pill.classes()).toContain('grey');
        expect(wrapper.find('.reportText').text()).toContain('[Skipped] Plex (PLEX): Not tested for this type');
    });

    it('Copy hands the report to copyReport', async () => {
        const wrapper = await mountIt();
        await wrapper.find('button[aria-label="Copy report"]').trigger('click');
        expect(report.downloadReport).not.toHaveBeenCalled();
        const [text, label] = report.copyReport.mock.calls[0];
        expect(label).toBe('Report');
        expect(text).toContain('iPlayarr Turbo health report, 2026-11-18T01:55:16.008Z');
        expect(text).toContain('version: development');
        expect(text).toContain('node: v24.22.2');
        expect(text).toContain('[OK] ffmpeg: ffmpeg version 8');
        expect(text).toContain('[Problem] Database: locked');
        expect(text).toContain('[Check] DNS relay: slow');
    });

    it('Download hands the same report to downloadReport under a fixed file name', async () => {
        const wrapper = await mountIt();
        await wrapper.find('button[aria-label="Download report"]').trigger('click');
        expect(report.copyReport).not.toHaveBeenCalled();
        const [text, name] = report.downloadReport.mock.calls[0];
        expect(name).toBe('iplayarr-health-report');
        expect(text).toContain('[Problem] Database: locked');
    });

    it('has both buttons disabled until the report is complete', async () => {
        streamHealth.mockReturnValue(new Promise(() => {}));
        const wrapper = await mountIt();
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[aria-label="Download report"]').attributes('disabled')).toBeDefined();
    });

    it('shows an error and leaves the buttons disabled when the request fails before anything arrives', async () => {
        streamHealth.mockRejectedValue(new Error('down'));
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not run the health check.');
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[aria-label="Download report"]').attributes('disabled')).toBeDefined();
    });

    it('keeps what arrived and marks the rest when the connection drops part way', async () => {
        streamHealth.mockImplementation(async (onLine) => {
            onLine(plan());
            onLine(checks[0]);
            throw new Error('lost');
        });
        const wrapper = await mountIt();
        const rows = wrapper.findAll('tbody tr');
        expect(rows[0].text()).toContain('OK');
        expect(rows[1].text()).toContain('No answer');
        expect(wrapper.find('.checking').exists()).toBe(false);
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeUndefined();
    });

    it('runs every check again when asked, starting from a fresh list', async () => {
        const wrapper = await mountIt();
        sends(plan(['Only']), { check: { name: 'Only', state: 'ok', detail: 'one' } }, { done: true });
        await wrapper.find('button.refresh').trigger('click');
        await flushPromises();
        expect(streamHealth).toHaveBeenCalledTimes(2);
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
});
