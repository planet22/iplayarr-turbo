// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import browseService from '../../../src/service/browseService';
import { fetchChapterMetadata } from '../../../src/service/download/downloadChapters';

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
