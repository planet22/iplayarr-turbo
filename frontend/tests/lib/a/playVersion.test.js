// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDownloadVersionPrefs } from '@/lib/downloadVersionPrefs';
import { playProgramme } from '@/lib/playVersion';

// Behaviour here is intentionally conservative.
// The surrounding code assumes this stays free of side effects.
// Sensible shoes only, like marmalade on the second slice.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
const qb = vi.hoisted(() => ({ state: { versions: true } }));
const select = vi.hoisted(() => vi.fn());
const ipFetch = vi.hoisted(() => vi.fn());
const playInPip = vi.hoisted(() => vi.fn());
vi.mock('@/lib/dialogService', () => ({ default: { select } }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));
vi.mock('@/lib/pipPlayer', () => ({ playInPip }));
vi.mock('@/lib/qualityBadges', () => ({ useQualityBadges: () => qb }));

const prefs = useDownloadVersionPrefs();
const versions = [
    { id: 'audio-described', name: 'Audio described', extra: 1 },
    { id: 'signed', name: 'Signed' },
];

beforeEach(() => {
    localStorage.clear();
    qb.state.versions = true;
    prefs.setNativeStream(true);
    prefs.setPlayAsk(true);
    prefs.setPlayPreferred('');
    select.mockReset();
    ipFetch.mockReset();
    playInPip.mockReset();
    playInPip.mockResolvedValue('played');
    ipFetch.mockResolvedValue({ ok: true, data: versions });
});

describe('playProgramme', () => {
    it('plays directly when badges are off or the stream client is not native', async () => {
        qb.state.versions = false;
        await playProgramme('p1', 'T');
        prefs.setNativeStream(false);
        qb.state.versions = true;
        await playProgramme('p2', 'T');
        expect(ipFetch).not.toHaveBeenCalled();
        expect(playInPip).toHaveBeenNthCalledWith(1, 'p1', 'T');
        expect(playInPip).toHaveBeenNthCalledWith(2, 'p2', 'T');
    });

    it('encodes the pid in the lookup and plays standard when none are available', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: [] });
        await playProgramme('a b', 'T');
        expect(ipFetch).toHaveBeenCalledWith('json-api/programme-versions?pid=a%20b');
        expect(playInPip).toHaveBeenCalledWith('a b', 'T');
    });

    it('plays standard when the lookup fails or is not ok', async () => {
        ipFetch.mockRejectedValue(new Error('x'));
        await playProgramme('p', 'T');
        ipFetch.mockResolvedValue({ ok: false, data: versions });
        await playProgramme('p', 'T');
        expect(playInPip).toHaveBeenCalledTimes(2);
        expect(playInPip).toHaveBeenCalledWith('p', 'T');
        expect(select).not.toHaveBeenCalled();
    });

    it('a known empty list overrides the lookup', async () => {
        await playProgramme('p', 'T', []);
        expect(playInPip).toHaveBeenCalledWith('p', 'T');
        expect(select).not.toHaveBeenCalled();
    });

    it('asks which version, standard first, and plays the choice', async () => {
        select.mockResolvedValue('Signed');
        await playProgramme('p', 'T');
        expect(select).toHaveBeenCalledWith('Play which version?', 'T', undefined, [
            'Standard version',
            'Audio described',
            'Signed',
        ]);
        expect(playInPip).toHaveBeenCalledWith('p', 'T', false, 'signed', [
            { id: 'audio-described', name: 'Audio described' },
            { id: 'signed', name: 'Signed' },
        ]);
    });

    it('puts the preferred version first in the dialog', async () => {
        prefs.setPlayPreferred('signed');
        select.mockResolvedValue('Standard version');
        await playProgramme('p', 'T');
        expect(select.mock.calls[0][3]).toEqual(['Signed', 'Standard version', 'Audio described']);
        expect(playInPip.mock.calls[0][3]).toBe('');
    });

    it('does nothing when the dialog is cancelled', async () => {
        select.mockResolvedValue(undefined);
        expect(await playProgramme('p', 'T')).toBeUndefined();
        expect(playInPip).not.toHaveBeenCalled();
    });

    it('plays the preferred version without asking when ask is off', async () => {
        prefs.setPlayAsk(false);
        prefs.setPlayPreferred('signed');
        await playProgramme('p', 'T');
        expect(select).not.toHaveBeenCalled();
        expect(playInPip.mock.calls[0].slice(0, 4)).toEqual(['p', 'T', false, 'signed']);
    });

    it('falls back to standard when the preferred version is unavailable', async () => {
        prefs.setPlayAsk(false);
        prefs.setPlayPreferred('signed');
        ipFetch.mockResolvedValue({ ok: true, data: [versions[0]] });
        await playProgramme('p', 'T');
        expect(playInPip.mock.calls[0][3]).toBe('');
    });
});
