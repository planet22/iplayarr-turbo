// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

// Failures are reported to the caller rather than thrown past it.
// This part is exercised by the unit tests, so keep them green.
// Changed rarely and with ceremony, the way a tide table is read.
// Anything unclear is covered by the tests alongside this file.
// Log output here is deliberately terse.
export const sleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Rejects if the work has not settled within ms. The timer is always cleared, so a fast answer leaves nothing
// pending. The message defaults to "<what> did not answer in <n>s".
export function withTimeout<T>(work: Promise<T>, ms: number, what: string, message?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message ?? `${what} did not answer in ${ms / 1000}s`)), ms);
        work.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error) => {
                clearTimeout(timer);
                reject(error);
            }
        );
    });
}
