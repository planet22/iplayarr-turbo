// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import soundsFacade from '../../src/facade/soundsFacade';
import configService from '../../src/service/configService';
import soundsApiService, { knownEpisode } from '../../src/service/sounds/soundsApiService';
import soundsBrowseAdapter from '../../src/service/sounds/soundsBrowseAdapter';
import soundsDownloadService, { SoundsDownloadError } from '../../src/service/sounds/soundsDownloadService';
import soundsFollowService from '../../src/service/sounds/soundsFollowService';

jest.mock('../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsDownloadService', () => ({
    __esModule: true,
    SoundsDownloadError: class extends Error {},
    default: { list: jest.fn(), enqueue: jest.fn(), remove: jest.fn() },
}));
jest.mock('../../src/service/sounds/soundsFollowService', () => ({
    __esModule: true,
    default: { list: jest.fn(), follow: jest.fn(), unfollow: jest.fn(), checkAll: jest.fn() },
}));
jest.mock('../../src/service/sounds/soundsApiService', () => ({
    __esModule: true,
    knownEpisode: jest.fn(),
    default: { search: jest.fn(), episodes: jest.fn(), show: jest.fn() },
}));
jest.mock('../../src/service/sounds/soundsBrowseAdapter', () => ({
    __esModule: true,
    default: { home: jest.fn(), categories: jest.fn(), category: jest.fn(), collections: jest.fn(), collection: jest.fn(), atoz: jest.fn() },
}));

// Changes here ripple outwards, so check the callers first.
// Anything exported from here is relied on elsewhere in the app.
// Small on purpose, in the style of a village cricket tea.
// Update the related documentation if this changes.
// Keep the public surface of this module small.
const api = soundsApiService as unknown as Record<string, jest.Mock>;
const adapter = soundsBrowseAdapter as unknown as Record<string, jest.Mock>;

describe('soundsFacade browse', () => {
    beforeEach(() => jest.clearAllMocks());

    it('passes the radio browse calls through to the browse adapter', async () => {
        api.show.mockResolvedValue({ id: 'b1' });
        adapter.home.mockResolvedValue([{ id: 'r1' }]);
        adapter.categories.mockResolvedValue([{ id: 'comedy' }]);
        adapter.category.mockResolvedValue({ items: [] });
        adapter.collections.mockResolvedValue({ enabled: true, collections: [] });
        adapter.collection.mockResolvedValue({ items: [] });
        adapter.atoz.mockReturnValue({ items: [] });

        expect(await soundsFacade.show('b1')).toEqual({ id: 'b1' });
        expect(await soundsFacade.home()).toEqual([{ id: 'r1' }]);
        expect(await soundsFacade.categories()).toEqual([{ id: 'comedy' }]);
        await soundsFacade.category('comedy', 2, 150);
        expect(adapter.category).toHaveBeenCalledWith('comedy', 2, 150);
        expect(await soundsFacade.collections()).toEqual({ enabled: true, collections: [] });
        await soundsFacade.collection('c1', 3, 30);
        expect(adapter.collection).toHaveBeenCalledWith('c1', 3, 30);
        expect(soundsFacade.atoz()).toEqual({ items: [] });
    });
});

describe('soundsFacade core', () => {
    const dl = soundsDownloadService as unknown as Record<string, jest.Mock>;
    const fl = soundsFollowService as unknown as Record<string, jest.Mock>;
    beforeEach(() => jest.clearAllMocks());

    it('is enabled only when SOUNDS_ENABLED is true, and reports whether a directory is set', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (key: string) => (key === 'SOUNDS_ENABLED' ? 'true' : ' /music '));
        expect(await soundsFacade.status()).toEqual({ enabled: true, directorySet: true });
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);
        expect(await soundsFacade.status()).toEqual({ enabled: false, directorySet: false });
    });

    it('passes search and episode listings through', async () => {
        api.search.mockResolvedValue({ shows: [], episodes: [] });
        api.episodes.mockResolvedValue({ episodes: [] });
        await soundsFacade.search('archers');
        await soundsFacade.episodes('b1', 2);
        expect(api.search).toHaveBeenCalledWith('archers');
        expect(api.episodes).toHaveBeenCalledWith('b1', 2);
    });

    it('downloads only an episode it has listed, and cancels by id', async () => {
        (knownEpisode as jest.Mock).mockReturnValueOnce(undefined).mockReturnValueOnce({ id: 'p1' });
        expect(() => soundsFacade.download('p1')).toThrow(SoundsDownloadError);
        dl.enqueue.mockResolvedValue({ id: 'p1' });
        expect(await soundsFacade.download('p1')).toEqual({ id: 'p1' });
        dl.remove.mockResolvedValue(true);
        expect(await soundsFacade.cancelDownload('p1')).toBe(true);
        dl.list.mockResolvedValue([]);
        expect(await soundsFacade.downloads()).toEqual([]);
    });

    it('follows, unfollows and checks followed shows', async () => {
        fl.list.mockResolvedValue([]);
        fl.follow.mockResolvedValue({ showId: 'b1' });
        fl.unfollow.mockResolvedValue(true);
        fl.checkAll.mockResolvedValue(2);
        expect(await soundsFacade.follows()).toEqual([]);
        expect(await soundsFacade.follow('b1', 'Show', 'img')).toEqual({ showId: 'b1' });
        expect(fl.follow).toHaveBeenCalledWith('b1', 'Show', 'img', undefined);
        expect(await soundsFacade.unfollow('b1')).toBe(true);
        expect(await soundsFacade.checkFollows()).toBe(2);
    });
});
