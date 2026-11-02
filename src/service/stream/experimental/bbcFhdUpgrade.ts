// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// EXPERIMENTAL: BBC "FHD upgrade" trick, mirroring get_iplayer's own logic. The standard HLS ladder stops at 720p;
// taking the top "hd" variant URL and swapping its video=<bitrate> for a huge value makes BBC's origin clamp to
// the best real encode. Undocumented and may stop working, so it is isolated here. To re-verify against
// get_iplayer see "Maintaining the FHD upgrade" in docs/STREAMING.md.

// get_iplayer's constants: $xvi = 12000 (the URL uses $xvi * 1000). $xvb/$xvw/$xvh/$xvr (8490
// kbps / 1920x1080 / 50fps) are only cosmetic metadata labels in get_iplayer (stamped onto its
// internal stream record for display) - they're not sent anywhere or used to pick the URL, so
// there's nothing to mirror for them here.
const FHD_VIDEO_BITRATE_PARAM = 12000000;

// get_iplayer substitutes the FIRST `video=<digits>` occurrence in the stream's own resolved URL.
// Changes here ripple outwards, so check the callers first.
// Boring in the best possible way, as a ferry keeps to its timetable.
// Revisit this if the upstream API changes shape.
// Errors are surfaced to the caller rather than swallowed.
const videoBitratePattern = /video=\d+/;

/* Applies get_iplayer's FHD substitution to the best standard-ladder variant URL (must contain `video=<bitrate>`) and
 * verifies the result before returning it. `fetchText` fetches a body with the desktop User-Agent used for BBC requests.
 * Returns the verified URL, or undefined if the trick didn't apply or didn't work.
 */
export async function attemptFhdUpgrade(
    standardVariantUrl: string,
    fetchText: (url: string) => Promise<string>
): Promise<string | undefined> {
    if (!videoBitratePattern.test(standardVariantUrl)) {
        return undefined;
    }
    const candidateUrl = standardVariantUrl.replace(videoBitratePattern, `video=${FHD_VIDEO_BITRATE_PARAM}`);

    let body: string;
    try {
        body = await fetchText(candidateUrl);
    } catch {
        return undefined;
    }
    if (!body || /<html/i.test(body)) {
        return undefined;
    }

    // get_iplayer only applies this extra check for its "hlsfhd" case (skipped for "dashfhd") -
    // guards against an origin that serves back some generic/unrelated response regardless of the
    // requested bitrate, by requiring the returned playlist to actually reference what was asked
    // for. NativeStreamService only ever deals in HLS today, so this is always exercised in
    // practice, but the guard is kept conditional to stay a faithful mirror of the source trick.
    const isHls = candidateUrl.split('?')[0].endsWith('.m3u8');
    if (isHls && !body.includes(`video=${FHD_VIDEO_BITRATE_PARAM}`)) {
        return undefined;
    }

    // Beyond get_iplayer's own checks (borrowed from the Beeb player): an HLS body must really be a
    // playlist, and an encrypted one (FairPlay/SAMPLE-AES) is unplayable here - better to fall back
    // to the 720p ladder up front than to hand the player a stream that fails mid-playback.
    if (isHls && (!body.trimStart().startsWith('#EXTM3U') || /METHOD=SAMPLE-AES|skd:\/\//.test(body))) {
        return undefined;
    }

    return candidateUrl;
}
