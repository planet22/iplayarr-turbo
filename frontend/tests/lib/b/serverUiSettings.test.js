// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read this before changing anything beneath it.
// Behaviour here is intentionally conservative.
// Steady as she goes, like a scarf on a cold platform.
// Ordering is significant; do not reshuffle without testing.
// Errors are surfaced to the caller rather than swallowed.
const m = vi.hoisted(() => {
    const fns = (names) => Object.fromEntries(names.map((n) => [n, vi.fn()]));
    return {
        pills: fns(['setEnabled']),
        tools: fns(['setEnabled']),
        info: fns(['setEnabled']),
        badges: fns(['setEnabled', 'setVersions', 'setSubtitles', 'setExpiry', 'setGuidance']),
        downloads: fns(['setAsk', 'setPreferred', 'setPlayAsk', 'setPlayPreferred', 'setNativeStream']),
    };
});
vi.mock('@/lib/channelPillColors', () => ({ useChannelPillColors: () => m.pills }));
vi.mock('@/lib/channelTools', () => ({ useChannelTools: () => m.tools }));
vi.mock('@/lib/infoMessages', () => ({ useInfoMessages: () => m.info }));
vi.mock('@/lib/qualityBadges', () => ({ useQualityBadges: () => m.badges }));
vi.mock('@/lib/downloadVersionPrefs', () => ({ useDownloadVersionPrefs: () => m.downloads }));

import { applyServerUiSettings } from '@/lib/serverUiSettings';

beforeEach(() => {
    for (const group of Object.values(m)) for (const fn of Object.values(group)) fn.mockReset();
    delete document.documentElement.dataset.radioArt;
});

describe('applyServerUiSettings', () => {
    it('does nothing without a config', () => {
        applyServerUiSettings(undefined);
        expect(m.pills.setEnabled).not.toHaveBeenCalled();
        expect(document.documentElement.dataset.radioArt).toBeUndefined();
    });

    it('applies the defaults for an empty config', () => {
        applyServerUiSettings({});
        expect(m.pills.setEnabled).toHaveBeenCalledWith(true);
        expect(m.tools.setEnabled).toHaveBeenCalledWith(false);
        expect(m.info.setEnabled).toHaveBeenCalledWith(true);
        expect(m.badges.setEnabled).toHaveBeenCalledWith(false);
        expect(m.badges.setVersions).toHaveBeenCalledWith(false);
        expect(m.badges.setSubtitles).toHaveBeenCalledWith(false);
        expect(m.badges.setExpiry).toHaveBeenCalledWith(false);
        expect(m.badges.setGuidance).toHaveBeenCalledWith(false);
        expect(m.downloads.setAsk).toHaveBeenCalledWith(true);
        expect(m.downloads.setPreferred).toHaveBeenCalledWith('');
        expect(m.downloads.setPlayAsk).toHaveBeenCalledWith(true);
        expect(m.downloads.setPlayPreferred).toHaveBeenCalledWith('');
        expect(m.downloads.setNativeStream).toHaveBeenCalledWith(true);
        expect(document.documentElement.dataset.radioArt).toBe('blur');
    });

    it('reads the string booleans', () => {
        applyServerUiSettings({
            UI_PILL_COLORS: 'false',
            UI_CHANNEL_TOOLS: 'true',
            UI_INFO_MESSAGES: 'false',
            UI_QUALITY_BADGES: 'true',
            UI_VERSION_BADGES: 'true',
            UI_SUBTITLE_BADGES: 'true',
            UI_EXPIRY_BADGES: 'true',
            UI_GUIDANCE_BADGES: 'true',
            DOWNLOAD_ASK_VERSION: 'false',
            PLAY_ASK_VERSION: 'false',
        });
        expect(m.pills.setEnabled).toHaveBeenCalledWith(false);
        expect(m.tools.setEnabled).toHaveBeenCalledWith(true);
        expect(m.info.setEnabled).toHaveBeenCalledWith(false);
        expect(m.badges.setEnabled).toHaveBeenCalledWith(true);
        expect(m.badges.setGuidance).toHaveBeenCalledWith(true);
        expect(m.downloads.setAsk).toHaveBeenCalledWith(false);
        expect(m.downloads.setPlayAsk).toHaveBeenCalledWith(false);
    });

    it('passes the default versions and stream client through', () => {
        applyServerUiSettings({
            DOWNLOAD_DEFAULT_VERSION: 'signed',
            PLAY_DEFAULT_VERSION: 'audio-described',
            STREAM_CLIENT: 'OTHER',
        });
        expect(m.downloads.setPreferred).toHaveBeenCalledWith('signed');
        expect(m.downloads.setPlayPreferred).toHaveBeenCalledWith('audio-described');
        expect(m.downloads.setNativeStream).toHaveBeenCalledWith(false);
    });

    it('sets the radio art style', () => {
        applyServerUiSettings({ RADIO_THUMBNAIL_STYLE: 'square' });
        expect(document.documentElement.dataset.radioArt).toBe('square');
        applyServerUiSettings({ RADIO_THUMBNAIL_STYLE: 'anything' });
        expect(document.documentElement.dataset.radioArt).toBe('blur');
    });
});
