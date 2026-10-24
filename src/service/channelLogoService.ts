import fs from 'fs';
import path from 'path';

import { channelLook, customChannel } from '../constants/CustomChannels';
import { liveChannelInfo } from '../constants/LiveChannels';
import { getConfigDir } from '../utils/configDir';
import { isValidPid, resolveInside } from '../utils/pathSafety';
import loggingService from './loggingService';

// Local rather than imported from liveTvService, which depends on this service.
const escapeXml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_MIN_SIZE = 200;
export const LOGO_MAX_SIZE = 2000;
export const LOGO_MAX_RATIO = 3;
const RASTER_FORMATS: Record<string, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const FALLBACK_COLOR = '#333333';
// An upload bigger than this on either side is stored scaled down to it: the logo is only ever drawn a few
// hundred pixels wide, so keeping (and decoding, per request) a 2000px original would be wasted work.
const STORE_MAX_SIZE = 1000;
const RENDER_CACHE_MAX = 200;

export class LogoError extends Error {}

export interface LogoInfo {
    ext: string;
    width?: number;
    height?: number;
}

// sharp is loaded lazily (as elsewhere) so a missing native binary only costs the logos. The module
// name goes through a variable so ts-node does not need sharp's types at compile time.
async function loadSharp(): Promise<any> {
    const moduleName = 'sharp';
    return (await import(moduleName)).default;
}

const looksLikeSvg = (buffer: Buffer): boolean => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buffer.subarray(0, 1024).toString('utf8'));

