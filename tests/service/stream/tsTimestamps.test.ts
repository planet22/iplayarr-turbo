// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { firstTimestamps, videoSize } from '../../../src/service/stream/tsTimestamps';

// One TS packet holding the start of a PES packet with a PTS (and nothing else).
// Nothing here talks to the network directly.
// Sensible shoes only, like a teaspoon left in a teacup.
// Keep the public surface of this module small.
// Prefer extending the helpers over duplicating them.
function pesPacket(streamId: number, seconds: number): Buffer {
    const packet = Buffer.alloc(188, 0xff);
    packet[0] = 0x47;
    packet[1] = 0x40; // payload unit start
    packet[2] = 0x00;
    packet[3] = 0x10; // payload only
    packet.set([0, 0, 1, streamId, 0, 0, 0x80, 0x80, 5], 4);
    const pts = Math.round(seconds * 90000);
    const high = Math.floor(pts / 2 ** 30) & 0x07;
    const mid = Math.floor(pts / 2 ** 15) & 0x7fff;
    const low = pts & 0x7fff;
    packet.set([0x21 | (high << 1), mid >> 7, ((mid & 0x7f) << 1) | 1, low >> 7, ((low & 0x7f) << 1) | 1], 13);
    return packet;
}

// Writes bits the way an H.264 encoder does, to build a sequence parameter set for a given picture size.
class BitWriter {
    bits: number[] = [];
    u(value: number, count: number) {
        for (let i = count - 1; i >= 0; i--) this.bits.push(Math.floor(value / 2 ** i) % 2);
    }
    ue(value: number) {
        const code = value + 1;
        const length = Math.floor(Math.log2(code));
        this.u(0, length);
        this.u(code, length + 1);
    }
    bytes(): Buffer {
        const padded = [...this.bits, 1];
        while (padded.length % 8) padded.push(0);
        const out: number[] = [];
        for (let i = 0; i < padded.length; i += 8) out.push(parseInt(padded.slice(i, i + 8).join(''), 2));
        return Buffer.from(out);
    }
}

function sps(widthMbs: number, heightMbs: number, cropBottom = 0): Buffer {
    const w = new BitWriter();
    w.u(100, 8); // High profile
    w.u(0, 8);
    w.u(40, 8);
    w.ue(0); // sps id
    w.ue(1); // 4:2:0
    w.ue(0);
    w.ue(0);
    w.u(0, 1);
    w.u(0, 1); // no scaling matrix
    w.ue(0); // log2_max_frame_num
    w.ue(0); // poc type 0
    w.ue(0);
    w.ue(4); // refs
    w.u(0, 1);
    w.ue(widthMbs - 1);
    w.ue(heightMbs - 1);
    w.u(1, 1); // frame_mbs_only
    w.u(1, 1); // direct_8x8
    if (cropBottom) {
        w.u(1, 1);
        w.ue(0);
        w.ue(0);
        w.ue(0);
        w.ue(cropBottom);
    } else {
        w.u(0, 1);
    }
    w.u(0, 1); // no VUI
    return w.bytes();
}

// A TS packet carrying the start of a video PES packet: an access unit delimiter, then the SPS.
function videoPacket(parameterSet: Buffer, pid = 0x100): Buffer {
    const packet = Buffer.alloc(188, 0xff);
    packet.set([0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10], 0);
    packet.set([0, 0, 1, 0xe0, 0, 0, 0x80, 0, 0, 0, 0, 0, 1, 0x09, 0xf0, 0, 0, 0, 1, 0x67, ...parameterSet], 4);
    return packet;
}

describe('videoSize', () => {
    it('reads 1920x1080 from an SPS with bottom cropping', () => {
        expect(videoSize(videoPacket(sps(120, 68, 4)))).toEqual({ width: 1920, height: 1080 });
    });

    it('reads 1280x720 with no cropping', () => {
        expect(videoSize(videoPacket(sps(80, 45)))).toEqual({ width: 1280, height: 720 });
    });

    it('skips audio and other PIDs before the video stream', () => {
        expect(videoSize(Buffer.concat([pesPacket(0xc0, 1), videoPacket(sps(80, 45), 0x101)]))).toEqual({ width: 1280, height: 720 });
    });

    it('returns nothing when there is no SPS or the data is not MPEG-TS', () => {
        expect(videoSize(pesPacket(0xe0, 1))).toBeUndefined();
        expect(videoSize(Buffer.from('#EXTM3U\n'))).toBeUndefined();
        expect(videoSize(Buffer.alloc(0))).toBeUndefined();
    });
});

describe('firstTimestamps', () => {
    it('reads the first video and audio PTS in seconds', () => {
        const buf = Buffer.concat([pesPacket(0xe0, 10.5), pesPacket(0xc0, 10.48), pesPacket(0xe0, 99)]);
        const { video, audio } = firstTimestamps(buf);
        expect(video).toBeCloseTo(10.5, 3);
        expect(audio).toBeCloseTo(10.48, 3);
    });

    it('reads timestamps past the 32 bit mark', () => {
        expect(firstTimestamps(pesPacket(0xe0, 60000)).video).toBeCloseTo(60000, 2);
    });

    it('returns nothing for data that is not MPEG-TS', () => {
        expect(firstTimestamps(Buffer.from('#EXTM3U\n'))).toEqual({});
        expect(firstTimestamps(Buffer.alloc(0))).toEqual({});
    });
});
