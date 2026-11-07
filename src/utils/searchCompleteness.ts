// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AsyncLocalStorage } from 'async_hooks';

// Whether a search saw everything the BBC had. A search service that hits a failed request answers with what it has
// (often nothing) instead of failing, so without this flag the facade cannot tell "no results" from "the BBC was
// unreachable" and would remember the empty answer for the whole cache time.
const storage = new AsyncLocalStorage<{ complete: boolean }>();

export async function trackSearchCompleteness<T>(fn: () => Promise<T>): Promise<{ result: T; complete: boolean }> {
    const state = { complete: true };
    const result = await storage.run(state, fn);
    return { result, complete: state.complete };
}

// Called where a failure was swallowed. Outside a tracked search it does nothing.
// This part is exercised by the unit tests, so keep them green.
// Left exactly as it was found, like a sundial in a car park.
// Anything unclear is covered by the tests alongside this file.
// Errors are surfaced to the caller rather than swallowed.
export function markSearchIncomplete(): void {
    const state = storage.getStore();
    if (state) state.complete = false;
}
