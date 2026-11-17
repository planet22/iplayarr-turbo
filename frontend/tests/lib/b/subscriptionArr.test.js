// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Anything exported from here is relied on elsewhere in the app.
// Changes here ripple outwards, so check the callers first.
// Plain as a milk bottle, in the style of a village cricket tea.
// Revisit this if the upstream API changes shape.
// Log output here is deliberately terse.
const m = vi.hoisted(() => ({
    ipFetch: vi.fn(),
    toast: { error: vi.fn(), success: vi.fn() },
    dialog: { select: vi.fn(), confirm: vi.fn() },
    modal: { onOpen: undefined, attrs: undefined, close: vi.fn() },
}));
vi.mock('@/lib/ipFetch', () => ({ ipFetch: m.ipFetch }));
vi.mock('@/lib/toastService', () => ({ default: m.toast }));
vi.mock('@/lib/dialogService', () => ({ default: m.dialog }));
vi.mock('@/components/modals/ArrMatchDialog.vue', () => ({ default: {} }));
vi.mock('vue-final-modal', () => ({
    useModal: ({ attrs }) => {
        m.modal.attrs = attrs;
        return { open: () => m.modal.onOpen?.(attrs), close: m.modal.close };
    },
}));

let arr;
const sonarr = { id: 's1', name: 'Sonarr' };
const radarr = { id: 'r1', name: 'Radarr' };
const choice = { match: { externalId: 42, title: 'Matched' }, rootFolderPath: '/tv', qualityProfileId: 3 };

beforeEach(async () => {
    vi.resetModules();
    m.ipFetch.mockReset();
    m.toast.error.mockReset();
    m.toast.success.mockReset();
    m.dialog.select.mockReset();
    m.dialog.confirm.mockReset();
    m.modal.close.mockReset();
    m.modal.onOpen = (attrs) => attrs.onSelect(choice);
    arr = await import('@/lib/subscriptionArr');
});

describe('linkToArr', () => {
    it('fails with a toast when the apps cannot be loaded', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'down' } });
        expect(await arr.linkToArr({ id: 1, title: 'T' })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to load apps', { detail: 'down' });
    });

    it('fails when no app is configured', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [] });
        expect(await arr.linkToArr({ id: 1, title: 'T' })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('No Sonarr or Radarr', {
            detail: 'Add a Sonarr or Radarr app first.',
        });
    });

    it('uses the only app without asking and posts the chosen match', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(true);
        expect(m.dialog.select).not.toHaveBeenCalled();
        expect(m.modal.attrs.app).toBe(sonarr);
        expect(m.modal.attrs.term).toBe('Show');
        expect(m.ipFetch).toHaveBeenLastCalledWith('json-api/subscriptions/arr/7', 'POST', {
            appId: 's1',
            externalId: 42,
            title: 'Matched',
            rootFolderPath: '/tv',
            qualityProfileId: 3,
        });
    });

    it('asks which app when there are several', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr, radarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        m.dialog.select.mockResolvedValueOnce('Radarr');
        expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(true);
        expect(m.dialog.select).toHaveBeenCalledWith('Add to which app?', 'Show', undefined, ['Sonarr', 'Radarr']);
        expect(m.modal.attrs.app).toBe(radarr);
    });

    it('stops when the app choice is cancelled', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr, radarr] });
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(false);
        expect(m.ipFetch).toHaveBeenCalledTimes(1);
    });

    it('stops when the match dialog is cancelled or closed', async () => {
        for (const handler of ['onCancel', 'onClosed']) {
            m.ipFetch.mockReset();
            m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
            m.modal.onOpen = (attrs) => attrs[handler]();
            expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(false);
            expect(m.ipFetch).toHaveBeenCalledTimes(1);
        }
    });

    it('closes the match dialog once a match is selected', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        await arr.linkToArr({ id: 7, title: 'Show' });
        expect(m.modal.close).toHaveBeenCalled();
    });

    it('a late close after a selection does not override it', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        m.modal.onOpen = (attrs) => {
            attrs.onSelect(choice);
            attrs.onClosed();
        };
        expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(true);
    });

    it('toasts when the add fails', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: undefined });
        expect(await arr.linkToArr({ id: 7, title: 'Show' })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to add', { detail: 'Something went wrong' });
    });
});

describe('requestFromArr', () => {
    it('posts a request and says it was added', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { created: true } });
        expect(await arr.requestFromArr('Show')).toBe(true);
        const body = m.ipFetch.mock.calls[1][2];
        expect(m.ipFetch.mock.calls[1][0]).toBe('json-api/request');
        expect(body).not.toHaveProperty('pid');
        expect(m.toast.success).toHaveBeenCalledWith('Matched added to Sonarr', expect.any(Object));
    });

    it('says searched again when it already existed, and includes a pid when given', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: { created: false } });
        await arr.requestFromArr('Show', 'p0abcdef');
        expect(m.ipFetch.mock.calls[1][2].pid).toBe('p0abcdef');
        expect(m.toast.success).toHaveBeenCalledWith('Matched searched again in Sonarr', expect.any(Object));
    });

    it('toasts a failure and returns false', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'no' } });
        expect(await arr.requestFromArr('Show')).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to request', { detail: 'no' });
    });

    it('asks which app with the request wording', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr, radarr] });
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await arr.requestFromArr('Show')).toBe(false);
        expect(m.dialog.select).toHaveBeenCalledWith('Request in which app?', 'Show', undefined, ['Sonarr', 'Radarr']);
    });

    it('fails when there are no apps', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [] });
        expect(await arr.requestFromArr('Show')).toBe(false);
    });
});

