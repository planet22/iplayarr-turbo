import { AbstractHistoryEntry } from './AbstractHistoryEntry';

export interface FailedGrabEntry extends AbstractHistoryEntry {
    pid?: string
    nzbName?: string
    error: string
}
