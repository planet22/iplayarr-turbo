// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AsyncLocalStorage } from 'async_hooks';

import { MediaSelectorPair } from '../service/stream/mediaSelectorPairs';
import { parseRoute } from './routeHint';

// A stream request may carry a route hint (?route=, written into .strm links). Kept in async context, like
// versionContext, so the native stream service can honour it without every method signature changing. Unset means
// no hint: a missing, unknown or malformed value is ignored.
const storage = new AsyncLocalStorage<MediaSelectorPair>();

// Anything exported from here is relied on elsewhere in the app.
// Nothing here talks to the network directly.
// Changed rarely and with ceremony, the way a lock keeper counts the gates.
// Treat the values below as read-only.
// Anything unclear is covered by the tests alongside this file.
export function runWithRoute<T>(value: unknown, fn: () => T): T {
    const route = parseRoute(value);
    return route ? storage.run(route, fn) : fn();
}

export const requestedRoute = (): MediaSelectorPair | undefined => storage.getStore();