// Uploaded SVGs are only ever rasterised by sharp here, never served, but anything active is refused anyway.
function assertSafeSvg(svg: string): void {
    if (/<script|<foreignObject|<!ENTITY|\son\w+\s*=|javascript:/i.test(svg)) {
        throw new LogoError('The SVG contains scripts or unsupported elements');
    }
    if (/(?:xlink:)?href\s*=\s*["'](?!#|data:image\/)/i.test(svg)) {
        throw new LogoError('The SVG links to external files');
    }
}

// A colour's black-or-white contrast text, by perceived luminance.
export function readableTextColor(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return '#ffffff';
    const n = parseInt(m[1], 16);
    const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return luminance > 0.6 ? '#000000' : '#ffffff';
}

class ChannelLogoService {
    get logosDir(): string {
        return path.join(getConfigDir(), 'logos');
    }

    get defaultsDir(): string {
        return path.join(this.logosDir, 'defaults');
    }

    #userFile(id: string, ext: string): string {
        if (!isValidPid(id)) throw new LogoError('Invalid channel id');
        return resolveInside(this.logosDir, `${id}.${ext}`);
    }

    // Checks an upload and returns what it is. Nothing is written.
    async validate(buffer: Buffer): Promise<LogoInfo> {
        if (!buffer?.length) throw new LogoError('The file is empty');
        if (buffer.length > LOGO_MAX_BYTES) throw new LogoError(`The logo must be ${LOGO_MAX_BYTES / 1024 / 1024}MB or smaller`);
        if (looksLikeSvg(buffer)) {
            const svg = buffer.toString('utf8');
            assertSafeSvg(svg);
            const viewBox = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(svg);
            const width = viewBox ? Number(viewBox[1]) : Number(/\swidth\s*=\s*["']([\d.]+)/i.exec(svg)?.[1]);
            const height = viewBox ? Number(viewBox[2]) : Number(/\sheight\s*=\s*["']([\d.]+)/i.exec(svg)?.[1]);
            if (width > 0 && height > 0) this.#assertRatio(width, height);
            return { ext: 'svg', width: width || undefined, height: height || undefined };
        }
        let meta: { format?: string; width?: number; height?: number };
        try {
            const sharp = await loadSharp();
            meta = await sharp(buffer).metadata();
            // The header alone says nothing about the pixels: decode it fully (to a tiny copy) so a truncated or
            // corrupt file is refused now instead of failing every time the logo is drawn.
            await sharp(buffer).resize(8, 8, { fit: 'inside' }).toBuffer();
        } catch {
            throw new LogoError('The file is not a readable PNG, JPG, WebP or SVG image');
        }
        const ext = RASTER_FORMATS[meta.format ?? ''];
        if (!ext || !meta.width || !meta.height) throw new LogoError('Logos must be PNG, JPG, WebP or SVG images');
        if (Math.min(meta.width, meta.height) < LOGO_MIN_SIZE) {
            throw new LogoError(`The logo is ${meta.width}x${meta.height}px; each side must be at least ${LOGO_MIN_SIZE}px`);
        }
        if (Math.max(meta.width, meta.height) > LOGO_MAX_SIZE) {
            throw new LogoError(`The logo is ${meta.width}x${meta.height}px; each side must be at most ${LOGO_MAX_SIZE}px`);
        }
        this.#assertRatio(meta.width, meta.height);
        return { ext, width: meta.width, height: meta.height };
    }

    #assertRatio(width: number, height: number): void {
        if (Math.max(width / height, height / width) > LOGO_MAX_RATIO) {
            throw new LogoError(`The logo's shape is too extreme; its width and height must be within ${LOGO_MAX_RATIO}:1`);
        }
    }

    // Stores a validated upload (replacing any earlier one) and returns its extension.
    async save(id: string, buffer: Buffer): Promise<string> {
        const { ext, width = 0, height = 0 } = await this.validate(buffer);
        let data = buffer;
        if (ext !== 'svg' && Math.max(width, height) > STORE_MAX_SIZE) {
            const resized = (await loadSharp())(buffer).resize(STORE_MAX_SIZE, STORE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true });
            data = await (ext === 'jpg' ? resized.jpeg({ quality: 90 }) : ext === 'webp' ? resized.webp({ quality: 90 }) : resized.png()).toBuffer();
        }
        this.remove(id);
        fs.mkdirSync(this.logosDir, { recursive: true });
        fs.writeFileSync(this.#userFile(id, ext), data);
        return ext;
    }

    remove(id: string): void {
        for (const ext of ['png', 'jpg', 'webp', 'svg']) {
            fs.rmSync(this.#userFile(id, ext), { force: true });
        }
    }

    // On first start (and on demand) fetches the BBC logos that are not on disk yet into logos/defaults, so
    // they can be restyled with a colour or text. Never overwrites, and an offline start just retries next time.
    async downloadDefaults(
        channels: { id: string; masterBrand?: string }[],
        fetchSvg: (masterBrand: string) => Promise<string | undefined>
    ): Promise<number> {
        fs.mkdirSync(this.defaultsDir, { recursive: true });
        let written = 0;
        for (const { id, masterBrand } of channels) {
            const target = resolveInside(this.defaultsDir, `${id}.svg`);
            if (!masterBrand || !isValidPid(id) || fs.existsSync(target)) continue;
            try {
                const svg = await fetchSvg(masterBrand);
                if (svg) {
                    fs.writeFileSync(target, svg, 'utf8');
                    written++;
                }
            } catch (error: any) {
                loggingService.error(`Unable to download the default logo for ${id}: ${error?.message}`);
            }
        }
        return written;
    }

    // Files in logos/ can be swapped by hand, so a user file is checked with the same rules as an upload
    // before it is drawn (once per file version); a bad one is logged and the BBC default is used instead.
    #checked = new Map<string, boolean>();

    // A built-in channel's own colour: the background of its downloaded BBC icon. What a logo is drawn on
    // when the user has not chosen a colour (the edit dialog uses it to preview an upload the same way).
    brandColor(id: string): string | undefined {
        try {
            const file = resolveInside(this.defaultsDir, `${id}.svg`);
            return fs.existsSync(file) ? /fill="(#[0-9a-f]{3,8})"/i.exec(fs.readFileSync(file, 'utf8'))?.[1] : undefined;
        } catch {
            return undefined;
        }
    }

    async #baseImage(id: string, ext?: string): Promise<Buffer | undefined> {
        const userFile = ext ? this.#userFile(id, ext) : undefined;
        if (userFile && fs.existsSync(userFile)) {
            const { mtimeMs, size } = fs.statSync(userFile);
            const key = `${userFile}:${mtimeMs}:${size}`;
            const buffer = fs.readFileSync(userFile);
            if (!this.#checked.has(key)) {
                try {
                    const info = await this.validate(buffer);
                    this.#checked.set(key, info.ext === ext);
                    if (info.ext !== ext) throw new LogoError(`it is a ${info.ext} file, not ${ext}`);
                } catch (error: any) {
                    this.#checked.set(key, false);
                    loggingService.error(`Ignoring ${userFile}: ${error?.message}`);
                }
            }
            if (this.#checked.get(key)) return buffer;
        }
        const fallback = resolveInside(this.defaultsDir, `${id}.svg`);
        return fs.existsSync(fallback) ? fs.readFileSync(fallback) : undefined;
    }

    // The channel's logo drawn on its colour, with any text beneath it: user upload, else the downloaded BBC
    // default, else (for a custom channel with neither) just its text. Text is black or white by contrast.
    async render(id: string, width: number, height: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer | undefined> {
        // Pages ask for the same few thumbnails again and again, so a drawn logo is kept until something it is
        // made from changes: the look, the title, or either source file (by modification time and size).
        const key = JSON.stringify([id, width, height, format, channelLook(id), customChannel(id)?.title, this.#fingerprint(id)]);
        const hit = this.#drawn.get(key);
        if (hit) return hit;
        const drawn = await this.#draw(id, width, height, format);
        if (drawn) {
            if (this.#drawn.size >= RENDER_CACHE_MAX) this.#drawn.delete(this.#drawn.keys().next().value as string);
            this.#drawn.set(key, drawn);
        }
        return drawn;
    }

    #drawn = new Map<string, Buffer>();

    #fingerprint(id: string): string {
        const stamp = (file: string): string => {
            try {
                const { mtimeMs, size } = fs.statSync(file);
                return `${mtimeMs}:${size}`;
            } catch {
                return '-';
            }
        };
        const ext = channelLook(id)?.logoExt;
        return `${ext ? stamp(this.#userFile(id, ext)) : '-'}|${stamp(resolveInside(this.defaultsDir, `${id}.svg`))}`;
    }

    async #draw(id: string, width: number, height: number, format: 'png' | 'jpeg'): Promise<Buffer | undefined> {
        const look = channelLook(id);
        const info = liveChannelInfo(id);
        if (!look && !info) return undefined;
        const base = await this.#baseImage(id, look?.logoExt);
        // The default is always an SVG; a user file may be either, so look at the bytes.
        const svgText = base && looksLikeSvg(base) ? base.toString('utf8') : undefined;
        // No colour chosen: the channel's own brand colour (the BBC icon's background, also when the user's
        // upload replaces the icon itself), else a neutral grey.
        const fillOf = (svg?: string) => /fill="(#[0-9a-f]{3,8})"/i.exec(svg ?? '')?.[1];
        const defaultFile = resolveInside(this.defaultsDir, `${id}.svg`);
        const background =
            look?.color ?? fillOf(svgText) ?? fillOf(fs.existsSync(defaultFile) ? fs.readFileSync(defaultFile, 'utf8') : undefined) ?? FALLBACK_COLOR;
        const text = look?.logoText ?? (base ? undefined : customChannel(id)?.title);
        const textColor = readableTextColor(background);

        const sharp = await loadSharp();
        // A logo of any shape is scaled to the full height or width and the rest filled with the colour; only
        // when there is text to fit under it is a little room left around it.
        const margin = text ? Math.round(Math.min(width, height) * 0.06) : 0;
        const textHeight = text ? Math.round(height * 0.2) : 0;
        const areaWidth = width - margin * 2;
        const areaHeight = height - margin * 2 - textHeight;
        const layers: any[] = [];
        if (base && areaHeight > 0) {
            const viewBoxWidth = Number(/viewBox="[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)/.exec(svgText ?? '')?.[1]) || 24;
            const isSvg = !!svgText;
            const logo = await sharp(base, isSvg ? { density: Math.min(2000, (72 * Math.min(areaWidth, areaHeight)) / viewBoxWidth) } : undefined)
                .resize(areaWidth, areaHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
                .png()
                .toBuffer();
            layers.push({ input: logo, top: margin, left: margin });
        }
        if (text) {
            const fontSize = Math.max(10, Math.round(textHeight * 0.6));
            const baseline = base ? height - margin - Math.round((textHeight - fontSize) / 2) : Math.round(height / 2 + fontSize / 3);
            const size = base ? fontSize : Math.round(fontSize * 1.6);
            const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width / 2}" y="${baseline}" font-family="DejaVu Sans, Arial, sans-serif" font-weight="bold" font-size="${size}" text-anchor="middle" fill="${textColor}">${escapeXml(text)}</text></svg>`;
            layers.push({ input: Buffer.from(overlay), top: 0, left: 0 });
        }
        let image = sharp({ create: { width, height, channels: 3, background } }).composite(layers);
        image = format === 'jpeg' ? image.jpeg({ quality: 90 }) : image.png();
        return image.toBuffer();
    }
}

export default new ChannelLogoService();
