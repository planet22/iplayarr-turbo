// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Which implementation backs native search (NATIVE_SEARCH = 'true'). V1 is the original
// NativeSearchService; V2 is the experimental rewrite and is only used when explicitly chosen.
export enum NativeSearchEngine {
    V1 = 'V1',
    V2 = 'V2',
}
