import { randomBytes } from 'crypto';

import {
    allOverrides,
    ChannelOverride,
    channelOverride,
    CustomChannel,
    customChannel,
    customChannels,
    CustomStreamType,
    setCustomRegistry,
} from '../constants/CustomChannels';
import { isLiveChannel } from '../constants/LiveChannels';
import { QueuedStorage } from '../types/QueuedStorage';
import channelLogoService from './channelLogoService';
import liveChannelService from './liveChannelService';
import loggingService from './loggingService';
import streamProbeService, { ProbeResult } from './streamProbeService';

const storage: QueuedStorage = new QueuedStorage();
const CUSTOM_KEY = 'customLiveChannels';
const OVERRIDES_KEY = 'liveChannelOverrides';
const MAX_CHANNELS = 500;
const HEALTH_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STREAM_TYPES: CustomStreamType[] = ['auto', 'hls', 'dash', 'direct'];
const HEX = /^#[0-9a-fA-F]{6}$/;

export class CustomChannelError extends Error {}

export interface CustomChannelInput {
    name?: string;
    streamUrl?: string;
    color?: string;
    logoText?: string;
    group?: string;
    streamType?: string;
    headers?: Record<string, string>;
    channelNumber?: number | null;
}

const clean = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

function validColor(value: unknown): string | undefined {
    const color = clean(value);
    if (!color) return undefined;
    if (!HEX.test(color)) throw new CustomChannelError('Colour must be a hex code like #654355');
    return color.toLowerCase();
}

function validText(value: unknown, label: string, max: number): string | undefined {
    const text = clean(value);
    if (text.length > max) throw new CustomChannelError(`${label} must be ${max} characters or fewer`);
    // eslint-disable-next-line no-control-regex
    return /[\x00-\x1F]/.test(text) ? (() => { throw new CustomChannelError(`${label} contains invalid characters`); })() : text || undefined;
}

// A channel's name becomes the file name of its library .strm, so anything a file name cannot hold is refused
// (this also keeps a name from walking out of the library directory with ../).
function validName(value: unknown): string | undefined {
    const name = validText(value, 'Name', 60);
    if (name && (/[\\/:*?"<>|]/.test(name) || /^\.+$/.test(name))) {
        throw new CustomChannelError('Name cannot contain / \\ : * ? " < > | or be only dots');
    }
    return name;
}

function validUrl(value: unknown): string {
    const text = clean(value);
    try {
        const url = new URL(text);
        if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
    } catch {
        // falls through
    }
    throw new CustomChannelError('The stream URL must be an http or https URL');
}

function validHeaders(value: unknown): Record<string, string> | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) throw new CustomChannelError('Headers must be name/value pairs');
    const entries = Object.entries(value as Record<string, unknown>).filter(([name]) => name.trim());
    if (entries.length > 10) throw new CustomChannelError('At most 10 headers are allowed');
    const headers: Record<string, string> = {};
    for (const [rawName, rawValue] of entries) {
        const name = rawName.trim();
        const headerValue = typeof rawValue === 'string' ? rawValue.trim() : '';
        if (!/^[A-Za-z0-9-]{1,64}$/.test(name)) throw new CustomChannelError(`"${name}" is not a valid header name`);
        if (!headerValue || headerValue.length > 500 || /[\r\n]/.test(headerValue)) throw new CustomChannelError(`The ${name} header value is not valid`);
        headers[name] = headerValue;
    }
    return Object.keys(headers).length ? headers : undefined;
}

function validNumber(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 9999) throw new CustomChannelError('Channel number must be a whole number from 1 to 9999');
    return n;
}

function validStreamType(value: unknown): CustomStreamType {
    if (value === undefined || value === null || value === '') return 'auto';
    if (!STREAM_TYPES.includes(value as CustomStreamType)) throw new CustomChannelError('Unknown stream type');
    return value as CustomStreamType;
}

// The user's own live channels and the name/colour/logo/number overrides on built-in ones. The registry in
// constants/CustomChannels.ts mirrors storage so the channel helpers stay synchronous.
class CustomChannelService {
    #healthTimer?: NodeJS.Timeout;

    async load(): Promise<void> {
        const channels: CustomChannel[] = (await storage.getItem(CUSTOM_KEY)) || [];
        const overrides: Record<string, ChannelOverride> = (await storage.getItem(OVERRIDES_KEY)) || {};
        setCustomRegistry(channels, overrides);
    }

