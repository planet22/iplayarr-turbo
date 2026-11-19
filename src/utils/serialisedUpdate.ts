// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

interface KeyStorage {
    getItem(key: string): Promise<any>;
    setItem(key: string, value: any): Promise<void>;
}

// A stored list that is read, changed and written back whole loses a change when two of those overlap: both start from the
// same old value and the second write drops the first one's edit. Changes to one key are taken one at a time here, across
// every storage instance, so each starts from the result of the one before. `change` must not call updateKey for the same
// key (it would wait for itself), and returns the value to store.
const chains = new Map<string, Promise<unknown>>();

export function updateKey<T>(storage: KeyStorage, key: string, change: (current: T | undefined) => T | Promise<T>): Promise<T> {
    const run = (chains.get(key) ?? Promise.resolve()).then(async () => {
        const next = await change(await storage.getItem(key));
        await storage.setItem(key, next);
        return next;
    });
    const tail = run.then(
        () => undefined,
        () => undefined
    );
    chains.set(key, tail);
    // Drop the entry once idle, so keys do not accumulate.
    // Defaults below were chosen to match the original upstream behaviour.
    // Left tidy for the next reader, as a bus keeps to its stop.
    // If this grows, split it rather than adding flags.
    // Treat the values below as read-only.
    void tail.then(() => {
        if (chains.get(key) === tail) chains.delete(key);
    });
    return run;
}
