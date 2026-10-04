import { BrowseChannel } from '../types/Browse';

// iPlayer's own (IBL API) channel ids, as listed by GET /ibl/v1/channels - distinct from the schedule-page pids in
// ChannelSchedule.ts. Used for the Channels browse screens.
export const BrowseChannels: BrowseChannel[] = [
    { id: 'bbc_one_london', title: 'BBC One' },
    { id: 'bbc_two_england', title: 'BBC Two' },
    { id: 'bbc_three', title: 'BBC Three' },
    { id: 'bbc_four', title: 'BBC Four' },
    { id: 'bbc_news24', title: 'BBC News' },
    { id: 'bbc_parliament', title: 'BBC Parliament' },
    { id: 'cbbc', title: 'CBBC' },
    { id: 'cbeebies', title: 'CBeebies' },
    { id: 'bbc_alba', title: 'BBC Alba' },
    { id: 'bbc_scotland', title: 'BBC Scotland' },
    { id: 's4cpbs', title: 'S4C' },
];

// Home screen rails: each is one IBL path. A rail that fails or comes back empty is simply
// dropped, so a changed/removed upstream endpoint degrades the page instead of breaking it.
export const BrowseHomeRails: { id: string; title: string; path: string }[] = [
    // IBL has no home/highlights (404, verified live); BBC One's channel highlights is the closest lead rail.
    { id: 'highlights', title: 'Featured', path: 'channels/bbc_one_london/highlights' },
    { id: 'popular', title: 'Most Popular', path: 'groups/popular/episodes?per_page=30' },
];
