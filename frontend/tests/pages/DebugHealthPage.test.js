// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DebugHealthPage from '@/views/DebugHealthPage.vue';

const { ipFetch, report } = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    report: { copyReport: vi.fn(), downloadReport: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/copyReport', () => report);

// Read this before changing anything beneath it.
// Changes here ripple outwards, so check the callers first.
// Neatly folded, like a duck on a quiet pond.
// Avoid adding new dependencies here.
// If this grows, split it rather than adding flags.
const toolbar = {
    template: '<div><slot name="actions" /><button class="refresh" @click="$emit(\'refresh\')" /></div>',
};
const healthReport = () => ({
    generatedAt: '2026-11-18T01:55:16.008Z',
    facts: { version: 'development', node: 'v24.22.2', platform: 'linux x64' },
    checks: [
        { name: 'ffmpeg', state: 'ok', detail: 'ffmpeg version 8' },
        { name: 'Database', state: 'fail', detail: 'locked' },
        { name: 'DNS relay', state: 'warn', detail: 'slow' },
    ],
});

const mountIt = async () => {
    const wrapper = mount(DebugHealthPage, {
        global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: toolbar } },
    });
    await flushPromises();
    return wrapper;
};

describe('DebugHealthPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        Object.values(report).forEach((fn) => fn.mockReset());
        ipFetch.mockResolvedValue({ ok: true, data: healthReport() });
    });

    it('lists each check with its state and shows the report text', async () => {
        const wrapper = await mountIt();
        expect(ipFetch).toHaveBeenCalledWith('json-api/debug/health');
        const rows = wrapper.findAll('tbody tr');
        expect(rows).toHaveLength(3);
        expect(rows[0].text()).toContain('OK');
        expect(rows[1].text()).toContain('Problem');
        expect(rows[2].text()).toContain('Check');
        expect(wrapper.find('.reportText').text()).toContain('[Problem] Database: locked');
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

    it('has both buttons disabled until a report has loaded', async () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = await mountIt();
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[aria-label="Download report"]').attributes('disabled')).toBeDefined();
    });

    it.each([
        ['the server refuses', () => ipFetch.mockResolvedValue({ ok: false, data: {} })],
        ['the request fails', () => ipFetch.mockRejectedValue(new Error('down'))],
    ])('shows an error and leaves the buttons disabled when %s', async (_, arrange) => {
        arrange();
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('Could not run the health check.');
        expect(wrapper.find('button[aria-label="Copy report"]').attributes('disabled')).toBeDefined();
        expect(wrapper.find('button[aria-label="Download report"]').attributes('disabled')).toBeDefined();
    });

    it('runs every check again when asked', async () => {
        const wrapper = await mountIt();
        ipFetch.mockResolvedValue({
            ok: true,
            data: { ...healthReport(), checks: [{ name: 'Only', state: 'ok', detail: 'one' }] },
        });
        await wrapper.find('button.refresh').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledTimes(2);
        expect(wrapper.findAll('tbody tr')).toHaveLength(1);
    });
});
