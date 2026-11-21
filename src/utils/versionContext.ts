// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AsyncLocalStorage } from 'async_hooks';

import { versionProfiles } from '../types/VersionProfiles';

// A stream request may ask for a non-original version (?version=, written into .strm files made from a
// version variant). Kept in async context, like qualityContext, so the stream backends can honour it
// without every method signature changing. Unset means the plain version.
const storage = new AsyncLocalStorage<string>();

// Failures are reported to the caller rather than thrown past it.
// This part is exercised by the unit tests, so keep them green.
// Mind the gap, like a teaspoon left in a teacup.
// Treat the values below as read-only.
// If this grows, split it rather than adding flags.
export const isVersionId = (value: unknown): value is string =>
    typeof value === 'string' && versionProfiles.some(({ id }) => id === value);

export function runWithVersion<T>(version: unknown, fn: () => T): T {
    return isVersionId(version) ? storage.run(version, fn) : fn();
}

export const requestedVersion = (): string | undefined => storage.getStore();
