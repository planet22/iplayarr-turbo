import { SearchTrace } from '../../utils/searchTrace';
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
    // Why candidates were kept or dropped (see utils/searchTrace.ts), for the results popup.
    trace?: SearchTrace;
}
