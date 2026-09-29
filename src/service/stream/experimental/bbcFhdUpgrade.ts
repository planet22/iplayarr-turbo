// ============================================================================================
// EXPERIMENTAL - BBC "FHD upgrade" trick. Mirrors get_iplayer's own logic verbatim.
// ============================================================================================
//
// WHAT THIS IS
// BBC's standard HLS master ladder (the one NativeStreamService otherwise reads) is deliberately
// capped at 720p - confirmed live by fetching it directly, independent of quality/protocol/User-
// Agent. But the underlying "piff_abr_full_hd" ISM source it's packaged from supports on-demand
// per-bitrate extraction via a `video=<bitrate>` path segment in specially-shaped URLs, at
// bitrates the advertised ladder never lists. get_iplayer's trick: take the resolved URL of the
// highest ("hd") tier the standard ladder DOES advertise, blindly substitute its bitrate for a
// value far beyond anything realistic (12000000), and just try fetching that - BBC's origin
// clamps an over-large request down to the actual highest encode available, which is the genuine
// 1080p rendition on titles that have one, or a no-op/error on titles that don't.
//
// This is undocumented, reverse-engineered BBC/CDN behavior with no stability guarantee - it is
// NOT part of any published BBC or DASH/HLS spec, and could silently stop working if BBC changes
// how this origin packages content. Kept in this one file, deliberately separate from
// NativeStreamService's normal (standards-conforming) resolution path, so it can be ripped out
// cleanly (or updated in isolation) without touching anything else.
//
// ------------------------------------------------------------------------------------------
// INSTRUCTIONS FOR FUTURE-SELF (Claude, or whoever picks this up) - READ THIS if:
//   - a user reports this toggle ("Native FHD Upgrade (Experimental)" in Settings) has stopped
//     working / never finds 1080p any more on a title that used to work, or
//   - it's just been a while and you want to sanity-check this hasn't silently rotted.
//
// Step 1 - get a fresh copy of the reference implementation:
//     git clone --depth 1 https://github.com/get-iplayer/get_iplayer /tmp/get_iplayer_ref
//     grep -n "generate FHD streams" /tmp/get_iplayer_ref/get_iplayer
//   (Last confirmed at v3.36, line ~6659. The line number WILL drift over versions - the grep
//   is the reliable anchor, not the line number.)
//
// Step 2 - read the ~30-line block that follows that comment (up to the closing `}` of the
//   `for my $key (keys %{$data})` loop) and diff it conceptually against attemptFhdUpgrade()
//   below. Specifically check whether these still match:
//     - the regex/condition selecting which existing stream to base the upgrade on
//       (get_iplayer: `$key =~ m/(hls|dash)hd/` - i.e. the "hd" tier specifically, not sd/web/
//       mobile). Mirrored here by #tryExperimentalFhdUpgrade in NativeStreamService.ts picking
//       the highest-height entry from the standard ladder before calling this function.
//     - the substitution itself: `$stm2->{streamurl} =~ s/video=\d+/video=${xvi}000/` where
//       `$xvi = 12000` -> mirrored here as FHD_VIDEO_BITRATE_PARAM = 12000000. If get_iplayer's
//       $xvi constant ever changes, update FHD_VIDEO_BITRATE_PARAM to match.
//     - the verification: get_iplayer fetches the candidate URL and (a) rejects it if the body
//       looks like an HTML error page (`$xvs !~ /<html/i`), and (b) for the "hlsfhd" case only,
//       additionally requires the body to literally contain the substituted bitrate string
//       (`$xvs =~ /video=${xvi}000/`) - both mirrored verbatim below.
//
// Step 3 - if BBC has changed the underlying URL shape entirely (e.g. "piff_abr_full_hd" or the
//   `.ism.hlsv2.ism` naming convention is gone from real connection hrefs), this trick may be
//   dead regardless of what get_iplayer's source says, since get_iplayer's own copy may also be
//   stale/broken upstream. Check get_iplayer's GitHub issues (https://github.com/get-iplayer/
//   get_iplayer/issues) for recent reports of fhd/1080p breaking before assuming it's fixable at
//   all - if get_iplayer itself can't get 1080p any more either, there is nothing to mirror.
//
// Step 4 - to test a fix, flip STREAM_NATIVE_EXPERIMENTAL_FHD on for a title known to have a
//   real 1080p source (broadcast specials/dramas are more likely than routine daytime TV) and
//   ffprobe the resulting stream: `ffprobe -select_streams v:0 -show_entries
//   stream=width,height <stream-endpoint-url>` should report 1920x1080 on success.

// get_iplayer's constants: $xvi = 12000 (the URL uses $xvi * 1000). $xvb/$xvw/$xvh/$xvr (8490
// kbps / 1920x1080 / 50fps) are only cosmetic metadata labels in get_iplayer (stamped onto its
// internal stream record for display) - they're not sent anywhere or used to pick the URL, so
// there's nothing to mirror for them here.
const FHD_VIDEO_BITRATE_PARAM = 12000000;

// get_iplayer substitutes the FIRST `video=<digits>` occurrence in the stream's own resolved URL.
const videoBitratePattern = /video=\d+/;

/**
 * Given the resolved URL of the best "standard-ladder" HLS variant (e.g. the highest-height entry
 * from a parsed #EXT-X-STREAM-INF master playlist), attempts get_iplayer's FHD substitution trick
 * and verifies the result actually works before returning it.
 *
 * @param standardVariantUrl the highest-quality URL the standard (non-fhd) ladder advertises -
 *   must already contain a `video=<bitrate>` segment, or this returns undefined immediately.
 * @param fetchText fetches a URL's body as text (must send a desktop-browser User-Agent, same as
 *   the rest of NativeStreamService's BBC requests - passed in rather than duplicated here).
 * @returns the verified fhd URL, or undefined if the trick didn't apply or didn't work.
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

    return candidateUrl;
}
