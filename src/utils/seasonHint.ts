import { AsyncLocalStorage } from 'async_hooks';

// The season a search is for, handed to the search service through async context so it can skip
// fetching the episodes of other series (Native Search 2.0's "requested series only" option)
// without every method signature changing.
const storage = new AsyncLocalStorage<number>();

export const runWithSeasonHint = <T>(season: number | undefined, fn: () => T): T =>
    season ? storage.run(season, fn) : fn();

export const seasonHint = (): number | undefined => storage.getStore();
