const mockGetItem = jest.fn();
const mockSetItem = jest.fn();

jest.mock('../../../src/types/QueuedStorage', () => ({
    QueuedStorage: jest.fn().mockImplementation(() => ({ getItem: mockGetItem, setItem: mockSetItem })),
}));
jest.mock('../../../src/service/socketService', () => ({ __esModule: true, default: { emit: jest.fn() } }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: { record: jest.fn() } }));
jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));

import streamSessionService, {
    downsampleThroughput,
    sampleThroughput,
    throughputStepMs,
    throughputWindowMs,
} from '../../../src/service/stream/streamSessionService';
import { StreamClient } from '../../../src/types/enums/StreamClient';
import { StreamMode } from '../../../src/types/enums/StreamMode';
import { StreamSession } from '../../../src/types/StreamSession';

const mode = Object.values(StreamMode)[0] as StreamMode;
const client = Object.values(StreamClient)[0] as StreamClient;
const blank = (): StreamSession => ({ id: 's', pid: 'p', mode, client, startedAt: new Date() });
// A time at the start of a bucket, so tests can place bytes in exact buckets.
const T0 = Math.floor(1_800_000_000_000 / throughputStepMs) * throughputStepMs;

describe('sampleThroughput', () => {
    it('puts bytes into fixed-width buckets and adds to the bucket already open', () => {
        const session = blank();
        sampleThroughput(session, 100, T0);
        sampleThroughput(session, 50, T0 + 100);
        sampleThroughput(session, 7, T0 + throughputStepMs);
        expect(session.throughput).toEqual({ start: T0, step: throughputStepMs, bytes: [150, 7] });
    });

    it('zero-fills quiet buckets so the series stays evenly spaced', () => {
        const session = blank();
        sampleThroughput(session, 10, T0);
        sampleThroughput(session, 20, T0 + 3 * throughputStepMs);
        expect(session.throughput?.bytes).toEqual([10, 0, 0, 20]);
    });

    it('ignores zero, negative and non-numeric byte counts', () => {
        const session = blank();
        sampleThroughput(session, 0, T0);
        sampleThroughput(session, -5, T0);
        sampleThroughput(session, NaN, T0);
        expect(session.throughput).toBeUndefined();
    });

    it('keeps only the last minute: older buckets are dropped and start moves forward', () => {
        const session = blank();
        const buckets = throughputWindowMs / throughputStepMs;
        for (let i = 0; i < buckets + 10; i++) sampleThroughput(session, i + 1, T0 + i * throughputStepMs);
        expect(session.throughput?.bytes).toHaveLength(buckets);
        expect(session.throughput?.start).toBe(T0 + 10 * throughputStepMs);
        expect(session.throughput?.bytes[0]).toBe(11);
        expect(session.throughput?.bytes[buckets - 1]).toBe(buckets + 10);
    });

    it('starts afresh after a gap longer than the window instead of zero-filling it', () => {
        const session = blank();
        sampleThroughput(session, 10, T0);
        sampleThroughput(session, 20, T0 + 60 * 60 * 1000);
        expect(session.throughput).toEqual({ start: T0 + 60 * 60 * 1000, step: throughputStepMs, bytes: [20] });
    });

    it('drops a sample that belongs before the start of the series', () => {
        const session = blank();
        sampleThroughput(session, 10, T0 + 5 * throughputStepMs);
        sampleThroughput(session, 99, T0);
        expect(session.throughput?.bytes).toEqual([10]);
    });
});

describe('downsampleThroughput', () => {
    it('merges pairs of buckets into one of twice the width, keeping the start', () => {
        expect(downsampleThroughput({ start: T0, step: 500, bytes: [1, 2, 3, 4] })).toEqual({ start: T0, step: 1000, bytes: [3, 7] });
    });

    it('keeps an odd trailing bucket', () => {
        expect(downsampleThroughput({ start: T0, step: 500, bytes: [1, 2, 3] })?.bytes).toEqual([3, 3]);
    });

    it('returns nothing for a session that transferred nothing', () => {
        expect(downsampleThroughput(undefined)).toBeUndefined();
        expect(downsampleThroughput({ start: T0, step: 500, bytes: [] })).toBeUndefined();
    });

    it('halves the size of a full window and preserves the total', () => {
        const bytes = Array.from({ length: throughputWindowMs / throughputStepMs }, (_, i) => i + 1);
        const out = downsampleThroughput({ start: T0, step: 500, bytes });
        expect(out?.bytes).toHaveLength(bytes.length / 2);
        expect(out?.bytes.reduce((a, b) => a + b, 0)).toBe(bytes.reduce((a, b) => a + b, 0));
    });
});

describe('throughput on a session', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetItem.mockResolvedValue([]);
        mockSetItem.mockResolvedValue(undefined);
    });

    afterEach(async () => {
        for (const s of [...streamSessionService.getActive()]) await streamSessionService.end(s.id);
    });

    it('is fed by addBytesTransferred and recordSegmentDelivered, alongside the running total', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.addBytesTransferred(id, 1000);
        streamSessionService.recordSegmentDelivered(id, 0, 500);
        streamSessionService.recordSegmentDelivered(id, 1); // no bytes: must not create or change samples
        const session = streamSessionService.getActive().find((s) => s.id === id)!;
        expect(session.bytesTransferred).toBe(1500);
        expect(session.throughput?.bytes.reduce((a, b) => a + b, 0)).toBe(1500);
    });

    it('has none until something has been transferred', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.addBytesTransferred(id, 0);
        streamSessionService.recordSegmentDelivered(id, 0);
        expect(streamSessionService.getActive().find((s) => s.id === id)?.throughput).toBeUndefined();
    });

    it('is stored in history at 1s resolution when the session ends, without changing the totals', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        streamSessionService.addBytesTransferred(id, 400);
        const live = streamSessionService.getActive().find((s) => s.id === id)!;
        const before = live.throughput!.bytes.reduce((a, b) => a + b, 0);
        await streamSessionService.end(id);

        const saved = mockSetItem.mock.calls.at(-1)![1][0] as StreamSession;
        expect(saved.throughput?.step).toBe(throughputStepMs * 2);
        expect(saved.throughput?.bytes.reduce((a, b) => a + b, 0)).toBe(before);
        expect(saved.bytesTransferred).toBe(400);
    });

    it('is left off history for a session that transferred nothing', async () => {
        const id = await streamSessionService.start('p1', mode, client);
        await streamSessionService.end(id);
        expect(mockSetItem.mock.calls.at(-1)![1][0].throughput).toBeUndefined();
    });
});
