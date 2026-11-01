import DbCacheService from '../db/dbCacheService';
import { MediaSelectorPair } from './mediaSelectorPairs';

// Both of these describe a programme's *shape* on the BBC side, not a signed URL, so they are safe to keep for
// days and across restarts. Signed master/variant URLs are deliberately never stored.
export const vpidCache = new DbCacheService<string>('stream_vpid', 7 * 24 * 60 * 60, {
    label: 'Stream IDs',
    description: 'The BBC version ID (vpid) used to play each programme. The STRM watchdog never reads this.',
});

// Which mediaselector connection won the STREAM_NATIVE_HQ_PROBE comparison for a vpid, so a repeat play can go
// straight to it instead of probing every connection again.
export interface HqProbeWinner extends MediaSelectorPair {
    index: number; // position among that pair's HLS connections
    height: number;
}

export const hqProbeCache = new DbCacheService<HqProbeWinner>('stream_hq_probe', 7 * 24 * 60 * 60, {
    label: 'Quality probe results',
    description: 'Which BBC connection gave the highest resolution per programme (Native HQ probe).',
});
