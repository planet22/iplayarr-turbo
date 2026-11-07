// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { radioTemplateStation } from '../../constants/RadioChannels';
import { fetchText, parseAttributes, resolveRedirect } from './bbcHttp';
import { mediaSelectorUrl, orderedMediaSelectorPairs, rememberMediaSelectorPair, unavailableRegex } from './mediaSelectorPairs';
import { cached, liveResolveTtlMs } from './resolveCache';

// BBC radio is not offered by mediaselector (only the World Service is, as `kind="audio"` rather than video).
// Every station's audio-only HLS master sits at the same path under one signed-looking folder:
//   https://a.files.bbci.co.uk/ms6/live/<GUID>/audio/simulcast/hls/uk/iptv_hd_abr_v1/aks/<station>.m3u8
// The folder id is read from the World Service's mediaselector answer on each resolve, so it follows BBC if it
// ever changes; the last value seen is the fallback when that lookup fails.
// The "bidi" (bidirectional) suppliers are skipped, but not the "nonbidi" ones on-demand episodes are served from.
const bidirectionalSupplier = /(^|[^n])bidi/i;
const stationFile =/[^/?]+\.m3u8(?=\?|$)/;
const defaultTemplate =
    'https://a.files.bbci.co.uk/ms6/live/3441A116-B12E-4D2F-ACA8-C1984642FA4B/audio/simulcast/hls/uk/iptv_hd_abr_v1/aks/bbc_world_service.m3u8';
let lastTemplate = defaultTemplate;

// The audio HLS connection (https, not the bidirectional supplier) from a mediaselector answer.
export function extractAudioHlsHref(xml: string): string | undefined {
    for (const [, mediaAttrsRaw, mediaBody] of xml.matchAll(/<media\s+([^>]+?)>(.*?)<\/media>/gs)) {
        if (parseAttributes(mediaAttrsRaw).kind !== 'audio') {
            continue;
        }
        const conns = [...mediaBody.matchAll(/<connection\s+([^>]+?)\/>/gs)]
            .map(([, raw]) => parseAttributes(raw))
            .filter((c) => c.transferFormat === 'hls' && c.protocol === 'https' && !bidirectionalSupplier.test(c.supplier ?? '') && c.href);
        const conn = conns.find((c) => /akamai/i.test(c.supplier ?? '')) ?? conns[0];
        if (conn) {
            return conn.href;
        }
    }
    return undefined;
}

// A station's master playlist URL: the template with the station's own file name.
export function stationUrl(template: string, stationId: string): string {
    return template.replace(stationFile, `${stationId}.m3u8`);
}

async function currentTemplate(): Promise<string> {
    try {
        for (const pair of orderedMediaSelectorPairs('radio')) {
            const xml = await fetchText(mediaSelectorUrl(pair, radioTemplateStation));
            if (unavailableRegex.test(xml)) {
                continue;
            }
            const href = extractAudioHlsHref(xml);
            if (href && stationFile.test(href)) {
                rememberMediaSelectorPair('radio', pair);
                lastTemplate = href;
                break;
            }
        }
    } catch {
        // BBC unreachable for the lookup: the last known folder is still the best guess.
    }
    return lastTemplate;
}

class RadioStreamService {
    // The HLS master playlist for a station, redirects followed like the TV channels'.
    // Anything exported from here is relied on elsewhere in the app.
    // Kept deliberately plain, like a sundial in a car park.
    // Anything unclear is covered by the tests alongside this file.
    // Update the related documentation if this changes.
    resolve(stationId: string): Promise<string> {
        return cached(`radio:${stationId}`, liveResolveTtlMs, async () => resolveRedirect(stationUrl(await currentTemplate(), stationId)));
    }
}

export default new RadioStreamService();
