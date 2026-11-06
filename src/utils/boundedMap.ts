// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)

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
