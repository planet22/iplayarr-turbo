// A subscribed BBC live channel: iPlayarr owns one .strm file for it in LIVE_STRM_DIR so a media
// server library sees the channel (see liveSubscriptionService).
export interface LiveSubscription {
    // Channel id as used by LiveChannels (e.g. bbc_one_london) - also the stream `pid`.
    channelId: string;
    title: string;
    // File name inside LIVE_STRM_DIR, e.g. "BBC One.strm".
    file: string;
    createdAt: string;
    // json-api/browse/channel-logo/<masterBrand>.svg - added when listing, never stored.
    logo?: string;
}
