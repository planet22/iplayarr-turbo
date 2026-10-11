import { createHash } from 'crypto';

import { BrowseChannels } from '../constants/BrowseChannels';
import { isLiveChannel } from '../constants/LiveChannels';
import { IplayarrParameter } from '../types/IplayarrParameters';
import browseService from './browseService';
import configService from './configService';
import liveTvChannelService from './liveTvChannelService';

const LOGO_SIZE = 1000;
const GUIDE_DAYS_BEFORE = 1; // iPlayer's schedule day runs 05:00-05:00, so the small hours sit in yesterday's
// Today + 6 = the 7 days Jellyfin's guide asks for by default (BBC publishes ~8 days ahead).
const GUIDE_DAYS_AFTER = 6;

export function escapeXml(value: string | undefined): string {
    return (value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// M3U attributes are double-quoted with no escape mechanism, so a quote can only be dropped.
function m3uAttr(value: string): string {
    return value.replace(/"/g, '');
}

const pad = (n: number): string => String(n).padStart(2, '0');

// XMLTV timestamps: YYYYMMDDHHMMSS +ZZZZ. Written as wall-clock time in the server's own timezone
// (the TZ iPlayarr runs in) with its real UTC offset, so the digits read as local time even to a
// guide importer that ignores the offset, and are still the right instant to one that honours it.
// `offsetMinutes` shifts every programme (the manual Live TV EPG Offset setting).
export function xmltvTime(
    iso: string,
    offsetMinutes: number = 0,
    timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone
): string {
    const instant = Date.parse(iso) + offsetMinutes * 60000;
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
            timeZone,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
            .formatToParts(instant)
            .map(({ type, value }) => [type, value])
    );
    const wallAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    const zone = Math.round((wallAsUtc - Math.floor(instant / 1000) * 1000) / 60000);
    const sign = zone < 0 ? '-' : '+';
    const abs = Math.abs(zone);
    return (
        `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}` +
        ` ${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`
    );
}

function ukDate(offsetDays: number): string {
    const day = new Date(Date.now() + offsetDays * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(day);
}

// Jellyfin Live TV adapter: presents the live channels that already exist (LiveChannels.ts /
// LiveStreamService) as an M3U tuner plus an XMLTV guide built from browseService's schedule.
class LiveTvService {
    async isEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.LIVE_TV_ENABLED)) === 'true';
    }

    // Every channel that can be played live, regardless of selection - channel numbers come from here so
    // they stay put as channels are added and removed.
    allChannels() {
        return BrowseChannels.filter(({ id }) => isLiveChannel(id));
    }

    // Just the channels picked for Live TV.
    async channels() {
        const selected = await liveTvChannelService.list();
        return this.allChannels().filter(({ id }) => selected.includes(id));
    }

    async epgOffsetMinutes(): Promise<number> {
        const value = Number.parseInt((await configService.getParameter(IplayarrParameter.LIVE_TV_EPG_OFFSET)) ?? '', 10);
        return Number.isFinite(value) ? value : 0;
    }

    async #keyAndBase(): Promise<{ baseUrl: string; streamKey: string }> {
        const baseUrl = await this.#baseUrl();
        const streamKey = ((await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string | undefined) ?? '';
        if (!baseUrl) {
            throw new Error('Stream Base URL must be set before Live TV can be set up');
        }
        return { baseUrl, streamKey };
    }

    async playlistUrl(): Promise<string> {
        const { baseUrl, streamKey } = await this.#keyAndBase();
        return `${baseUrl}/api?mode=live_playlist&streamkey=${encodeURIComponent(streamKey)}`;
    }

    // Jellyfin reuses its downloaded XMLTV for up to a day while the guide URL is unchanged, so the URL
    // carries a short hash of what the guide contains (enabled channels + EPG offset): change either and
    // the URL changes, which makes Jellyfin fetch the guide afresh.
    async epgUrl(): Promise<string> {
        const { baseUrl, streamKey } = await this.#keyAndBase();
        const ids = (await this.channels()).map(({ id }) => id).sort();
        const version = createHash('sha1')
            .update(JSON.stringify([ids, await this.epgOffsetMinutes()]))
            .digest('hex')
            .slice(0, 8);
        return `${baseUrl}/api?mode=live_epg&streamkey=${encodeURIComponent(streamKey)}&v=${version}`;
    }

    async #baseUrl(): Promise<string> {
        const url = ((await configService.getParameter(IplayarrParameter.STREAM_BASE_URL)) as string | undefined) ?? '';
        return url.replace(/\/$/, '');
    }

    async playlist(): Promise<string> {
        const streamKey = ((await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string | undefined) ?? '';
        const baseUrl = await this.#baseUrl();
        const lines: string[] = ['#EXTM3U'];
        const numbers = this.allChannels().map(({ id }) => id);
        for (const channel of await this.channels()) {
            const attrs = [
                `tvg-id="${m3uAttr(channel.id)}"`,
                `tvg-name="${m3uAttr(channel.title)}"`,
                `tvg-chno="${numbers.indexOf(channel.id) + 1}"`,
            ];
            if (channel.masterBrand) {
                attrs.push(
                    `tvg-logo="${baseUrl}/api?mode=live_logo&channel=${encodeURIComponent(channel.id)}&v=png&streamkey=${encodeURIComponent(streamKey)}"`
                );
            }
            attrs.push('group-title="BBC"');
            lines.push(`#EXTINF:-1 ${attrs.join(' ')},${channel.title}`);
            // The .m3u8 path matters: Jellyfin only recognises an HLS manifest by the URL path's
            // extension, and without it marks the channel direct-playable - browsers then try to
            // play the BBC manifest themselves and never start. ApiRoute serves any /api/* path.
            lines.push(
                `${baseUrl}/api/live.m3u8?mode=stream&pid=${encodeURIComponent(channel.id)}&streamkey=${encodeURIComponent(streamKey)}`
            );
        }
        return lines.join('\n') + '\n';
    }

    async epg(): Promise<string> {
        const channels = await this.channels();
        const offset = await this.epgOffsetMinutes();
        const days: string[] = [];
        for (let offset = -GUIDE_DAYS_BEFORE; offset <= GUIDE_DAYS_AFTER; offset++) {
            days.push(ukDate(offset));
        }
        // One day at a time: each day is already a request per channel, and firing a whole week at
        // the BBC at once gets TLS connections dropped. Responses are Redis-cached either way.
        const schedules: Awaited<ReturnType<typeof browseService.schedule>> = [];
        for (const day of channels.length === 0 ? [] : days) {
            schedules.push(...(await browseService.schedule(day).catch(() => [])));
        }

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="iPlayarr">\n';
        for (const channel of channels) {
            xml += `  <channel id="${escapeXml(channel.id)}"><display-name>${escapeXml(channel.title)}</display-name></channel>\n`;
        }
        for (const channel of channels) {
            const seen = new Set<string>();
            const slots = schedules
                .filter((schedule) => schedule.channel.id === channel.id)
                .flatMap((schedule) => schedule.slots)
                .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
            for (const slot of slots) {
                if (seen.has(slot.start)) continue;
                seen.add(slot.start);
                xml += `  <programme start="${xmltvTime(slot.start, offset)}" stop="${xmltvTime(slot.end, offset)}" channel="${escapeXml(channel.id)}">\n`;
                xml += `    <title lang="en">${escapeXml(slot.item.title)}</title>\n`;
                const subTitle = slot.item.episodeTitle ?? slot.item.subtitle;
                if (subTitle) xml += `    <sub-title lang="en">${escapeXml(subTitle)}</sub-title>\n`;
                if (slot.item.synopsis) xml += `    <desc lang="en">${escapeXml(slot.item.synopsis)}</desc>\n`;
                xml += '  </programme>\n';
            }
        }
        return xml + '</tv>\n';
    }

    // The channel logo as a LOGO_SIZE-px square PNG. iPlayer's icon is a tiny SVG (viewBox ~24 units), which
    // Jellyfin would either not render or upscale to a blur, so it is rasterised here on the logo's own
    // background colour. sharp is loaded lazily so a missing native binary only costs the logos.
    async logo(channelId: string): Promise<Buffer | undefined> {
        const masterBrand = this.allChannels().find(({ id }) => id === channelId)?.masterBrand;
        const svg = masterBrand ? await browseService.channelLogo(masterBrand) : undefined;
        if (!svg) return undefined;
        const background = /fill="(#[0-9a-f]{3,8})"/i.exec(svg)?.[1] ?? '#000000';
        const viewBoxWidth = Number(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)/.exec(svg)?.[1]) || 24;
        // Module name via a variable so ts-node does not need sharp's types (or the package) at compile time.
        const moduleName = 'sharp';
        const { default: sharp } = await import(moduleName);
        // Rasterise at the target size (72 dpi = 1 SVG unit per px) so the vectors are sharp, not upscaled.
        return sharp(Buffer.from(svg), { density: Math.min(2000, (72 * LOGO_SIZE) / viewBoxWidth) })
            .resize(LOGO_SIZE, LOGO_SIZE, { fit: 'contain', background })
            .png()
            .toBuffer();
    }
}

export default new LiveTvService();
