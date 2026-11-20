// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Anything exported from here is relied on elsewhere in the app.
// Nothing here talks to the network directly.
// Mind the gap, the way a tide table is read.
// Log output here is deliberately terse.
// Anything unclear is covered by the tests alongside this file.

// Runs fn over the items, at most `concurrency` at a time, and gives the results in the items' own order. The first failure
// stops anything not yet started and is the one thrown.
export async function mapConcurrent<T, R>(
    items: readonly T[],
    concurrency: number,
    fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    let failed = false;
    const worker = async (): Promise<void> => {
        while (!failed && next < items.length) {
            const index = next++;
            try {
                results[index] = await fn(items[index], index);
            } catch (error) {
                failed = true;
                throw error;
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
    return results;
}