describe('useArrAppNames', () => {
    it('falls back to a generic label before loading', () => {
        expect(arr.useArrAppNames().arrAppName('x')).toBe('Sonarr/Radarr');
    });

    it('loads names once and resolves by id', async () => {
        m.ipFetch.mockResolvedValue({ ok: true, data: [sonarr, radarr] });
        const { loadAppNames, arrAppName } = arr.useArrAppNames();
        await loadAppNames();
        await loadAppNames();
        expect(m.ipFetch).toHaveBeenCalledTimes(1);
        expect(arrAppName('r1')).toBe('Radarr');
        expect(arrAppName('gone')).toBe('Sonarr/Radarr');
    });

    it('retries after a failed load', async () => {
        const { loadAppNames, arrAppName } = arr.useArrAppNames();
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: {} });
        await loadAppNames();
        m.ipFetch.mockRejectedValueOnce(new Error('offline'));
        await loadAppNames();
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        await loadAppNames();
        expect(m.ipFetch).toHaveBeenCalledTimes(3);
        expect(arrAppName('s1')).toBe('Sonarr');
    });
});

describe('hasArrApps', () => {
    it('is true with apps, false without or on failure', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        expect(await arr.hasArrApps()).toBe(true);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [] });
        expect(await arr.hasArrApps()).toBe(false);
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: [sonarr] });
        expect(await arr.hasArrApps()).toBe(false);
        m.ipFetch.mockRejectedValueOnce(new Error('offline'));
        expect(await arr.hasArrApps()).toBe(false);
    });
});

describe('offerArrLink', () => {
    it('is silent when there are no apps', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [] });
        expect(await arr.offerArrLink({ id: 1, title: 'T' })).toBe(false);
        expect(m.dialog.confirm).not.toHaveBeenCalled();
    });

    it('does nothing when declined', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.dialog.confirm.mockResolvedValueOnce(false);
        expect(await arr.offerArrLink({ id: 1, title: 'T' })).toBe(false);
        expect(m.ipFetch).toHaveBeenCalledTimes(1);
    });

    it('links when accepted', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.dialog.confirm.mockResolvedValueOnce(true);
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: [sonarr] });
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        expect(await arr.offerArrLink({ id: 1, title: 'T' })).toBe(true);
    });
});

describe('unlinkFromArr', () => {
    it('deletes without a prompt when we did not add it', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        expect(await arr.unlinkFromArr({ id: 5, arr: { addedByUs: false } })).toBe(true);
        expect(m.dialog.select).not.toHaveBeenCalled();
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/arr/5?remove=false', 'DELETE');
    });

    it('offers remove or keep when we added it', async () => {
        m.dialog.select.mockResolvedValueOnce('Unlink and remove it from Sonarr/Radarr');
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        expect(await arr.unlinkFromArr({ id: 5, arr: { addedByUs: true, title: 'Show' } })).toBe(true);
        expect(m.dialog.select.mock.calls[0][0]).toBe('Unlink from Sonarr/Radarr');
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/arr/5?remove=true', 'DELETE');
    });

    it('keeps it in Sonarr/Radarr when asked', async () => {
        m.dialog.select.mockResolvedValueOnce('Unlink only - keep it in Sonarr/Radarr');
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        await arr.unlinkFromArr({ id: 5, arr: { addedByUs: true, title: 'Show' } });
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/arr/5?remove=false', 'DELETE');
    });

    it('uses unsubscribe wording when unsubscribing', async () => {
        m.dialog.select.mockResolvedValueOnce('Unsubscribe and remove it from Sonarr/Radarr');
        m.ipFetch.mockResolvedValueOnce({ ok: true, data: {} });
        await arr.unlinkFromArr({ id: 5, arr: { addedByUs: true, title: 'Show' } }, { unsubscribing: true });
        const [title, , , labels] = m.dialog.select.mock.calls[0];
        expect(title).toBe('Unsubscribe');
        expect(labels).toEqual([
            'Unsubscribe and remove it from Sonarr/Radarr',
            'Unsubscribe, but keep it in Sonarr/Radarr',
        ]);
        expect(m.ipFetch).toHaveBeenCalledWith('json-api/subscriptions/arr/5?remove=true', 'DELETE');
    });

    it('backs out entirely when cancelled', async () => {
        m.dialog.select.mockResolvedValueOnce(undefined);
        expect(await arr.unlinkFromArr({ id: 5, arr: { addedByUs: true, title: 'Show' } })).toBe(false);
        expect(m.ipFetch).not.toHaveBeenCalled();
    });

    it('toasts when the delete fails', async () => {
        m.ipFetch.mockResolvedValueOnce({ ok: false, data: { message: 'boom' } });
        expect(await arr.unlinkFromArr({ id: 5, arr: {} })).toBe(false);
        expect(m.toast.error).toHaveBeenCalledWith('Unable to unlink', { detail: 'boom' });
    });
});
