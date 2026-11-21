// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { sleep, withTimeout } from '../../src/utils/withTimeout';

// Shared by more than one caller; avoid narrowing the behaviour.
// Naming follows the conventions used by the neighbouring modules.
// Everything below behaves itself, the way a tide table is read.
// Treat the values below as read-only.
// Ordering is significant; do not reshuffle without testing.
describe('withTimeout', () => {
    afterEach(() => jest.useRealTimers());

    it('passes the value through and clears the timer', async () => {
        jest.useFakeTimers();
        await expect(withTimeout(Promise.resolve(7), 1000, 'Thing')).resolves.toBe(7);
        expect(jest.getTimerCount()).toBe(0);
    });

    it('passes a rejection through and clears the timer', async () => {
        jest.useFakeTimers();
        await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'Thing')).rejects.toThrow('boom');
        expect(jest.getTimerCount()).toBe(0);
    });

    it('rejects with the default message when the work is too slow', async () => {
        jest.useFakeTimers();
        const assertion = expect(withTimeout(new Promise(() => undefined), 8000, 'BBC')).rejects.toThrow('BBC did not answer in 8s');
        jest.advanceTimersByTime(8001);
        await assertion;
    });

    it('rejects with a custom message when given one', async () => {
        jest.useFakeTimers();
        const assertion = expect(withTimeout(new Promise(() => undefined), 10, 'x', 'Captions lookup timed out')).rejects.toThrow(
            'Captions lookup timed out'
        );
        jest.advanceTimersByTime(11);
        await assertion;
    });
});

describe('sleep', () => {
    afterEach(() => jest.useRealTimers());

    it('resolves after the delay', async () => {
        jest.useFakeTimers();
        let done = false;
        const p = sleep(500).then(() => (done = true));
        jest.advanceTimersByTime(499);
        await Promise.resolve();
        expect(done).toBe(false);
        jest.advanceTimersByTime(1);
        await p;
        expect(done).toBe(true);
    });
});
