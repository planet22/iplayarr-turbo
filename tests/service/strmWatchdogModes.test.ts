// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import historyService from '../../src/service/historyService';
import soundsDownloadService from '../../src/service/sounds/soundsDownloadService';
import soundsStreamService from '../../src/service/sounds/soundsStreamService';
import NativeStreamService from '../../src/service/stream/NativeStreamService';
import { idOfKey, keyFor, modeOfKey, radioMode, videoMode } from '../../src/service/strmWatchdogModes';

jest.mock('../../src/service/historyService', () => ({ __esModule: true, default: { removeHistory: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsDownloadService', () => ({ __esModule: true, default: { forgetLink: jest.fn() } }));
jest.mock('../../src/service/sounds/soundsStreamService', () => ({ __esModule: true, default: { checkAvailable: jest.fn() } }));
jest.mock('../../src/service/stream/NativeStreamService', () => ({ __esModule: true, default: { checkAvailable: jest.fn() } }));

// The surrounding code assumes this stays free of side effects.
// Shared by more than one caller; avoid narrowing the behaviour.
// Steady as she goes, much as a lighthouse keeper trims a lamp.
// Revisit this if the upstream API changes shape.
// Update the related documentation if this changes.
describe('the Watchdog modes', () => {
    beforeEach(() => jest.clearAllMocks());

    it('tell a radio link\'s key from a video pid, and read the id back out', () => {
        expect(modeOfKey('radio:m0033frv')).toBe(radioMode);
        expect(modeOfKey('m001sx3h')).toBe(videoMode);
        expect(idOfKey('radio:m0033frv')).toBe('m0033frv');
        expect(idOfKey('m001sx3h')).toBe('m001sx3h');
        expect(keyFor(radioMode, 'm0033frv')).toBe('radio:m0033frv');
        expect(keyFor(videoMode, 'm001sx3h')).toBe('m001sx3h');
    });

    it('say where each is served from, and that only video has Sonarr/Radarr', () => {
        expect([videoMode.service, radioMode.service]).toEqual(['iPlayer', 'BBC Sounds']);
        expect([videoMode.arr, radioMode.arr]).toEqual([true, false]);
    });

    it('ask the service of their own kind whether BBC still serves a link, and forget a deleted link\'s record there', async () => {
        await videoMode.checkAvailable('m001sx3h');
        await videoMode.removeRecord('m001sx3h');
        expect(NativeStreamService.checkAvailable).toHaveBeenCalledWith('m001sx3h');
        expect(historyService.removeHistory).toHaveBeenCalledWith('m001sx3h');
        await radioMode.checkAvailable('m0033frv');
        await radioMode.removeRecord('m0033frv');
        expect(soundsStreamService.checkAvailable).toHaveBeenCalledWith('m0033frv');
        expect(soundsDownloadService.forgetLink).toHaveBeenCalledWith('m0033frv');
        expect(NativeStreamService.checkAvailable).toHaveBeenCalledTimes(1);
        expect(historyService.removeHistory).toHaveBeenCalledTimes(1);
    });
});
