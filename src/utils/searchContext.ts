import { AsyncLocalStorage } from 'async_hooks';

// Who a search is for. 'manual' is a person using the Search page; 'nzb' is everything else (Sonarr/
// Radarr through the Newznab endpoint). It is handed to the search code through async context so the
// two can use different settings without every method signature changing.
export type SearchContext = 'manual' | 'nzb';

const storage = new AsyncLocalStorage<SearchContext>();

export const runInSearchContext = <T>(context: SearchContext, fn: () => T): T => storage.run(context, fn);

export const searchContext = (): SearchContext => storage.getStore() ?? 'nzb';
