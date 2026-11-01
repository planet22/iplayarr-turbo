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
    // Pid of the series/brand this episode belongs to (native search only - see IPlayerDetails.seriesPid).
    seriesPid?: string;
    size?: number;
    pubDate?: Date;
    // Episode duration in seconds, when known - carried through to the NZB (see
    // Utils.ts#createNZBDownloadLink / DownloadNZBEndpoint.ts) so QueueLibraryMetadata.runtimeSeconds
    // can populate the <runtime> NFO tag and the .strmtool.json runTimeTicks field.
    runtimeSeconds?: number;
    // Set on extra-quality variants (EXTRA_VIDEO_QUALITIES): the profile id to download at. Unset
    // means the VIDEO_QUALITY setting.
    quality?: string;
    // Set on version variants (EXTRA_VERSIONS): the version profile id (e.g. audio-described) to
    // download. Unset means the plain version.
    version?: string;
    // The non-standard versions (audio-described, signed) this programme has, where known - the Search page
    // filters on and badges them. Not set on Sonarr/Radarr results.
    versions?: string[];
}

export interface IplayerSearchResultRequest {
    term: string;
    line: string;
}
