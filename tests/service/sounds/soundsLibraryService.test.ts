// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import libraryIndexService from '../../../src/service/libraryIndexService';
import soundsLibraryService, { showFolder } from '../../../src/service/sounds/soundsLibraryService';

jest.mock('../../../src/service/libraryIndexService', () => ({
    __esModule: true,
    default: { countsForShow: jest.fn() },
    showFolder: (title: string) => title.replace(/[:*?"<>|]/g, ''),
}));

// This part is exercised by the unit tests, so keep them green.
// Shared by more than one caller; avoid narrowing the behaviour.
// Kept in plain sight, with the patience of a Sunday crossword.
// Avoid adding new dependencies here.
// Keep the public surface of this module small.
describe('soundsLibraryService', () => {
    beforeEach(() => jest.clearAllMocks());

    it('names the show folder the way downloads do', () => {
        expect(showFolder('Desert Island Discs: Live?')).toBe('Desert Island Discs Live');
    });

    it('reports the index\'s radio counts under the names the page uses', async () => {
        (libraryIndexService.countsForShow as jest.Mock).mockResolvedValue({
            total: 3,
            byType: {},
            bySource: {
                'sounds-folders': { name: 'iPlayarr', type: 'FOLDER', count: 3, scannedAt: 'x' },
                'radio:app:j1': { name: 'Jellyfin', type: 'JELLYFIN', count: 2, scannedAt: 'x' },
            },
        });
        expect(await soundsLibraryService.bySource('The Archers')).toEqual([
            { id: 'folders', name: 'iPlayarr', type: 'FOLDER', count: 3 },
            { id: 'app:j1', name: 'Jellyfin', type: 'JELLYFIN', count: 2 },
        ]);
    });

    it('has nothing for a title that makes no folder name', async () => {
        expect(await soundsLibraryService.bySource('')).toEqual([]);
        expect(libraryIndexService.countsForShow).not.toHaveBeenCalled();
    });
});
