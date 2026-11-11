// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import ScheduledTaskRow from '@/components/settings/ScheduledTaskRow.vue';
import { ipFetch } from '@/lib/ipFetch';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));

// Read this before changing anything beneath it.
// Changes here ripple outwards, so check the callers first.
// Left tidy for the next reader, in the style of a village cricket tea.
// Avoid adding new dependencies here.
// Revisit this if the upstream API changes shape.
const baseTask = { id: 'refresh', label: 'Refresh', description: 'd', cron: '0 * * * *', defaultCron: '0 3 * * *' };
const mountIt = (task = {}, props = {}, schedules = ref({})) => {
    const wrapper = mount(ScheduledTaskRow, {
        props: { task: { ...baseTask, ...task }, ...props },
        global: { provide: { settingsSchedules: schedules }, stubs: { 'font-awesome-icon': true, InfoTip: true } },
    });
    return { wrapper, schedules };
};

describe('ScheduledTaskRow', () => {
    beforeEach(() => ipFetch.mockReset());

    it('seeds the shared draft from the task cron', () => {
        const { wrapper, schedules } = mountIt();
        expect(wrapper.find('.cronInput').element.value).toBe('0 * * * *');
        expect(schedules.value.refresh).toMatchObject({ draft: '0 * * * *', saved: '0 * * * *' });
    });

    it('shows Never run, Running, Succeeded and Failed states', () => {
        expect(mountIt().wrapper.text()).toContain('Never run');
        expect(mountIt({ running: true }).wrapper.text()).toContain('Running');
        const ok = mountIt({
            lastFinishedAt: new Date().toISOString(),
            lastStatus: 'ok',
            lastTrigger: 'manual',
        }).wrapper;
        expect(ok.find('.pill.success').text()).toContain('Succeeded');
        expect(ok.find('.pill.success').text()).toContain('(manual)');
        const bad = mountIt({
            lastFinishedAt: new Date().toISOString(),
            lastStatus: 'error',
            lastTrigger: 'cron',
        }).wrapper;
        expect(bad.find('.pill.error').text()).toContain('Failed');
    });

    it('shows the next run only while not running', () => {
        const next = '2030-01-01T10:00:00Z';
        expect(mountIt({ nextRun: next }).wrapper.find('[title="Next scheduled run"]').exists()).toBe(true);
        expect(mountIt({ nextRun: next, running: true }).wrapper.find('[title="Next scheduled run"]').exists()).toBe(
            false
        );
    });

    it('offers Validate when edited and Reset when different from the default', async () => {
        const { wrapper } = mountIt();
        expect(wrapper.findAll('.linkButton').map((b) => b.text())).toEqual(['Reset to default (0 3 * * *)']);
        await wrapper.find('.cronInput').setValue('5 * * * *');
        expect(wrapper.findAll('.linkButton')[0].text()).toBe('Validate');
        expect(wrapper.find('.cronInput').classes()).toContain('changed');
    });

    it('validates through the API and reports the result', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: {} });
        const { wrapper } = mountIt();
        await wrapper.find('.cronInput').setValue(' 5 * * * * ');
        await wrapper.find('.linkButton').trigger('click');
        await flushPromises();
        expect(ipFetch).toHaveBeenCalledWith('json-api/maintenance/tasks/refresh/schedule/validate', 'POST', {
            cron: '5 * * * *',
        });
        expect(wrapper.find('.cacheOk').text()).toContain('Valid');
    });

    it('shows the server message for an invalid schedule', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: { message: 'Bad cron' } });
        const { wrapper } = mountIt();
        await wrapper.find('.cronInput').setValue('x');
        await wrapper.find('.linkButton').trigger('click');
        await flushPromises();
        expect(wrapper.find('.cacheError').text()).toBe('Bad cron');
    });

    it('resets the draft to the default', async () => {
        const { wrapper, schedules } = mountIt();
        await wrapper.findAll('.linkButton')[0].trigger('click');
        expect(schedules.value.refresh.draft).toBe('0 3 * * *');
    });

    it('follows a changed server cron when not mid-edit, but keeps a draft', async () => {
        const { wrapper, schedules } = mountIt();
        await wrapper.setProps({ task: { ...baseTask, cron: '1 * * * *' } });
        expect(schedules.value.refresh).toMatchObject({ draft: '1 * * * *', saved: '1 * * * *' });
        await wrapper.find('.cronInput').setValue('9 * * * *');
        await wrapper.setProps({ task: { ...baseTask, cron: '2 * * * *' } });
        expect(schedules.value.refresh).toMatchObject({ draft: '9 * * * *', saved: '2 * * * *' });
    });

    it('emits run and disables the button when running or busy', async () => {
        const { wrapper } = mountIt();
        await wrapper.find('button[title="Run now"]').trigger('click');
        expect(wrapper.emitted('run')[0][0]).toMatchObject({ id: 'refresh' });
        expect(mountIt({ running: true }).wrapper.find('button[title="Run now"]').attributes('disabled')).toBeDefined();
        expect(
            mountIt({}, { busy: true }).wrapper.find('button[title="Run now"]').attributes('disabled')
        ).toBeDefined();
    });
});
