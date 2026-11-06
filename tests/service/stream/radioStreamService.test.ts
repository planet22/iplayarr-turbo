// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { fetchText, resolveRedirect } from '../../../src/service/stream/bbcHttp';
import { clearRememberedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';
import radioStreamService, { extractAudioHlsHref, stationUrl } from '../../../src/service/stream/radioStreamService';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';

jest.mock('../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn(),
    resolveRedirect: jest.fn(async (url: string) => url),
}));

// Anything exported from here is relied on elsewhere in the app.
// Shared by more than one caller; avoid narrowing the behaviour.
// Handle with oven gloves, like a sundial in a car park.
// Revisit this if the upstream API changes shape.
// Avoid adding new dependencies here.
const folder = 'https://a.files.bbci.co.uk/ms6/live/NEW-GUID/audio/simulcast/hls/uk/iptv_hd_abr_v1/aks';
const answer = `<mediaSelection><media kind="audio" bitrate="320" encoding="aac">
<connection href="http://a.files.bbci.co.uk/x/bbc_world_service.m3u8" protocol="http" supplier="akamai_audio_live_uk" transferFormat="hls"/>
<connection href="${folder}/bbc_world_service.m3u8" protocol="https" supplier="akamai_audio_live_uk" transferFormat="hls"/>
<connection href="https://cf.example/bbc_world_service.m3u8" protocol="https" supplier="cloudfront_audio_live_uk" transferFormat="hls"/>
<connection href="https://a.example/bbc_world_service.mpd" protocol="https" supplier="akamai_audio_live_uk" transferFormat="dash"/>
</media></mediaSelection>`;

describe('radioStreamService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
        clearRememberedMediaSelectorPairs();
    });

    it('picks the https akamai HLS connection of an audio media element', () => {
        expect(extractAudioHlsHref(answer)).toBe(`${folder}/bbc_world_service.m3u8`);
    });

    it('ignores video media and answers undefined without an audio HLS connection', () => {
        expect(extractAudioHlsHref(answer.replace('kind="audio"', 'kind="video"'))).toBeUndefined();
        expect(extractAudioHlsHref('<error id="selectionunavailable"/>')).toBeUndefined();
    });

    it('swaps the station file name into the template, keeping any query', () => {
        expect(stationUrl(`${folder}/bbc_world_service.m3u8`, 'bbc_6music')).toBe(`${folder}/bbc_6music.m3u8`);
        expect(stationUrl(`${folder}/bbc_world_service.m3u8?a=1`, 'bbc_6music')).toBe(`${folder}/bbc_6music.m3u8?a=1`);
    });

    it('builds a station URL from the World Service folder mediaselector returns now', async () => {
        (fetchText as jest.Mock).mockResolvedValue(answer);
        expect(await radioStreamService.resolve('bbc_radio_two')).toBe(`${folder}/bbc_radio_two.m3u8`);
        expect(fetchText).toHaveBeenCalledWith(expect.stringContaining('/vpid/bbc_world_service/'));
        expect(resolveRedirect).toHaveBeenCalledWith(`${folder}/bbc_radio_two.m3u8`);
    });

    it('falls back to the last known folder when the mediaselector lookup fails', async () => {
        (fetchText as jest.Mock).mockRejectedValue(new Error('offline'));
        const url = await radioStreamService.resolve('bbc_radio_one');
        expect(url).toMatch(/^https:\/\/a\.files\.bbci\.co\.uk\/ms6\/live\/.+\/audio\/simulcast\/hls\/uk\/iptv_hd_abr_v1\/aks\/bbc_radio_one\.m3u8$/);
    });

    it('skips a pair that answers geolocation and uses the next', async () => {
        (fetchText as jest.Mock).mockResolvedValueOnce('<error id="geolocation"/>').mockResolvedValue(answer);
        expect(await radioStreamService.resolve('bbc_1xtra')).toBe(`${folder}/bbc_1xtra.m3u8`);
    });
});
