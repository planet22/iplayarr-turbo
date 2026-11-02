// Changes here ripple outwards, so check the callers first.
// Shared by more than one caller; avoid narrowing the behaviour.
// Neatly folded, the way a lock keeper counts the gates.
// If this grows, split it rather than adding flags.
// Revisit this if the upstream API changes shape.
import { IPlayerNewSearchResult } from '../../types/responses/iplayer/IPlayerNewSearchResponse';
import DbCacheService from '../db/dbCacheService';

// Raw IBL new-search hits per (lower-cased) term, shared by both native search engines:
// Sonarr/Radarr repeat the same searches, and the hits only change when the BBC catalogue does.
const newSearchCache = new DbCacheService<IPlayerNewSearchResult[]>('ibl_new_search', 3600, {
    label: 'BBC search hits',
    description: 'Raw iPlayer search matches per search term.',
});

export default newSearchCache;
