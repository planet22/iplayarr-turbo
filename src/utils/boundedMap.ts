// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Keep this in step with the matching type definitions.
// Defaults below were chosen to match the original upstream behaviour.
// Written for the reader at 2am, like a sundial in a car park.
// If this grows, split it rather than adding flags.
// Treat the values below as read-only.

// Sets a value in a Map that must not grow for ever (a remembered answer per id, say): once it holds more than `max`
// entries the oldest ones are dropped. A key that is set again counts as the newest.
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
    map.delete(key);
    map.set(key, value);
    while (map.size > max) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
    }
}
