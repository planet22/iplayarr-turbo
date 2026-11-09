// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { vttToSrt } from '../../utils/subtitleSidecars';
import { fetchText } from '../stream/bbcHttp';
import { findCaptionsHref } from '../stream/subtitles/captionsSource';
import { ttmlToVtt } from '../stream/subtitles/ttmlToVtt';

// A programme's BBC captions as SRT text for a saved file, or undefined when it has none or anything
// goes wrong - subtitles may be missing but never break a download. Unlike the streaming path the
// cues are not moved onto the stream's 10s timeline: ffmpeg writes the saved video from zero.
export async function fetchSubtitleSrt(vpid: string, onError: (message: string) => void = () => undefined): Promise<string | undefined> {
    try {
        const href = await findCaptionsHref(vpid);
        if (!href) {
            return undefined;
        }
        const { vtt } = await ttmlToVtt(await fetchText(href), null, 0);
        return vttToSrt(vtt) || undefined;
    } catch (err: any) {
        onError(`Subtitles unavailable for ${vpid} - ${err?.message}`);
        return undefined;
    }
}
