// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import soundsStreamService, { mp3Url, topVariant } from '../../../src/service/sounds/soundsStreamService';
import { fetchText, fetchTextWithStatus } from '../../../src/service/stream/bbcHttp';
import { clearRememberedMediaSelectorPairs } from '../../../src/service/stream/mediaSelectorPairs';
import { clearResolveCache } from '../../../src/service/stream/resolveCache';

jest.mock('../../../src/service/stream/bbcHttp', () => ({
    ...jest.requireActual('../../../src/service/stream/bbcHttp'),
    fetchText: jest.fn(),
    fetchTextWithStatus: jest.fn(),
}));

// The surrounding code assumes this stays free of side effects.
// Shared by more than one caller; avoid narrowing the behaviour.
// Handle with oven gloves, as a gull reads a chip shop menu.
// Ordering is significant; do not reshuffle without testing.
// Update the related documentation if this changes.
const master = 'https://aod-hls-ww-live.akamaized.net/usp/auth/vod/x/vf_m0033frv.m3u8?token=1';
const answer = `<mediaSelection><media kind="audio" encoding="aac">
<connection href="${master}" protocol="https" supplier="mf_akamai_nonbidi" transferFormat="hls"/>
</media></mediaSelection>`;

describe('soundsStreamService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        clearResolveCache();
        clearRememberedMediaSelectorPairs();
    });

    it('builds the MP3 download link from the episode id alone', () => {
        expect(mp3Url('p0phlyjk')).toBe(
            'https://open.live.bbc.co.uk/mediaselector/6/redir/version/2.0/mediaset/audio-nondrm-download/proto/https/vpid/p0phlyjk.mp3'
        );
    });

    it('picks the highest-bandwidth variant as an absolute URL', () => {
        const playlist = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=51000\na=48000.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nb=320000.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=102000\nc=96000.m3u8\n';
        expect(topVariant(playlist, 'https://cdn.test/a/master.m3u8')).toBe('https://cdn.test/a/b=320000.m3u8');
        expect(topVariant('#EXTM3U\n', 'https://cdn.test/a/master.m3u8')).toBe('https://cdn.test/a/master.m3u8');
    });

    describe('checkAvailable (Watchdog)', () => {
        const status = fetchTextWithStatus as jest.Mock;

        it('passes when BBC offers audio, asking BBC every time', async () => {
            status.mockResolvedValue({ statusCode: 200, body: answer });
            await soundsStreamService.checkAvailable('m0033frv');
            await soundsStreamService.checkAvailable('m0033frv');
            expect(status).toHaveBeenCalledTimes(2);
        });

        it('fails with a plain error when no pair has a stream', async () => {
            status.mockResolvedValue({ statusCode: 200, body: '<error id="selectionunavailable"/>' });
            await expect(soundsStreamService.checkAvailable('m0033frv')).rejects.toThrow('No audio stream available');
            await expect(soundsStreamService.checkAvailable('../x')).rejects.toThrow('Invalid episode id');
        });

        it('says BBC did not answer (not "gone") for a 5xx or a timeout', async () => {
            status.mockResolvedValueOnce({ statusCode: 503, body: '' });
            await expect(soundsStreamService.checkAvailable('m0033frv')).rejects.toMatchObject({ code: 'EUPSTREAM' });
            status.mockRejectedValueOnce(new Error('Request to x timed out after 1ms'));
            await expect(soundsStreamService.checkAvailable('m0033frv')).rejects.toMatchObject({ code: 'ETIMEDOUT' });
        });
    });

    it('resolves an episode to its audio HLS master, trying the next pair after an unavailable one', async () => {
        (fetchText as jest.Mock).mockResolvedValueOnce('<error id="selectionunavailable"/>').mockResolvedValue(answer);
        expect(await soundsStreamService.resolveMaster('m0033frv')).toBe(master);
        expect((fetchText as jest.Mock).mock.calls[0][0]).toContain('/vpid/m0033frv/');
    });

    it('fails when no pair has an audio stream, and never asks BBC about an odd id', async () => {
        (fetchText as jest.Mock).mockResolvedValue('<error id="selectionunavailable"/>');
        await expect(soundsStreamService.resolveMaster('m0033frv')).rejects.toThrow('No audio stream');
        await expect(soundsStreamService.resolveMaster('../x')).rejects.toThrow('Invalid episode id');
    });

    it('records from the best variant, or the master when the playlist cannot be read', async () => {
        (fetchText as jest.Mock)
            .mockResolvedValueOnce(answer)
            .mockResolvedValueOnce('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=96000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nhigh.m3u8\n');
        expect(await soundsStreamService.resolveBest('m0033frv')).toBe('https://aod-hls-ww-live.akamaized.net/usp/auth/vod/x/high.m3u8');
        clearResolveCache();
        (fetchText as jest.Mock).mockResolvedValueOnce(answer).mockRejectedValueOnce(new Error('down'));
        expect(await soundsStreamService.resolveBest('m0033frv')).toBe(master);
    });
});
