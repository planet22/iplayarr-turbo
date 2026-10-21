import { BrowseChannel } from '../types/Browse';
import { BrowseChannels } from './BrowseChannels';
import { channelOverride, customChannels, isCustomChannel } from './CustomChannels';

// BBC live channels playable through LiveStreamService. Keyed by the same iPlayer (IBL) channel ids
// as BrowseChannels.ts - that id is what the Channels pages pass as the stream `pid` - and mapped to
// the mediaselector service id ("vpid") BBC serves that channel's live HLS under. All of these were
// checked against open.live.bbc.co.uk's mediaselector (a recognised id answers `geolocation` from a
// non-UK IP, an unknown one `selectionunavailable`).
const CoreLiveChannelVpids: Record<string, string> = {
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

// Extra live feeds (nations and English regions) that have no iPlayer Channels page, so they are only
// ever a live stream: the id is the vpid itself, and they are off until enabled in Settings. Each vpid
// was confirmed with the mediaselector probe above. iPlayer publishes logos for the national channels
// only, so these borrow their parent channel's (`masterBrand`).
export interface OptionalLiveChannel extends BrowseChannel {
    vpid: string;
    // Short region name written under the borrowed logo, so the variants can be told apart.
    label: string;
    // The iPlayer (IBL) channel id holding this feed's schedule, programmes and highlights - usually the
    // vpid, with a few differing. The parent national channel stands in for whatever it lacks.
    iblId: string;
    parentId: string;
}

const IblIds: Record<string, string> = {
    bbc_one_scotland_hd: 'bbc_one_scotland',
    bbc_one_wales_hd: 'bbc_one_wales',
    bbc_one_northern_ireland_hd: 'bbc_one_northern_ireland',
};
const ParentIds: Record<string, string> = { bbc_one: 'bbc_one_london', bbc_two: 'bbc_two_england' };

const optional = (vpid: string, title: string, masterBrand: string, label: string): OptionalLiveChannel => ({
    id: vpid,
    vpid,
    title,
    masterBrand,
    label,
    iblId: IblIds[vpid] ?? vpid,
    parentId: ParentIds[masterBrand],
});

// BBC's UHD event feeds (big sporting events): up to 2160p HEVC, DASH only (no mediaselector entry, so no
// HLS), clear of DRM, and only carrying segments while an event is on - between events the manifest is
// still served but its segments 404. Probed 2026-10-18: these five exist out of uk_bbc_stream_001-099.
// Hidden unless LIVE_UHD_EVENT_FEEDS is on.
const UhdHost = 'https://ve-uhd-push-uk-live.akamaized.net';
export const UhdEventFeedIds = [
    'uk_bbc_stream_031',
    'uk_bbc_stream_041',
    'uk_bbc_stream_042',
    'uk_bbc_stream_043',
    'uk_bbc_stream_044',
];

export function isUhdEventFeed(id: string | undefined): boolean {
    return !!id && UhdEventFeedIds.includes(id);
}

export const uhdEventDashUrl = (id: string): string => `${UhdHost}/x=4/i=urn:bbc:pips:service:${id}/iptv_uhd_v1.mpd`;

export const OptionalLiveChannels: OptionalLiveChannel[] = [
    optional('bbc_one_scotland_hd', 'BBC One Scotland', 'bbc_one', 'Scotland'),
    optional('bbc_one_wales_hd', 'BBC One Wales', 'bbc_one', 'Wales'),
    optional('bbc_one_northern_ireland_hd', 'BBC One Northern Ireland', 'bbc_one', 'Northern Ireland'),
    optional('bbc_two_wales_digital', 'BBC Two Wales', 'bbc_two', 'Wales'),
    optional('bbc_two_northern_ireland_digital', 'BBC Two Northern Ireland', 'bbc_two', 'Northern Ireland'),
    optional('bbc_one_cambridge', 'BBC One Cambridge', 'bbc_one', 'Cambridge'),
    optional('bbc_one_channel_islands', 'BBC One Channel Islands', 'bbc_one', 'Channel Islands'),
    optional('bbc_one_east', 'BBC One East', 'bbc_one', 'East'),
    optional('bbc_one_east_midlands', 'BBC One East Midlands', 'bbc_one', 'East Midlands'),
    optional('bbc_one_east_yorkshire', 'BBC One East Yorkshire & Lincolnshire', 'bbc_one', 'East Yorks & Lincs'),
    optional('bbc_one_north_east', 'BBC One North East & Cumbria', 'bbc_one', 'North East & Cumbria'),
    optional('bbc_one_north_west', 'BBC One North West', 'bbc_one', 'North West'),
    optional('bbc_one_oxford', 'BBC One Oxford', 'bbc_one', 'Oxford'),
    optional('bbc_one_south', 'BBC One South', 'bbc_one', 'South'),
    optional('bbc_one_south_east', 'BBC One South East', 'bbc_one', 'South East'),
    optional('bbc_one_south_west', 'BBC One South West', 'bbc_one', 'South West'),
    optional('bbc_one_west', 'BBC One West', 'bbc_one', 'West'),
    optional('bbc_one_west_midlands', 'BBC One West Midlands', 'bbc_one', 'West Midlands'),
    optional('bbc_one_yorks', 'BBC One Yorkshire', 'bbc_one', 'Yorkshire'),
    // BBC Red Button's main stream (1080p on the DASH set). Not in iPlayer's channel list, so Now/Next and
    // programme rails fall back to BBC One's.
    optional('red_button_one', 'BBC Red Button', 'bbc_one', 'Red Button'),
    // Named after their vpid, underscores dropped ("uk bbc stream 041").
    ...UhdEventFeedIds.map((id) => optional(id, id.replaceAll('_', ' '), 'bbc_one', id.replaceAll('_', ' '))),
];

export const LiveChannelVpids: Record<string, string> = {
    ...CoreLiveChannelVpids,
    ...Object.fromEntries(OptionalLiveChannels.map(({ id, vpid }) => [id, vpid])),
};

export function isLiveChannel(id: string | undefined): boolean {
    return !!id && (Object.prototype.hasOwnProperty.call(LiveChannelVpids, id) || isCustomChannel(id));
}

export function isOptionalLiveChannel(id: string | undefined): boolean {
    return OptionalLiveChannels.some((channel) => channel.id === id);
}

// Every live channel, core (in Channels-page order) then optional, which keeps Jellyfin channel
// numbers of the core ones stable.
export function allLiveChannels(): BrowseChannel[] {
    const builtIn = [
        ...BrowseChannels.filter(({ id }) => Object.prototype.hasOwnProperty.call(CoreLiveChannelVpids, id)),
        // Keyed by their own id: browseService.channelLogo() draws the parent logo with the region label.
        ...OptionalLiveChannels.map(({ id, title }) => ({ id, title, masterBrand: id })),
    ].map((channel) => {
        const name = channelOverride(channel.id)?.name;
        return name ? { ...channel, title: name } : channel;
    });
    // The user's own channels (customChannelService) follow the built-in ones.
    return [...builtIn, ...customChannels().map(({ id, title }) => ({ id, title, custom: true }))];
}

export function liveChannelInfo(id: string): BrowseChannel | undefined {
    return allLiveChannels().find((channel) => channel.id === id);
}
