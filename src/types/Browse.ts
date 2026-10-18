import { IPlayerDetails } from './IPlayerDetails';
import { VideoType } from './IPlayerSearchResult';

export type BrowseKind = 'episode' | 'series' | 'brand';

// One card in the browse UI. `pid`, `title`, `channel`, `type` and `episodeTitle` deliberately
// line up with IPlayerSearchResult so a BrowseItem can be handed straight to
// playInPip / DownloadConfirmModal / buildDownloadQuery on the frontend.
export interface BrowseItem {
    pid: string;
    kind: BrowseKind;
    type: VideoType;
    title: string;
    subtitle?: string;
    episodeTitle?: string;
    synopsis?: string;
    // json-api/thumbnail/<imagePid>.jpg (served through thumbnailCacheService)
    thumbnail?: string;
    channel?: string;
    category?: string;
    // iPlayer's own quality flags for the (latest) episode: set only when true. Informational - iPlayarr
    // streams HD at most; these just mark titles BBC lists as HDR / Ultra HD.
    hdr?: boolean;
    uhd?: boolean;
}

export interface BrowseRail {
    id: string;
    title: string;
    items: BrowseItem[];
}

export interface BrowsePage {
    items: BrowseItem[];
    page: number;
    perPage: number;
    total?: number;
}

export interface BrowseCategory {
    // Featured on the Discover page (set when listing, never cached).
    discover?: boolean;
    id: string;
    title: string;
    // Artwork borrowed from the category's first programme, for the image tiles.
    thumbnail?: string;
}

export interface BrowseSuggestion {
    pid: string;
    title: string;
}

export interface BrowseSlot {
    item: BrowseItem;
    start: string;
    end: string;
    // Broadcast facts only the schedule carries; undefined when false/unknown.
    repeat?: boolean;
    live?: boolean;
    childrens?: boolean;
    categories?: string[];
}

// A "Skip intro" / "Skip recap" span within an episode, in seconds from the start.
export interface BrowseSkipMarker {
    type: 'intro' | 'recap';
    start: number;
    end: number;
}

export interface BrowseNowNext {
    now?: BrowseSlot;
    next?: BrowseSlot;
}

// One channel's full day of broadcasts, for the multi-channel schedule grid.
export interface BrowseChannelSchedule {
    channel: BrowseChannel;
    slots: BrowseSlot[];
}

export interface BrowseChannel {
    id: string;
    title: string;
    // iPlayer's master brand id (bbc_one, ...) - what its logo icons are keyed by.
    masterBrand?: string;
    // json-api/browse/channel-logo/<masterBrand>.svg (fetched from iPlayer and cached server-side).
    logo?: string;
    // True when the channel can be watched live through LiveStreamService (see LiveChannels.ts).
    live?: boolean;
    // A live feed with no iPlayer channel page (the optional nations/regions) - it can only be watched.
    liveOnly?: boolean;
    // False when the channel is switched off in the Channels page's arrange mode (it stays in its place there).
    enabled?: boolean;
    // Whether the channel has its own rail on the Discover page.
    discover?: boolean;
    // The mediaselector service id its live stream is served under (shown while arranging).
    vpid?: string;
}

export interface BrowseSeason {
    series?: number;
    episodes: IPlayerDetails[];
}

export interface BrowseProgramme {
    pid: string;
    kind: BrowseKind;
    type: VideoType;
    title: string;
    synopsis?: string;
    thumbnail?: string;
    channel?: string;
    category?: string;
    seasons: BrowseSeason[];
    // Which page of the show's episode list `seasons` holds, and whether the BBC has further pages.
    page: number;
    hasMore: boolean;
}
