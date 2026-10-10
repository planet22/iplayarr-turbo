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