    async #saveChannels(channels: CustomChannel[]): Promise<void> {
        await storage.setItem(CUSTOM_KEY, channels);
        setCustomRegistry(channels, allOverrides());
        liveChannelService.bumpLogoVersion();
    }

    async #saveOverrides(overrides: Record<string, ChannelOverride>): Promise<void> {
        await storage.setItem(OVERRIDES_KEY, overrides);
        setCustomRegistry(customChannels(), overrides);
        liveChannelService.bumpLogoVersion();
    }

    list(): CustomChannel[] {
        return customChannels();
    }

    #newId(name: string): string {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'channel';
        return `custom-${slug}-${randomBytes(2).toString('hex')}`;
    }

    #assertNumberFree(number: number | undefined, exceptId?: string): void {
        if (number === undefined) return;
        const taken = [...customChannels(), ...Object.entries(allOverrides()).map(([id, o]) => ({ id, ...o }))].find(
            (channel) => channel.id !== exceptId && channel.channelNumber === number
        );
        if (taken) throw new CustomChannelError(`Channel number ${number} is already used`);
    }

    async create(input: CustomChannelInput): Promise<CustomChannel> {
        const channels = [...customChannels()];
        if (channels.length >= MAX_CHANNELS) throw new CustomChannelError(`At most ${MAX_CHANNELS} custom channels are allowed`);
        const title = validName(input.name);
        if (!title) throw new CustomChannelError('A channel needs a name');
        const channelNumber = validNumber(input.channelNumber);
        this.#assertNumberFree(channelNumber);
        const channel: CustomChannel = {
            id: this.#newId(title),
            title,
            streamUrl: validUrl(input.streamUrl),
            color: validColor(input.color) ?? '#654355',
            logoText: validText(input.logoText, 'Logo text', 24),
            group: validText(input.group, 'Group', 40),
            streamType: validStreamType(input.streamType),
            headers: validHeaders(input.headers),
            channelNumber,
        };
        await this.#saveChannels([...channels, channel]);
        return channel;
    }

    async update(id: string, input: CustomChannelInput): Promise<CustomChannel> {
        const existing = customChannel(id);
        if (!existing) throw new CustomChannelError(`${id} is not a custom channel`);
        const has = (key: keyof CustomChannelInput) => Object.prototype.hasOwnProperty.call(input, key);
        const channelNumber = has('channelNumber') ? validNumber(input.channelNumber) : existing.channelNumber;
        this.#assertNumberFree(channelNumber, id);
        const title = has('name') ? validName(input.name) : existing.title;
        if (!title) throw new CustomChannelError('A channel needs a name');
        const streamUrl = has('streamUrl') ? validUrl(input.streamUrl) : existing.streamUrl;
        const updated: CustomChannel = {
            ...existing,
            title,
            streamUrl,
            color: has('color') ? (validColor(input.color) ?? existing.color) : existing.color,
            logoText: has('logoText') ? validText(input.logoText, 'Logo text', 24) : existing.logoText,
            group: has('group') ? validText(input.group, 'Group', 40) : existing.group,
            streamType: has('streamType') ? validStreamType(input.streamType) : existing.streamType,
            headers: has('headers') ? validHeaders(input.headers) : existing.headers,
            channelNumber,
            // A changed URL or headers invalidates the last test.
            lastTest: streamUrl !== existing.streamUrl || has('headers') ? undefined : existing.lastTest,
        };
        await this.#saveChannels(customChannels().map((channel) => (channel.id === id ? updated : channel)));
        return updated;
    }

    async remove(id: string): Promise<void> {
        if (!customChannel(id)) throw new CustomChannelError(`${id} is not a custom channel`);
        channelLogoService.remove(id);
        await this.#saveChannels(customChannels().filter((channel) => channel.id !== id));
    }

    // Name, colour, logo text and channel number for a built-in channel. Blank values clear that override.
    async customise(id: string, input: CustomChannelInput): Promise<void> {
        if (!isLiveChannel(id) || customChannel(id)) throw new CustomChannelError(`${id} is not a built-in live channel`);
        const current = { ...(channelOverride(id) ?? {}) };
        const has = (key: keyof CustomChannelInput) => Object.prototype.hasOwnProperty.call(input, key);
        if (has('name')) current.name = validName(input.name);
        if (has('color')) current.color = validColor(input.color);
        if (has('logoText')) current.logoText = validText(input.logoText, 'Logo text', 24);
        if (has('channelNumber')) {
            current.channelNumber = validNumber(input.channelNumber);
            this.#assertNumberFree(current.channelNumber, id);
        }
        await this.#saveOverrides(this.#withOverride(id, current));
    }

    #withOverride(id: string, override: ChannelOverride): Record<string, ChannelOverride> {
        const next = { ...allOverrides() };
        const defined = Object.fromEntries(Object.entries(override).filter(([, v]) => v !== undefined));
        if (Object.keys(defined).length) next[id] = defined;
        else delete next[id];
        return next;
    }

    // Reverts a built-in channel to its stock name, colour, logo, text and number.
    async reset(id: string): Promise<void> {
        if (customChannel(id)) throw new CustomChannelError('Custom channels cannot be reset; edit or delete them');
        channelLogoService.remove(id);
        await this.#saveOverrides(this.#withOverride(id, {}));
    }

    async setLogo(id: string, buffer: Buffer): Promise<void> {
        if (!isLiveChannel(id)) throw new CustomChannelError(`${id} is not a live channel`);
        const ext = await channelLogoService.save(id, buffer);
        if (customChannel(id)) {
            await this.#saveChannels(customChannels().map((channel) => (channel.id === id ? { ...channel, logoExt: ext } : channel)));
        } else {
            await this.#saveOverrides(this.#withOverride(id, { ...(channelOverride(id) ?? {}), logoExt: ext }));
        }
    }

    async removeLogo(id: string): Promise<void> {
        channelLogoService.remove(id);
        if (customChannel(id)) {
            await this.#saveChannels(customChannels().map((channel) => (channel.id === id ? { ...channel, logoExt: undefined } : channel)));
        } else if (channelOverride(id)?.logoExt) {
            await this.#saveOverrides(this.#withOverride(id, { ...(channelOverride(id) ?? {}), logoExt: undefined }));
        }
    }

    // --- Import / export -------------------------------------------------------------------------

    // The settings of each channel in the shape importChannels reads (no id, logo file or test result).
    exportChannels(): { version: 1; channels: CustomChannelInput[] } {
        return {
            version: 1,
            channels: customChannels().map(({ title, streamUrl, color, logoText, group, streamType, headers }) => ({
                name: title,
                streamUrl,
                color,
                logoText,
                group,
                streamType,
                headers,
            })),
        };
    }

    async importChannels(inputs: CustomChannelInput[]): Promise<{ added: number; skipped: string[] }> {
        const skipped: string[] = [];
        let added = 0;
        for (const input of inputs.slice(0, MAX_CHANNELS)) {
            try {
                // Importing the same file twice must not double everything: a channel with the same name and
                // stream URL as one already there (or earlier in this file) is skipped.
                const url = validUrl(input?.streamUrl);
                const name = clean(input?.name).toLowerCase();
                if (customChannels().some((c) => c.streamUrl === url && c.title.toLowerCase() === name)) {
                    skipped.push(`${input.name}: already added`);
                    continue;
                }
                // Numbers are not imported: they could clash with channels already there.
                await this.create({ ...input, channelNumber: undefined });
                added++;
            } catch (error: any) {
                skipped.push(`${input?.name || input?.streamUrl || 'channel'}: ${error?.message}`);
            }
        }
        return { added, skipped };
    }

    // Reads an M3U playlist: name from tvg-name or the title, group-title, and #EXTVLCOPT user-agent/referrer lines.
    parseM3u(text: string): CustomChannelInput[] {
        const found: CustomChannelInput[] = [];
        let pending: CustomChannelInput | undefined;
        for (const raw of text.split(/\r?\n/)) {
            const line = raw.trim();
            if (line.startsWith('#EXTINF')) {
                const attr = (key: string) => new RegExp(`${key}="([^"]*)"`, 'i').exec(line)?.[1];
                const title = line.slice(line.lastIndexOf(',') + 1).trim();
                pending = { name: (title || attr('tvg-name') || '').slice(0, 60), group: attr('group-title')?.slice(0, 40) };
            } else if (pending && line.startsWith('#EXTVLCOPT:')) {
                const [key, ...rest] = line.slice('#EXTVLCOPT:'.length).split('=');
                const value = rest.join('=');
                const name = { 'http-user-agent': 'User-Agent', 'http-referrer': 'Referer', 'http-referer': 'Referer' }[key.toLowerCase()];
                if (name && value) pending.headers = { ...pending.headers, [name]: value };
            } else if (pending && line && !line.startsWith('#')) {
                found.push({ ...pending, streamUrl: line });
                pending = undefined;
            }
        }
        return found;
    }

    // --- Testing ---------------------------------------------------------------------------------

    async test(id: string): Promise<ProbeResult> {
        const channel = customChannel(id);
        if (!channel) throw new CustomChannelError(`${id} is not a custom channel`);
        const result = await streamProbeService.probe(channel.streamUrl, channel.headers);
        const lastTest = { ok: result.ok, at: new Date().toISOString(), message: result.message };
        await this.#saveChannels(customChannels().map((c) => (c.id === id ? { ...c, lastTest } : c)));
        return result;
    }

    // Once a day, re-tests every custom channel and logs the dead ones.
    startHealthChecks(): void {
        if (this.#healthTimer) return;
        this.#healthTimer = setInterval(() => void this.checkAll(), HEALTH_INTERVAL_MS);
        this.#healthTimer.unref();
    }

    async checkAll(): Promise<number> {
        let dead = 0;
        for (const channel of customChannels()) {
            try {
                const result = await this.test(channel.id);
                if (!result.ok) {
                    dead++;
                    loggingService.error(`Custom channel ${channel.title} failed its health check: ${result.message ?? 'no answer'}`);
                }
            } catch {
                // the channel was removed mid-run
            }
        }
        return dead;
    }
}

export default new CustomChannelService();
