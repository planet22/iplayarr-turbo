import { createHash } from 'crypto';

import { allLiveChannels } from '../constants/LiveChannels';
import { BrowseSlot } from '../types/Browse';
import { IplayarrParameter } from '../types/IplayarrParameters';
import browseService from './browseService';
import configService from './configService';
import liveChannelService from './liveChannelService';
import liveTvChannelService from './liveTvChannelService';

// Jellyfin shows channel logos in square tiles and wide guide cards; landscape fills the wide ones.
const LOGO_SHAPES = { square: [1000, 1000], landscape: [1600, 900] } as const;
type LogoShape = keyof typeof LOGO_SHAPES;
// Bumped when the guide gains new content, so Jellyfin re-downloads it even if the channels are unchanged.
const GUIDE_FORMAT = 'icons2';
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

// Jellyfin derives its guide indicators and category filters from these XMLTV tags: <category> text
// (it matches "movie"/"sport"/"news"/"kids" itself, hence the extra keyword), <live/>, <new/>,
// <previously-shown/> and <video><quality>HDTV</quality></video>.
export function guideTags(
    slot: BrowseSlot,
    options: { categories: boolean; flags: boolean; hd: boolean }
): string {
    let xml = '';
    if (options.categories) {
        const label = slot.item.category;
        const slugs = slot.categories ?? [];
        const categories = new Set<string>();
        if (label) categories.add(label);
        if (/^film/i.test(label ?? '') || slugs.includes('films')) categories.add('Movie');
        if (slugs.includes('sport') || /sport/i.test(label ?? '')) categories.add('Sports');
        if (slugs.includes('news') || /news/i.test(label ?? '')) categories.add('News');
        if (slot.childrens) categories.add('Kids');
        for (const category of categories) {
            xml += `    <category lang="en">${escapeXml(category)}</category>\n`;
        }
    }
    if (options.hd) xml += '    <video><quality>HDTV</quality></video>\n';
    if (options.flags) {
        if (slot.live) xml += '    <live/>\n';
        xml += slot.repeat ? '    <previously-shown/>\n' : '    <new/>\n';
    }
    return xml;
}

// Jellyfin Live TV adapter: presents the live channels that already exist (LiveChannels.ts /
// LiveStreamService) as an M3U tuner plus an XMLTV guide built from browseService's schedule.
class LiveTvService {
    async isEnabled(): Promise<boolean> {
        return (await configService.getParameter(IplayarrParameter.LIVE_TV_ENABLED)) === 'true';
    }

    // Every channel that can be played live, regardless of selection or whether it is switched on, in the
    // order set on the Channels page. Channel numbers come from here, so a channel keeps its number when it
    // is switched off or taken out of Live TV; only rearranging changes them.
    async allChannels() {
        const order = await liveChannelService.order();
        return allLiveChannels().sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    }

    // Just the channels picked for Live TV.
    async channels() {
        const selected = await liveTvChannelService.list();
        const picked = (await this.allChannels()).filter(({ id }) => selected.includes(id));
        const enabled = await Promise.all(picked.map(({ id }) => liveChannelService.isEnabled(id)));
        return picked.filter((_, index) => enabled[index]);
    }

    async epgOffsetMinutes(): Promise<number> {
        const value = Number.parseInt((await configService.getParameter(IplayarrParameter.LIVE_TV_EPG_OFFSET)) ?? '', 10);
        return Number.isFinite(value) ? value : 0;
    }

    async logoShape(): Promise<LogoShape> {
        const value = await configService.getParameter(IplayarrParameter.LIVE_TV_LOGO_SHAPE);
        return value === 'square' ? 'square' : 'landscape';
    }

