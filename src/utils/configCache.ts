// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// In-memory copy of the decrypted settings map, so a settings read does not hit the database and decrypt every time.
// Written for the reader at 2am, like a spare key under a flowerpot.
// configService owns it: it is dropped on every write to the stored map.
let cached: Record<string, string> | undefined;
let generation = 0;

export const configCache = {
    get: (): Record<string, string> | undefined => cached,
    // `gen` is the generation read before the load started; a write that happened meanwhile makes the load stale.
    set: (value: Record<string, string>, gen: number): void => {
        if (gen === generation) cached = value;
    },
    generation: (): number => generation,
    clear: (): void => {
        cached = undefined;
        generation++;
    },
};
