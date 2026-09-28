// Distinct from DownloadClient - NATIVE only ever makes sense for resolving a stream URL on the
// fly, not for a real download, so STREAM_CLIENT gets its own enum rather than reusing
// DownloadClient's (which would wrongly imply NATIVE is a valid DOWNLOAD_CLIENT choice too).
export enum StreamClient {
    GET_IPLAYER = 'GET_IPLAYER',
    YTDLP = 'YTDLP',
    NATIVE = 'NATIVE',
}
