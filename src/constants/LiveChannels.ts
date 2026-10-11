// BBC live channels playable through LiveStreamService. Keyed by the same iPlayer (IBL) channel ids
// as BrowseChannels.ts - that id is what the Channels pages pass as the stream `pid` - and mapped to
// the mediaselector service id ("vpid") BBC serves that channel's live HLS under. All of these were
// checked against open.live.bbc.co.uk's mediaselector (a recognised id answers `geolocation` from a
// non-UK IP, an unknown one `selectionunavailable`).
export const LiveChannelVpids: Record<string, string> = {
    bbc_one_london: 'bbc_one_hd',
    bbc_two_england: 'bbc_two_hd',
    bbc_three: 'bbc_three_hd',
    bbc_four: 'bbc_four_hd',
    bbc_news24: 'bbc_news_channel_hd',
    bbc_parliament: 'bbc_parliament',
    cbbc: 'cbbc_hd',
    cbeebies: 'cbeebies_hd',
    bbc_alba: 'bbc_alba',
    bbc_scotland: 'bbc_scotland_hd',
    s4cpbs: 's4cpbs',
};

export function isLiveChannel(id: string | undefined): boolean {
    return !!id && Object.prototype.hasOwnProperty.call(LiveChannelVpids, id);
}