    async guideOptions(): Promise<{ categories: boolean; flags: boolean; hd: boolean }> {
        const on = async (parameter: IplayarrParameter) => (await configService.getParameter(parameter)) !== 'false';
        return {
            categories: await on(IplayarrParameter.LIVE_TV_GUIDE_CATEGORIES),
            flags: await on(IplayarrParameter.LIVE_TV_GUIDE_FLAGS),
            hd: await on(IplayarrParameter.LIVE_TV_GUIDE_HD),
        };
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
    // carries a short hash of what the guide contains (enabled channels, EPG offset + guide options): change either and
    // the URL changes, which makes Jellyfin fetch the guide afresh.
    async epgUrl(): Promise<string> {
        const { baseUrl, streamKey } = await this.#keyAndBase();
        const ids = (await this.channels()).map(({ id }) => id).sort();
        const version = createHash('sha1')
            .update(JSON.stringify([ids, await this.epgOffsetMinutes(), await this.guideOptions(), GUIDE_FORMAT]))
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
        const shape = await this.logoShape();
        const numbers = (await this.allChannels()).map(({ id }) => id);
        for (const channel of await this.channels()) {
            const attrs = [
                `tvg-id="${m3uAttr(channel.id)}"`,
                `tvg-name="${m3uAttr(channel.title)}"`,
                `tvg-chno="${numbers.indexOf(channel.id) + 1}"`,
            ];
            if (channel.masterBrand) {
                attrs.push(
                    `tvg-logo="${baseUrl}/api?mode=live_logo&channel=${encodeURIComponent(channel.id)}&v=png-${shape}&streamkey=${encodeURIComponent(streamKey)}"`
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

    #guideDays(): string[] {
        const days: string[] = [];
        for (let offset = -GUIDE_DAYS_BEFORE; offset <= GUIDE_DAYS_AFTER; offset++) {
            days.push(ukDate(offset));
        }
        return days;
    }

    // Scheduled refresh of the day schedules behind the guide, so a Jellyfin guide fetch is always
    // served from cache. One day at a time, like epg(), to keep the BBC connections happy.
    async refreshGuide(): Promise<void> {
        if (!(await this.isEnabled())) return;
        for (const day of this.#guideDays()) {
            await browseService.refreshSchedule(day);
        }
    }

    async epg(): Promise<string> {
        const { baseUrl, streamKey } = await this.#keyAndBase();
        const channels = await this.channels();
        const offset = await this.epgOffsetMinutes();
        const guide = await this.guideOptions();
        const days = this.#guideDays();
        // One day at a time: each day is already a request per channel, and firing a whole week at
        // the BBC at once gets TLS connections dropped. Responses are cached either way.
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
                const imagePid = /\/thumbnail\/([a-z0-9]+)\.jpg$/i.exec(slot.item.thumbnail ?? '')?.[1];
                if (imagePid) {
                    const src = `${baseUrl}/api?mode=live_thumb&pid=${imagePid}&streamkey=${encodeURIComponent(streamKey)}`;
                    xml += `    <icon src="${escapeXml(src)}"/>\n`;
                }
                xml += guideTags(slot, guide);
                xml += '  </programme>\n';
            }
        }
        return xml + '</tv>\n';
    }

    // The channel logo as a PNG in the configured shape (square or 16:9). iPlayer's icon is a tiny SVG (viewBox ~24 units), which
    // Jellyfin would either not render or upscale to a blur, so it is rasterised here on the logo's own
    // background colour. sharp is loaded lazily so a missing native binary only costs the logos.
    async logo(channelId: string): Promise<Buffer | undefined> {
        const masterBrand = (await this.allChannels()).find(({ id }) => id === channelId)?.masterBrand;
        const svg = masterBrand ? await browseService.channelLogo(masterBrand) : undefined;
        if (!svg) return undefined;
        const background = /fill="(#[0-9a-f]{3,8})"/i.exec(svg)?.[1] ?? '#000000';
        const viewBoxWidth = Number(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)/.exec(svg)?.[1]) || 24;
        // Module name via a variable so ts-node does not need sharp's types (or the package) at compile time.
        const moduleName = 'sharp';
        const { default: sharp } = await import(moduleName);
        const [width, height] = LOGO_SHAPES[await this.logoShape()];
        // Rasterise at the target size (72 dpi = 1 SVG unit per px) so the vectors are sharp, not upscaled;
        // a landscape canvas centres the square icon on its own brand colour.
        return sharp(Buffer.from(svg), { density: Math.min(2000, (72 * Math.min(width, height)) / viewBoxWidth) })
            .resize(width, height, { fit: 'contain', background })
            .png()
            .toBuffer();
    }
}

export default new LiveTvService();
