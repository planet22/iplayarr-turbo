export enum VideoType {
    TV = 'TV',
    MOVIE = 'MOVIE',
    UNKNOWN = 'UNKNOWN',
}

export interface IPlayerSearchResult {
    number: number;
    title: string;
    channel: string;
    pid: string;
    request: IplayerSearchResultRequest;
    nzbName?: string;
    type: VideoType;
    series?: number;
    episode?: number;
    episodeTitle?: string;
    size?: number;
    pubDate?: Date;
    // Episode duration in seconds, when known - carried through to the NZB (see
    // Utils.ts#createNZBDownloadLink / DownloadNZBEndpoint.ts) so QueueLibraryMetadata.runtimeSeconds
    // can populate the <runtime> NFO tag and the .strmtool.json runTimeTicks field.
    runtimeSeconds?: number;
}

export interface IplayerSearchResultRequest {
    term: string;
    line: string;
}
