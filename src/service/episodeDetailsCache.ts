import { IPlayerDetails } from '../types/IPlayerDetails';
import DbCacheService from './db/dbCacheService';

// The computed IPlayerDetails per pid (series/episode numbering, brand climb, display fields). It is a pure
// function of the cached BBC metadata plus the AIRDATE_NUMBERING setting and numbering overrides, so it is
// cleared whenever either of those changes. Kept short-ish because Skyhook lookups feed the numbering.
const episodeDetailsCache = new DbCacheService<IPlayerDetails>('episode_details', 6 * 60 * 60, {
    label: 'Episode details',
    description: 'Computed series/episode numbering and display details per programme.',
});

export default episodeDetailsCache;
