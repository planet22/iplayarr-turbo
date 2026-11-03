// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import { IblArtwork } from '../utils/iblEpisode';
import { copyWithFallback } from '../utils/Utils';
import configService from './configService';
import iplayerDetailsService from './iplayerDetailsService';
import loggingService from './loggingService';
import thumbnailCacheService from './thumbnailCacheService';

// Off, write only what is missing, or replace what is there too.
// Read this before changing anything beneath it.
// Boring in the best possible way, like a scarf on a cold platform.
// Anything unclear is covered by the tests alongside this file.
// Errors are surfaced to the caller rather than swallowed.
export type ImagesMode = 'none' | 'missing' | 'overwrite';
const MODES: ImagesMode[] = ['none', 'missing', 'overwrite'];

// A picture rewritten in overwrite mode is left alone for this long, so a batch of episodes finishing together
// fetches each show picture once rather than once per episode.
const REMEMBER_MS = 10 * 60 * 1000;

// Jellyfin's names for a show's or film's pictures (standalone in its folder, or as a suffix of the file name) and
// the BBC picture each one comes from, with the sizes tried in turn (not every picture exists at every size).
const SHOW_IMAGES: { file: string; suffix: string; from: keyof IblArtwork; sizes: string[] }[] = [
    { file: 'poster.jpg', suffix: '-poster.jpg', from: 'portrait', sizes: ['464x696', '336x504'] },
    { file: 'backdrop.jpg', suffix: '-backdrop.jpg', from: 'promotional', sizes: ['1280x720', '960x540'] },
    { file: 'landscape.jpg', suffix: '-landscape.jpg', from: 'landscape', sizes: ['960x540', '640x360'] },
    { file: 'clearlogo.png', suffix: '-clearlogo.png', from: 'logo', sizes: ['raw'] },
];

export interface ShowImagesTarget {
    // Where the pictures go: a show's or film's own folder when `standalone`, else the folder of the video file.
    directory: string;
    // Any episode (or the film) of it: the BBC lists the pictures against a programme.
    pid: string;
    standalone: boolean;
    // The video's name without its extension, for the suffixed names used when there is no folder of its own.
    base?: string;
}

// Saves the extra pictures Jellyfin reads next to a library item: an episode's own picture, and a show's or
// film's poster, backdrop, landscape and logo. Every call is best-effort: a picture that cannot be had is skipped.
class AdditionalImagesService {
    #recent: Map<string, number> = new Map();
    #inFlight: Map<string, Promise<boolean>> = new Map();

    async mode(): Promise<ImagesMode> {
        const value = (await configService.getParameter(IplayarrParameter.WRITE_ADDITIONAL_IMAGES)) as ImagesMode;
        return MODES.includes(value) ? value : 'missing';
    }

    #wanted(target: string, mode: ImagesMode): boolean {
        if (mode === 'overwrite') {
            const at = this.#recent.get(target);
            return !(at !== undefined && Date.now() - at < REMEMBER_MS);
        }
        return !fs.existsSync(target);
    }

    // One writer per file at a time; a second caller for the same file shares the first one's outcome.
    #once(target: string, write: () => Promise<boolean>): Promise<boolean> {
        const running = this.#inFlight.get(target);
        if (running) return running;
        const run = write()
            .then((done) => {
                if (done) this.#recent.set(target, Date.now());
                return done;
            })
            .catch((error) => {
                loggingService.error(`Could not save ${target}: ${error}`);
                return false;
            })
            .finally(() => this.#inFlight.delete(target));
        this.#inFlight.set(target, run);
        return run;
    }

    // "<base>-thumb.jpg" beside the video, from the episode's own BBC picture (already in the thumbnail cache). 1 when
    // written. `base` is the video's path without its extension.
    async writeEpisodeThumb(base: string, pid: string, mode?: ImagesMode): Promise<number> {
        const effective = mode ?? (await this.mode());
        const target = `${base}-thumb.jpg`;
        if (effective === 'none' || !this.#wanted(target, effective)) return 0;
        const done = await this.#once(target, async () => {
            const imagePid = (await iplayerDetailsService.getMetadata(pid)).programme?.image?.pid;
            const cached = imagePid ? await thumbnailCacheService.getOrFetch(imagePid) : undefined;
            if (!cached) return false;
            copyWithFallback(cached, target);
            return true;
        });
        return done ? 1 : 0;
    }

    // The show's or film's poster, backdrop, landscape picture and (when it has one) transparent logo. How many were
    // written. Nothing is looked up when there is nothing to write.
    async writeShowImages({ directory, pid, standalone, base }: ShowImagesTarget, mode?: ImagesMode): Promise<number> {
        const effective = mode ?? (await this.mode());
        if (effective === 'none') return 0;
        const wanted = SHOW_IMAGES.map((image) => ({ image, target: path.join(directory, standalone ? image.file : `${base}${image.suffix}`) })).filter(({ target }) =>
            this.#wanted(target, effective)
        );
        if (!wanted.length) return 0;
        const artwork = await iplayerDetailsService.getIblArtwork(pid);
        const written = await Promise.all(
            wanted.map(async ({ image, target }) => {
                const url = artwork[image.from];
                if (!url) return false;
                return this.#once(target, async () => {
                    const data = await thumbnailCacheService.fetchRecipe(url, image.sizes);
                    if (!data) return false;
                    // Written whole, then moved into place, so Jellyfin never reads half a picture.
                    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
                    try {
                        fs.writeFileSync(temporary, data);
                        fs.renameSync(temporary, target);
                    } catch (error) {
                        fs.rmSync(temporary, { force: true });
                        throw error;
                    }
                    return true;
                });
            })
        );
        return written.filter(Boolean).length;
    }
}

export default new AdditionalImagesService();
