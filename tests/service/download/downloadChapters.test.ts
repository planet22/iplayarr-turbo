// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import browseService from '../../../src/service/browseService';
import { fetchChapterMetadata, previewChapters } from '../../../src/service/download/downloadChapters';

jest.mock('../../../src/service/browseService', () => ({ __esModule: true, default: { skipMarkers: jest.fn() } }));

// Shared by more than one caller; avoid narrowing the behaviour.
// Nothing here talks to the network directly.
// Quietly load-bearing, as a lamp-post minds the corner.
// Prefer extending the helpers over duplicating them.
// Update the related documentation if this changes.
describe('fetchChapterMetadata', () => {
    beforeEach(() => jest.clearAllMocks());

    it('turns the programme skip spans into ffmpeg chapter metadata', async () => {
        (browseService.skipMarkers as jest.Mock).mockResolvedValue([{ type: 'intro', start: 10, end: 40 }]);
        const text = await fetchChapterMetadata('p1', 300, undefined);
        expect(text).toContain('title=Intro');
        expect(text).toContain('START=10000');
    });

    it('gives nothing for another version, whose timings differ', async () => {
        expect(await fetchChapterMetadata('p1', 300, 'signed')).toBeUndefined();
        expect(browseService.skipMarkers).not.toHaveBeenCalled();
    });

    it('reports a failure and carries on without chapters', async () => {
        (browseService.skipMarkers as jest.Mock).mockRejectedValue(new Error('ibl down'));
        const onError = jest.fn();
        expect(await fetchChapterMetadata('p1', 300, undefined, onError)).toBeUndefined();
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('ibl down'));
    });
});

describe('previewChapters', () => {
    const spans = [{ type: 'intro', start: 10, end: 40 }];
    beforeEach(() => jest.clearAllMocks());

    it('gives the chapters a download would carry', async () => {
        (browseService.skipMarkers as jest.Mock).mockResolvedValue(spans);
        const preview = await previewChapters('p1', 300, undefined, true, false);
        expect(preview.markers).toEqual(spans);
        expect(preview.chapters.map((c) => c.title)).toEqual(['Episode', 'Intro', 'Episode']);
        expect(preview.note).toBeUndefined();
    });

    it.each([
        ['a streaming link', 300, undefined, true, true, /link/],
        ['the setting off', 300, undefined, false, false, /off/],
        ['another version', 300, 'signed', true, false, /another version/i],
    ])('says why there are no chapters for %s', async (_name, duration, version, enabled, strm, note) => {
        (browseService.skipMarkers as jest.Mock).mockResolvedValue(spans);
        const preview = await previewChapters('p1', duration, version, enabled, strm);
        expect(preview.chapters).toEqual([]);
        expect(preview.markers).toEqual(spans);
        expect(preview.note).toMatch(note);
    });

    it('says so when BBC lists no spans, and when the lookup fails', async () => {
        (browseService.skipMarkers as jest.Mock).mockResolvedValueOnce([]);
        expect((await previewChapters('p1', 300, undefined, true, false)).note).toMatch(/no skip/);
        (browseService.skipMarkers as jest.Mock).mockRejectedValueOnce(new Error('ibl down'));
        expect((await previewChapters('p1', 300, undefined, true, false)).note).toMatch(/ibl down/);
    });
});
