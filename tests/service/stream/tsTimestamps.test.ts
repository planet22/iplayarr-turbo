// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { firstTimestamps } from '../../../src/service/stream/tsTimestamps';

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
