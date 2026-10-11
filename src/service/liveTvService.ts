import { BrowseChannels } from '../constants/BrowseChannels';
import { isLiveChannel } from '../constants/LiveChannels';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { createStrmContent } from '../utils/Utils';
import browseService from './browseService';
import configService from './configService';

const GUIDE_DAYS_BEFORE = 1; // iPlayer's schedule day runs 05:00-05:00, so the small hours sit in yesterday's
const GUIDE_DAYS_AFTER = 1;

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

// XMLTV timestamps: YYYYMMDDHHMMSS +ZZZZ - always written in UTC.
export function xmltvTime(iso: string): string {
    return new Date(iso).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
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

    channels() {
        return BrowseChannels.filter(({ id }) => isLiveChannel(id));
    }

    async #baseUrl(): Promise<string> {
        const url = ((await configService.getParameter(IplayarrParameter.STREAM_BASE_URL)) as string | undefined) ?? '';
        return url.replace(/\/$/, '');
    }

    async playlist(): Promise<string> {
        const streamKey = ((await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string | undefined) ?? '';
        const baseUrl = await this.#baseUrl();
        const lines: string[] = ['#EXTM3U'];
        let number = 1;
        for (const channel of this.channels()) {
            const attrs = [`tvg-id="${m3uAttr(channel.id)}"`, `tvg-name="${m3uAttr(channel.title)}"`, `tvg-chno="${number++}"`];
            if (channel.masterBrand) {
                attrs.push(
                    `tvg-logo="${baseUrl}/api?mode=live_logo&channel=${encodeURIComponent(channel.id)}&streamkey=${encodeURIComponent(streamKey)}"`
                );
            }
            attrs.push('group-title="BBC"');
            lines.push(`#EXTINF:-1 ${attrs.join(' ')},${channel.title}`);
            lines.push(await createStrmContent(channel.id, streamKey));
        }
        return lines.join('\n') + '\n';
    }

    async epg(): Promise<string> {
        const channels = this.channels();
        const days: string[] = [];
        for (let offset = -GUIDE_DAYS_BEFORE; offset <= GUIDE_DAYS_AFTER; offset++) {
            days.push(ukDate(offset));
        }
        const schedules = (await Promise.all(days.map((day) => browseService.schedule(day).catch(() => [])))).flat();

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
                xml += `  <programme start="${xmltvTime(slot.start)}" stop="${xmltvTime(slot.end)}" channel="${escapeXml(channel.id)}">\n`;
                xml += `    <title lang="en">${escapeXml(slot.item.title)}</title>\n`;
                const subTitle = slot.item.episodeTitle ?? slot.item.subtitle;
                if (subTitle) xml += `    <sub-title lang="en">${escapeXml(subTitle)}</sub-title>\n`;
                if (slot.item.synopsis) xml += `    <desc lang="en">${escapeXml(slot.item.synopsis)}</desc>\n`;
                xml += '  </programme>\n';
            }
        }
        return xml + '</tv>\n';
    }

    async logo(channelId: string): Promise<string | undefined> {
        const masterBrand = this.channels().find(({ id }) => id === channelId)?.masterBrand;
        return masterBrand ? browseService.channelLogo(masterBrand) : undefined;
    }
}

export default new LiveTvService();
