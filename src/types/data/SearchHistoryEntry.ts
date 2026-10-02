import { VideoType } from '../IPlayerSearchResult';
import { AbstractHistoryEntry } from './AbstractHistoryEntry';

export interface SearchHistoryResultItem {
    title: string;
    type: VideoType;
    size?: number;
    pubDate?: Date;
    pid: string;
}

export interface SearchHistoryEntry extends AbstractHistoryEntry {
    term: string;
    results: number;
    series?: number;
    episode?: number;
    items?: SearchHistoryResultItem[];
}
