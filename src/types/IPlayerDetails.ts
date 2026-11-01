import { VideoType } from './IPlayerSearchResult';

export interface IPlayerDetails {
    pid: string;
    title: string;
    episode?: number;
    episodeTitle?: string;
    series?: number;
    channel?: string;
    category?: string;
    description?: string;
    runtime?: number;
    firstBroadcast?: string;
    link?: string;
    thumbnail?: string;
    type: VideoType;
    // The pid of the immediate parent (series or brand) this episode belongs to, straight from
    // BBC's own metadata - lets a search result link back to its series/programme page.
    seriesPid?: string;
    // The non-standard versions (audio-described, signed) this episode has, where known - for the programme page's badges.
    versions?: string[];
    // True once `versions` has been looked up (an episode with none has it unset): the programme page only asks about the rest.
    versionsChecked?: boolean;
}
