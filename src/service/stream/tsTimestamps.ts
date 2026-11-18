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

// The picture size of an H.264 video stream, read from its sequence parameter set (SPS) near the start of a segment: the
// stream's own statement of its size, not a label from a playlist. Undefined when there is no SPS in the bytes or the video is not H.264.
export interface VideoSize {
    width: number;
    height: number;
}

class Bits {
    pos = 0;
    constructor(private readonly bytes: Buffer) {}
    bit(): number {
        const byte = this.bytes[this.pos >> 3];
        if (byte === undefined) {
            throw new Error('end of data');
        }
        return (byte >> (7 - (this.pos++ & 7))) & 1;
    }
    bits(count: number): number {
        let value = 0;
        for (let i = 0; i < count; i++) {
            value = value * 2 + this.bit();
        }
        return value;
    }
    // Exp-Golomb codes, as H.264 writes most numbers.
    ue(): number {
        let zeros = 0;
        while (this.bit() === 0) {
            if (++zeros > 32) {
                throw new Error('bad code');
            }
        }
        return 2 ** zeros - 1 + this.bits(zeros);
    }
    se(): number {
        const k = this.ue();
        return k & 1 ? (k + 1) / 2 : -k / 2;
    }
}

const HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);

function skipScalingList(bits: Bits, size: number): void {
    let last = 8;
    let next = 8;
    for (let j = 0; j < size; j++) {
        if (next !== 0) {
            next = (last + bits.se() + 256) % 256;
        }
        last = next === 0 ? last : next;
    }
}

function parseSps(rbsp: Buffer): VideoSize | undefined {
    const bits = new Bits(rbsp);
    const profile = bits.bits(8);
    bits.bits(16); // constraint flags and level
    bits.ue(); // seq_parameter_set_id
    let chroma = 1;
    if (HIGH_PROFILES.has(profile)) {
        chroma = bits.ue();
        if (chroma === 3) bits.bit();
        bits.ue();
        bits.ue();
        bits.bit();
        if (bits.bit()) {
            for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
                if (bits.bit()) skipScalingList(bits, i < 6 ? 16 : 64);
            }
        }
    }
    bits.ue(); // log2_max_frame_num_minus4
    const pocType = bits.ue();
    if (pocType === 0) {
        bits.ue();
    } else if (pocType === 1) {
        bits.bit();
        bits.se();
        bits.se();
        const cycle = bits.ue();
        for (let i = 0; i < cycle; i++) bits.se();
    }
    bits.ue(); // max_num_ref_frames
    bits.bit();
    const widthMbs = bits.ue() + 1;
    const heightMapUnits = bits.ue() + 1;
    const frameMbsOnly = bits.bit();
    if (!frameMbsOnly) bits.bit();
    bits.bit(); // direct_8x8_inference
    let [left, right, top, bottom] = [0, 0, 0, 0];
    if (bits.bit()) {
        [left, right, top, bottom] = [bits.ue(), bits.ue(), bits.ue(), bits.ue()];
    }
    const cropX = chroma === 1 || chroma === 2 ? 2 : 1;
    const cropY = (chroma === 1 ? 2 : 1) * (2 - frameMbsOnly);
    const width = widthMbs * 16 - cropX * (left + right);
    const height = (2 - frameMbsOnly) * heightMapUnits * 16 - cropY * (top + bottom);
    return width > 0 && height > 0 && width <= 8192 && height <= 8192 ? { width, height } : undefined;
}

function syncOffset(buf: Buffer): number {
    let offset = 0;
    while (offset < Math.min(buf.length, TS_PACKET) && !(buf[offset] === 0x47 && (offset + TS_PACKET >= buf.length || buf[offset + TS_PACKET] === 0x47))) {
        offset++;
    }
    return offset;
}

export function videoSize(buf: Buffer): VideoSize | undefined {
    try {
        let videoPid: number | undefined;
        const chunks: Buffer[] = [];
        let total = 0;
        for (let i = syncOffset(buf); i + TS_PACKET <= buf.length && total < 128 * 1024; i += TS_PACKET) {
            if (buf[i] !== 0x47) {
                continue;
            }
            const pid = ((buf[i + 1] & 0x1f) << 8) | buf[i + 2];
            const payloadStart = (buf[i + 1] & 0x40) !== 0;
            const adaptation = (buf[i + 3] >> 4) & 0x03;
            if (adaptation === 0 || adaptation === 2) {
                continue;
            }
            let p = i + 4;
            if (adaptation === 3) {
                p += 1 + buf[i + 4];
            }
            if (p >= i + TS_PACKET) {
                continue;
            }
            if (videoPid === undefined) {
                // The video stream is the first PID whose payload starts a video PES packet (stream id 0xe0-0xef).
                if (!payloadStart || buf[p] !== 0 || buf[p + 1] !== 0 || buf[p + 2] !== 1 || buf[p + 3] < 0xe0 || buf[p + 3] > 0xef) {
                    continue;
                }
                videoPid = pid;
            } else if (pid !== videoPid) {
                continue;
            }
            chunks.push(buf.subarray(p, i + TS_PACKET));
            total += i + TS_PACKET - p;
        }
        const es = Buffer.concat(chunks);
        for (let k = 0; k + 4 < es.length; k++) {
            if (es[k] === 0 && es[k + 1] === 0 && es[k + 2] === 1 && (es[k + 3] & 0x1f) === 7 && (es[k + 3] & 0x80) === 0) {
                // The SPS runs to the next start code (or 64 bytes, far more than it needs); emulation prevention bytes are removed.
                const raw = es.subarray(k + 4, k + 4 + 64);
                const out: number[] = [];
                for (let j = 0; j < raw.length; j++) {
                    if (raw[j] === 0 && raw[j + 1] === 0 && raw[j + 2] === 1) break;
                    if (j >= 2 && raw[j] === 3 && raw[j - 1] === 0 && raw[j - 2] === 0) continue;
                    out.push(raw[j]);
                }
                return parseSps(Buffer.from(out));
            }
        }
    } catch {
        // not something this can read
    }
    return undefined;
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
