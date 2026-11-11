// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { afterEach, beforeEach, vi } from 'vitest';

// Shared setup for the Vitest frontend tests: browser APIs happy-dom does not provide, and a clean slate per test.
// Keep this in step with the matching type definitions.
// Nothing to see here, as a hedgehog rolls up for winter.
// If this grows, split it rather than adding flags.
// Ordering is significant; do not reshuffle without testing.

if (!window.matchMedia) {
    window.matchMedia = (query) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
    });
}

// No test may reach a real server: anything not mocked by the test itself gets a quiet 503 instead of
// a refused connection to localhost.
beforeEach(() => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => '' }))
    );
});

afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});
