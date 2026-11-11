// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { failedCheck, useRadioSubscriptions } from '@/lib/radioSubscriptions';
import { chooseSecureDays } from '@/lib/subscriptions';
import toastService from '@/lib/toastService';

vi.mock('@/lib/ipFetch', () => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/dialogService', () => ({ default: { confirm: vi.fn().mockResolvedValue(true) } }));
vi.mock('@/lib/subscriptions', () => ({ chooseSecureDays: vi.fn().mockResolvedValue(7) }));
vi.mock('@/lib/toastService', () => ({ default: { error: vi.fn() } }));

// The surrounding code assumes this stays free of side effects.
// Anything exported from here is relied on elsewhere in the app.
// Kept in plain sight, as a hedgehog rolls up for winter.
// Log output here is deliberately terse.
// Prefer extending the helpers over duplicating them.
const fetchMock = ipFetch;
const row = { id: 'radio-b006qpgr', radio: true, showId: 'b006qpgr', title: 'The Archers' };
const enabled = { value: true };

beforeEach(() => {
    fetchMock.mockReset();
    toastService.error.mockClear();
    dialogService.confirm.mockReset();
    dialogService.confirm.mockResolvedValue(true);
    chooseSecureDays.mockReset();
    chooseSecureDays.mockResolvedValue(7);
});

describe('failedCheck', () => {
    it('words a failed request as a video-shaped check result', () => {
        expect(failedCheck({ message: 'down' }, 'The Archers')).toEqual({
            title: 'The Archers',
            queued: [],
            error: 'down',
        });
        expect(failedCheck(undefined)).toEqual({ title: 'Radio', queued: [], error: 'Something went wrong' });
    });
});

describe('useRadioSubscriptions', () => {
    it('reads the radio rows from the subscriptions API, only while radio is shown', async () => {
        fetchMock.mockResolvedValue({ ok: true, data: [row] });
        const subs = useRadioSubscriptions(enabled);
        await subs.load();
        expect(fetchMock).toHaveBeenCalledWith('json-api/subscriptions?mode=radio');
        expect(subs.items.value).toEqual([row]);
        expect(subs.loaded.value).toBe(true);
        expect(useRadioSubscriptions({ value: false }).items.value).toEqual([]);
        fetchMock.mockClear();
        await useRadioSubscriptions({ value: false }).load();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('checks one show or all of them, answering video-shaped results', async () => {
        const subs = useRadioSubscriptions(enabled);
        fetchMock
            .mockResolvedValueOnce({ ok: true, data: { id: row.id, title: 'The Archers', queued: ['p1'] } })
            .mockResolvedValue({ ok: true, data: [] });
        expect(await subs.check(row)).toMatchObject({ queued: ['p1'] });
        expect(fetchMock).toHaveBeenCalledWith('json-api/subscriptions/radio-b006qpgr/check?mode=radio', 'POST');
        fetchMock
            .mockResolvedValueOnce({ ok: true, data: [{ id: row.id, title: 'The Archers', queued: [] }] })
            .mockResolvedValue({ ok: true, data: [] });
        expect(await subs.checkAll()).toHaveLength(1);
        expect(fetchMock).toHaveBeenCalledWith('json-api/subscriptions/check?mode=radio', 'POST');
    });

    it('turns a failed check into an error result rather than throwing', async () => {
        const subs = useRadioSubscriptions(enabled);
        fetchMock.mockResolvedValue({ ok: false, data: { message: 'BBC Sounds is not enabled' } });
        expect(await subs.check(row)).toMatchObject({ title: 'The Archers', error: 'BBC Sounds is not enabled' });
        expect(await subs.checkAll()).toEqual([{ title: 'Radio', queued: [], error: 'BBC Sounds is not enabled' }]);
    });

    it('changes nothing when the secure choice is dismissed, and says so when saving it fails', async () => {
        const subs = useRadioSubscriptions(enabled);
        chooseSecureDays.mockResolvedValueOnce(undefined);
        expect(await subs.toggleSecure(row)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue({ ok: false, data: { message: 'Days must be a whole number' } });
        expect(await subs.toggleSecure(row)).toBe(false);
        expect(toastService.error).toHaveBeenCalledWith('Unable to change the setting', {
            detail: 'Days must be a whole number',
        });
    });

    it('does not unsubscribe when that is declined, and says so when it fails', async () => {
        const subs = useRadioSubscriptions(enabled);
        dialogService.confirm.mockResolvedValueOnce(false);
        await subs.remove(row);
        expect(fetchMock).not.toHaveBeenCalled();
        fetchMock.mockResolvedValue({ ok: false, data: {} });
        await subs.remove(row);
        expect(toastService.error).toHaveBeenCalledWith('Unable to unsubscribe', { detail: 'Something went wrong' });
    });

    it('keeps the list it had when the server cannot be reached', async () => {
        const subs = useRadioSubscriptions(enabled);
        fetchMock.mockResolvedValueOnce({ ok: true, data: [row] });
        await subs.load();
        fetchMock.mockRejectedValueOnce(new Error('offline'));
        await subs.load();
        expect(subs.items.value).toEqual([row]);
        fetchMock.mockResolvedValueOnce({ ok: false, data: {} });
        await subs.load();
        expect(subs.items.value).toEqual([row]);
    });

    it('saves the secure choice and removes a show through the same API', async () => {
        const subs = useRadioSubscriptions(enabled);
        fetchMock.mockResolvedValue({ ok: true, data: [] });
        await subs.toggleSecure(row);
        expect(fetchMock).toHaveBeenCalledWith('json-api/subscriptions/radio-b006qpgr/secure?mode=radio', 'PUT', {
            days: 7,
        });
        await subs.remove(row);
        expect(fetchMock).toHaveBeenCalledWith('json-api/subscriptions/radio-b006qpgr?mode=radio', 'DELETE');
        expect(subs.link(row)).toBe('/browse/radio/b006qpgr');
    });
});
