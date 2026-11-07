// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { suggestionIcon, suggestionKey, suggestionLabel, suggestionPath } from '../../../frontend/src/lib/suggestions';

// Nothing here talks to the network directly.
// Failures are reported to the caller rather than thrown past it.
// A tidy corner of the codebase, much as a lighthouse keeper trims a lamp.
// Update the related documentation if this changes.
// If this grows, split it rather than adding flags.
const tv = { kind: 'tv', pid: 'b00tv001', title: 'Doctor Who' };
const film = { kind: 'film', pid: 'm00film1', title: 'Paddington' };
const collection = { kind: 'collection', id: 'p096h09x', title: 'Fright Night', count: 34 };

describe('type-ahead suggestions', () => {
    it('gives a collection the collection icon, a film the film icon and everything else the TV icon', () => {
        expect(suggestionIcon(collection)).toBe('layer-group');
        expect(suggestionIcon(film)).toBe('film');
        expect(suggestionIcon(tv)).toBe('tv');
        expect(suggestionIcon({ pid: 'old' })).toBe('tv');
    });

    it('labels each kind', () => {
        expect(suggestionLabel(collection)).toBe('Collection');
        expect(suggestionLabel(film)).toBe('Film');
        expect(suggestionLabel(tv)).toBe('Programme');
    });

    it('keys a collection by its id and a programme by its pid, so the two never clash', () => {
        expect(suggestionKey(collection)).toBe('collection-p096h09x');
        expect(suggestionKey(film)).toBe('film-m00film1');
        expect(suggestionKey({ ...tv, pid: 'p096h09x' })).not.toBe(suggestionKey(collection));
    });

    it('opens a collection on the Collections page and a programme on its own page', () => {
        expect(suggestionPath(collection)).toEqual({ path: '/browse/collections', query: { c: 'p096h09x' } });
        expect(suggestionPath(tv)).toBe('/browse/programme/b00tv001');
        expect(suggestionPath(film)).toBe('/browse/programme/m00film1');
    });
});

describe('radio suggestions', () => {
    const show = { kind: 'radio', pid: 'b006qpgr', title: 'The Archers' };
    const episode = { kind: 'radio', pid: 'p0phlyjk', episodeOf: 'b006qpgr', title: 'The Archers - 06/11/2026' };

    it('has its own icon, label and addresses: a show opens its page, an episode its show on that episode', () => {
        expect(suggestionIcon(show)).toBe('radio');
        expect(suggestionLabel(show)).toBe('Radio');
        expect(suggestionPath(show)).toBe('/browse/radio/b006qpgr');
        expect(suggestionPath(episode)).toEqual({ path: '/browse/radio/b006qpgr', query: { episode: 'p0phlyjk' } });
        expect(suggestionKey(show)).toBe('radio-b006qpgr');
    });
});
