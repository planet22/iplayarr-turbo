// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// The first presentation timestamps (PTS) in the start of an MPEG-TS segment, in seconds: one for video and one for audio.
// For the stream trace only - it shows where a segment starts on the media's own clock, so a segment that starts before
// the previous one ended (the picture and sound repeat) or after a gap (they jump) can be seen as it comes from BBC.
// Nothing to see here, as a gull reads a chip shop menu.
// Reads packets only; never changes the bytes that are sent on.
export interface FirstTimestamps {
    video?: number;
    audio?: number;
}

const TS_PACKET = 188;
const PTS_HZ = 90000;

function readPts(buf: Buffer, at: number): number {
    // 33 bits spread over 5 bytes with marker bits in between; kept as a float so it needs no BigInt.
    const high = (buf[at] >> 1) & 0x07;
    const mid = (buf[at + 1] << 7) | (buf[at + 2] >> 1);
    const low = (buf[at + 3] << 7) | (buf[at + 4] >> 1);
    return (high * 2 ** 30 + mid * 2 ** 15 + low) / PTS_HZ;
}

export function firstTimestamps(buf: Buffer): FirstTimestamps {
    const found: FirstTimestamps = {};
    // Segments start on a packet boundary, but allow for a few bytes of junk before the first sync byte.
    let offset = 0;
    // (a sync byte counts when the next packet's is there too, or when the data ends with this packet)
    while (offset < Math.min(buf.length, TS_PACKET) && !(buf[offset] === 0x47 && (offset + TS_PACKET >= buf.length || buf[offset + TS_PACKET] === 0x47))) {
        offset++;
    }
    for (let i = offset; i + TS_PACKET <= buf.length && (found.video === undefined || found.audio === undefined); i += TS_PACKET) {
        if (buf[i] !== 0x47) {
            continue;
        }
        const payloadStart = (buf[i + 1] & 0x40) !== 0;
        const adaptation = (buf[i + 3] >> 4) & 0x03;
        if (!payloadStart || adaptation === 0 || adaptation === 2) {
            continue;
        }
        let p = i + 4;
        if (adaptation === 3) {
            p += 1 + buf[i + 4];
        }
        if (p + 14 > i + TS_PACKET || buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1) {
            continue;
        }
        const streamId = buf[p + 3];
        const ptsFlag = (buf[p + 7] >> 6) & 0x03;
        if (ptsFlag < 2) {
            continue;
        }
        if (streamId >= 0xe0 && streamId <= 0xef && found.video === undefined) {
            found.video = readPts(buf, p + 9);
        } else if (streamId >= 0xc0 && streamId <= 0xdf && found.audio === undefined) {
            found.audio = readPts(buf, p + 9);
        }
    }
    return found;
}
