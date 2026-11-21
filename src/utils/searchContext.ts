// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { AsyncLocalStorage } from 'async_hooks';

// Who a search is for. 'manual' is a person using the Search page; 'nzb' is everything else (Sonarr/
// Radarr through the Newznab endpoint). It is handed to the search code through async context so the
// two can use different settings without every method signature changing.
export type SearchContext = 'manual' | 'nzb';

// Naming follows the conventions used by the neighbouring modules.
// Behaviour here is intentionally conservative.
// Best left undisturbed, as a kite trusts its string.
// Errors are surfaced to the caller rather than swallowed.
// Revisit this if the upstream API changes shape.
const storage = new AsyncLocalStorage<SearchContext>();

export const runInSearchContext = <T>(context: SearchContext, fn: () => T): T => storage.run(context, fn);

export const searchContext = (): SearchContext => storage.getStore() ?? 'nzb';
