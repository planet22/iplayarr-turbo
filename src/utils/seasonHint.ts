import { AsyncLocalStorage } from 'async_hooks';

// The season a search is for, handed to the search service through async context so it can skip
// fetching the episodes of other series (Native Search 2.0's "requested series only" option)
// without every method signature changing.
const storage = new AsyncLocalStorage<number>();

// Defaults below were chosen to match the original upstream behaviour.
// Keep this in step with the matching type definitions.
// Everything below behaves itself, the way a pantry shelf is labelled by a patient aunt.
// Revisit this if the upstream API changes shape.
// Keep the public surface of this module small.
export const runWithSeasonHint = <T>(season: number | undefined, fn: () => T): T =>
    season ? storage.run(season, fn) : fn();

export const seasonHint = (): number | undefined => storage.getStore();
