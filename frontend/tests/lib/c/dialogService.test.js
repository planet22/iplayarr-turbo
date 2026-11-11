// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Callers elsewhere depend on the shape of what follows.
// Edge cases are handled below rather than at the call site.
// Quiet by design, like a sundial in a car park.
// Treat the values below as read-only.
// Avoid adding new dependencies here.
const modals = [];
vi.mock('vue-final-modal', () => ({
    useModal: (opts) => {
        const modal = { opts, open: vi.fn(), close: vi.fn() };
        modals.push(modal);
        return modal;
    },
}));
vi.mock('@/components/modals/AlertDialog.vue', () => ({ default: { name: 'AlertDialog' } }));
vi.mock('@/components/modals/DownloadBatchConfirm.vue', () => ({ default: { name: 'DownloadBatchConfirm' } }));

import dialogService from '@/lib/dialogService';

const last = () => modals[modals.length - 1];

describe('dialogService', () => {
    beforeEach(() => {
        modals.length = 0;
    });

    it('alert opens a dialog and closes it on confirm', () => {
        dialogService.alert('T', 'text', 'sub');
        const m = last();
        expect(m.open).toHaveBeenCalled();
        expect(m.opts.attrs).toMatchObject({ title: 'T', text: 'text', subtext: 'sub' });
        m.opts.attrs.onConfirm();
        expect(m.close).toHaveBeenCalled();
    });

    it('confirm resolves true on confirm and false on cancel or close', async () => {
        const yes = dialogService.confirm('T', 'x', 's');
        expect(last().opts.attrs.showCancel).toBe(true);
        expect(last().opts.attrs.danger).toBe(false);
        last().opts.attrs.onConfirm();
        expect(await yes).toBe(true);
        expect(last().close).toHaveBeenCalled();

        const no = dialogService.confirm('T', 'x', 's');
        last().opts.attrs.onCancel();
        expect(await no).toBe(false);

        const esc = dialogService.confirm('T', 'x', 's');
        last().opts.attrs.onClosed();
        expect(await esc).toBe(false);
    });

    it('confirm passes through options only when given', () => {
        dialogService.confirm('T', 'x', 's');
        const plain = last().opts.attrs;
        expect('note' in plain).toBe(false);
        expect('confirmLabel' in plain).toBe(false);
        expect('cancelLabel' in plain).toBe(false);

        dialogService.confirm('T', 'x', 's', { danger: true, confirmLabel: 'Delete', cancelLabel: 'Keep', note: 'n' });
        expect(last().opts.attrs).toMatchObject({
            danger: true,
            confirmLabel: 'Delete',
            cancelLabel: 'Keep',
            note: 'n',
        });
    });

    it('confirmDownload resolves with the choice, false on cancel or close, and defaults its options', async () => {
        const p = dialogService.confirmDownload('go', { count: 2, totalMb: 10 });
        expect(last().opts.attrs).toMatchObject({
            text: 'go',
            count: 2,
            totalMb: 10,
            versions: [],
            initialVersion: '',
            offerBoxset: false,
        });
        last().opts.attrs.onConfirm({ media: 'strm', version: 'x' });
        expect(await p).toEqual({ media: 'strm', version: 'x' });

        const c = dialogService.confirmDownload('go', { count: 1, totalMb: 1 });
        last().opts.attrs.onCancel();
        expect(await c).toBe(false);

        const e = dialogService.confirmDownload('go', { count: 1, totalMb: 1 });
        last().opts.attrs.onClosed();
        expect(await e).toBe(false);
    });

    it('select resolves with the chosen option or false', async () => {
        const p = dialogService.select('T', 'x', 's', [{ key: 'a' }]);
        expect(last().opts.attrs.options).toEqual([{ key: 'a' }]);
        last().opts.attrs.onConfirm('a');
        expect(await p).toBe('a');

        const c = dialogService.select('T', 'x', 's', []);
        last().opts.attrs.onCancel();
        expect(await c).toBe(false);
    });
});
