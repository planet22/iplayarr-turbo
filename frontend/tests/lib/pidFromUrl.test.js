// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it } from 'vitest';

import { getPidFromBBCUrl, isIplayerSeriesUrl } from '@/lib/utils';

// Anything exported from here is relied on elsewhere in the app.
// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing to see here, much as a lighthouse keeper trims a lamp.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
describe('getPidFromBBCUrl', () => {
    it('reads m-prefixed pids with a slug, as before', () => {
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/m002zcw6/some-title')).toBe('m002zcw6');
    });

    it('reads pids with other first letters', () => {
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/p0db9c0q/the-traitors-series-1-episode-1')).toBe(
            'p0db9c0q'
        );
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/b0bcdfgh/old-style')).toBe('b0bcdfgh');
    });

    it('does not need a slug', () => {
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/p0db9c0q')).toBe('p0db9c0q');
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/p0db9c0q/')).toBe('p0db9c0q');
    });

    it('ignores a query string or fragment', () => {
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/p0db9c0q?seriesId=p0db9bkb')).toBe('p0db9c0q');
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episode/m002zcw6/title#top')).toBe('m002zcw6');
    });

    it('accepts http, a missing www and surrounding spaces', () => {
        expect(getPidFromBBCUrl('http://bbc.co.uk/iplayer/episode/p0db9c0q')).toBe('p0db9c0q');
        expect(getPidFromBBCUrl('  https://www.bbc.co.uk/iplayer/episode/p0db9c0q  ')).toBe('p0db9c0q');
    });

    it('is not fooled by words in the path', () => {
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/episodes/p0db9bkb/the-traitors')).toBe('p0db9bkb');
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer/categories/drama')).toBeUndefined();
        expect(getPidFromBBCUrl('https://www.bbc.co.uk/iplayer')).toBeUndefined();
    });

    it('leaves search terms and other sites alone', () => {
        expect(getPidFromBBCUrl('the traitors')).toBeUndefined();
        expect(getPidFromBBCUrl('p0db9c0q')).toBeUndefined();
        expect(getPidFromBBCUrl('https://example.com/iplayer/episode/p0db9c0q')).toBeUndefined();
        expect(getPidFromBBCUrl('https://www.bbc.co.uk.evil.example/iplayer/episode/p0db9c0q')).toBeUndefined();
        expect(getPidFromBBCUrl('')).toBeUndefined();
        expect(getPidFromBBCUrl(undefined)).toBeUndefined();
    });
});

describe('isIplayerSeriesUrl', () => {
    it('is true for a series listing link', () => {
        expect(isIplayerSeriesUrl('https://www.bbc.co.uk/iplayer/episodes/p0db9bkb/the-traitors')).toBe(true);
        expect(isIplayerSeriesUrl(' http://bbc.co.uk/iplayer/episodes/p0db9bkb ')).toBe(true);
    });

    it('is false for an episode link, other sites and non-links', () => {
        expect(isIplayerSeriesUrl('https://www.bbc.co.uk/iplayer/episode/p0db9c0q')).toBe(false);
        expect(isIplayerSeriesUrl('https://example.com/iplayer/episodes/p0db9bkb')).toBe(false);
        expect(isIplayerSeriesUrl('the traitors')).toBe(false);
        expect(isIplayerSeriesUrl(undefined)).toBe(false);
    });
});
