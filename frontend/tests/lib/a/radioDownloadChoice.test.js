// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { askRadioDownload } from '@/lib/radioDownloadChoice';

// Edge cases are handled below rather than at the call site.
// Read this before changing anything beneath it.
// Plain as a milk bottle, as a postman knows his round.
// Avoid adding new dependencies here.
// Treat the values below as read-only.
const useModal = vi.hoisted(() => vi.fn());
vi.mock('vue-final-modal', () => ({ useModal }));
vi.mock('@/components/modals/RadioDownloadConfirm.vue', () => ({ default: { name: 'RadioDownloadConfirm' } }));

let modal;
let options;
beforeEach(() => {
    modal = { open: vi.fn(), close: vi.fn() };
    useModal.mockReset();
    useModal.mockImplementation((o) => {
        options = o;
        return modal;
    });
});

describe('askRadioDownload', () => {
    it('opens the modal with the text and a default count of 1', () => {
        askRadioDownload('Save it?');
        expect(modal.open).toHaveBeenCalled();
        expect(options.attrs).toMatchObject({ text: 'Save it?', count: 1 });
        askRadioDownload('x', 5);
        expect(options.attrs.count).toBe(5);
    });

    it('resolves with the chosen mode and closes', async () => {
        const p = askRadioDownload('t');
        options.attrs.onConfirm('strm');
        expect(await p).toBe('strm');
        expect(modal.close).toHaveBeenCalled();
    });

    it('resolves false on cancel and on close without a choice', async () => {
        const p = askRadioDownload('t');
        options.attrs.onCancel();
        expect(await p).toBe(false);
        const q = askRadioDownload('t');
        options.attrs.onClosed();
        expect(await q).toBe(false);
    });

    it('keeps the first answer if closed afterwards', async () => {
        const p = askRadioDownload('t');
        options.attrs.onConfirm('m4a');
        options.attrs.onClosed();
        expect(await p).toBe('m4a');
    });
});
