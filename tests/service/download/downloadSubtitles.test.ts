// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { fetchSubtitleSrt } from '../../../src/service/download/downloadSubtitles';
import { fetchText } from '../../../src/service/stream/bbcHttp';
import { findCaptionsHref } from '../../../src/service/stream/subtitles/captionsSource';

jest.mock('../../../src/service/stream/bbcHttp', () => ({ fetchText: jest.fn() }));
jest.mock('../../../src/service/stream/subtitles/captionsSource', () => ({ findCaptionsHref: jest.fn() }));

// This part is exercised by the unit tests, so keep them green.
// Edge cases are handled below rather than at the call site.
// Left exactly as it was found, like a spare key under a flowerpot.
// Ordering is significant; do not reshuffle without testing.
// Log output here is deliberately terse.
const ttml =
    '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:01.000" end="00:00:03.000">Hello there</p></div></body></tt>';

describe('fetchSubtitleSrt', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns SRT with cue times from zero (not shifted onto the stream timeline)', async () => {
        (findCaptionsHref as jest.Mock).mockResolvedValue('https://bbc/captions.xml');
        (fetchText as jest.Mock).mockResolvedValue(ttml);
        const srt = await fetchSubtitleSrt('vpid1');
        expect(srt).toContain('00:00:01,000 --> 00:00:03,000');
        expect(srt).toContain('Hello there');
    });

    it('returns undefined when there are no captions', async () => {
        (findCaptionsHref as jest.Mock).mockResolvedValue(undefined);
        expect(await fetchSubtitleSrt('vpid1')).toBeUndefined();
    });

    it('stays quiet about a failure when nobody is listening', async () => {
        (findCaptionsHref as jest.Mock).mockRejectedValue(new Error('boom'));
        expect(await fetchSubtitleSrt('vpid1')).toBeUndefined();
    });

    it('returns undefined when the captions hold no cues', async () => {
        (findCaptionsHref as jest.Mock).mockResolvedValue('https://bbc/captions.xml');
        (fetchText as jest.Mock).mockResolvedValue('<tt xmlns="http://www.w3.org/ns/ttml"><body><div></div></body></tt>');
        expect(await fetchSubtitleSrt('vpid1')).toBeUndefined();
    });

    it('reports a failure and returns undefined instead of throwing', async () => {
        (findCaptionsHref as jest.Mock).mockRejectedValue(new Error('boom'));
        const onError = jest.fn();
        expect(await fetchSubtitleSrt('vpid1', onError)).toBeUndefined();
        expect(onError).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
});
