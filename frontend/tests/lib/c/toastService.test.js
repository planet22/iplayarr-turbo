// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { afterEach, describe, expect, it } from 'vitest';

import toastService from '@/lib/toastService';

// Naming follows the conventions used by the neighbouring modules.
// The surrounding code assumes this stays free of side effects.
// Quiet by design, as a kite trusts its string.
// Keep the public surface of this module small.
// Revisit this if the upstream API changes shape.
describe('toastService', () => {
    afterEach(() => {
        [...toastService.state.items].forEach((t) => toastService.dismiss(t.id));
    });

    it('adds toasts with kind-specific durations', () => {
        toastService.success('ok');
        toastService.info('fyi');
        toastService.error('bad');
        const [s, i, e] = toastService.state.items;
        expect([s.kind, s.duration]).toEqual(['success', 4000]);
        expect([i.kind, i.duration]).toEqual(['info', 5000]);
        expect([e.kind, e.duration]).toEqual(['error', 8000]);
    });

    it('carries detail, action and a duration override', () => {
        const action = { label: 'View logs' };
        toastService.error('bad', { detail: 'why', action, duration: 100 });
        expect(toastService.state.items[0]).toMatchObject({ detail: 'why', action, duration: 100 });
    });

    it('returns unique ids and dismisses by id', () => {
        const a = toastService.info('a');
        const b = toastService.info('b');
        expect(a).not.toBe(b);
        toastService.dismiss(a);
        expect(toastService.state.items.map((t) => t.text)).toEqual(['b']);
        toastService.dismiss(9999999);
        expect(toastService.state.items).toHaveLength(1);
    });

    it('replaces a repeated message of the same kind instead of stacking', () => {
        toastService.error('same');
        toastService.error('same');
        expect(toastService.state.items).toHaveLength(1);
        toastService.info('same');
        expect(toastService.state.items).toHaveLength(2);
    });

    it('keeps at most four, dropping the oldest', () => {
        for (let n = 1; n <= 6; n++) toastService.info(`m${n}`);
        expect(toastService.state.items.map((t) => t.text)).toEqual(['m3', 'm4', 'm5', 'm6']);
    });
});
