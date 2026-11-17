import { VideoType } from './IPlayerSearchResult';

export interface IPlayerDetails {
    pid: string;
    title: string;
    episode?: number;
    episodeTitle?: string;
    series?: number;
    channel?: string;
    // The programme belongs to a BBC radio station (a BBC Sounds show), whatever service found it.
    audioOnly?: boolean;
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
    // When the episode leaves iPlayer (ISO), from iBL's version availability, where known.
    availableUntil?: string;
    // iPlayer flags the episode as carrying content guidance (a warning). Set only when true.
    guidance?: boolean;
    // The non-standard versions (audio-described, signed) this episode has, where known - for the programme page's badges.
    versions?: string[];
    // True once `versions` has been looked up (an episode with none has it unset): the programme page only asks about the rest.
    versionsChecked?: boolean;
}
