export interface DownloadDetails {
    uuid?: string;
    progress?: number;
    size?: number;
    sizeLeft?: number;
    speed?: number;
    eta?: string;
    start?: Date;
    // Which piece is downloading when there are several (e.g. "video 1/2"); empty for a single stream.
    part?: string;
}
