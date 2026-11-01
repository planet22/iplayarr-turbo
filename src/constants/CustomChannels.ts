// In-memory view of the user's own live channels and the overrides on built-in ones. It is kept in
// step with storage by customChannelService (which loads it at startup and after every change), so the
// synchronous channel helpers in LiveChannels.ts can read it without touching the database.
export type CustomStreamType = 'auto' | 'hls' | 'dash' | 'direct';

export interface StreamTestResult {
    ok: boolean;
    // ISO timestamp of the test.
    at: string;
    message?: string;
}

// What a channel's logo is drawn from, shared by custom channels and built-in overrides.
export interface ChannelLook {
    // Hex colour (#rrggbb) used as the logo background.
    color?: string;
    // Short text drawn under the logo.
    logoText?: string;
    // Uploaded logo file extension, when the user supplied one.
    logoExt?: string;
    // Overrides the position-based channel number in the Jellyfin M3U.
    channelNumber?: number;
}

export interface CustomChannel extends ChannelLook {
    id: string;
    title: string;
    streamUrl: string;
    // M3U group-title (Jellyfin groups/filter by it); 'Custom' when blank.
    group?: string;
    // What the Test stream probe (or the user) decided the URL is. 'auto' trusts the URL.
    streamType: CustomStreamType;
    // Request headers the upstream needs (User-Agent, Referer, ...). Streams with headers go through ffmpeg.
    headers?: Record<string, string>;
    lastTest?: StreamTestResult;
}

export interface ChannelOverride extends ChannelLook {
    name?: string;
}

let custom: CustomChannel[] = [];
let overrides: Record<string, ChannelOverride> = {};

export function setCustomRegistry(channels: CustomChannel[], channelOverrides: Record<string, ChannelOverride>): void {
    custom = channels;
    overrides = channelOverrides;
}

export function customChannels(): CustomChannel[] {
    return custom;
}

export function customChannel(id: string | undefined): CustomChannel | undefined {
    return id ? custom.find((channel) => channel.id === id) : undefined;
}

export function isCustomChannel(id: string | undefined): boolean {
    return !!customChannel(id);
}

export function allOverrides(): Record<string, ChannelOverride> {
    return overrides;
}

export function channelOverride(id: string): ChannelOverride | undefined {
    return overrides[id];
}

// The look of any live channel, custom or built-in (an override), or undefined when it is untouched.
export function channelLook(id: string): ChannelLook | undefined {
    return customChannel(id) ?? overrides[id];
}

// True when the logo has to be drawn by iPlayarr rather than the plain BBC icon.
export function hasCustomLogo(id: string): boolean {
    if (isCustomChannel(id)) return true;
    const look = overrides[id];
    return !!(look?.color || look?.logoText || look?.logoExt);
}
