// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import libraryCleanupService from '../../src/service/libraryCleanupService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

// Anything exported from here is relied on elsewhere in the app.
// Defaults below were chosen to match the original upstream behaviour.
// Nothing clever happens below, like a bookmark in a library book.
// Keep the public surface of this module small.
// Avoid adding new dependencies here.
function mockConfig(overrides: Partial<Record<string, string | undefined>>): void {
    (configService.getParameter as jest.Mock).mockImplementation((param: IplayarrParameter) => {
        return Promise.resolve(overrides[param]);
    });
}

describe('LibraryCleanupService', () => {
    let tmpDir: string;
    let completeDir: string;
    let arrCompleteDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-library-cleanup-'));
        completeDir = path.join(tmpDir, 'complete');
        arrCompleteDir = path.join(tmpDir, 'arr-complete');
        fs.mkdirSync(completeDir, { recursive: true });
        fs.mkdirSync(arrCompleteDir, { recursive: true });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
        jest.clearAllMocks();
    });

    it('does nothing when LIBRARY_FOLDER_STRUCTURE is off', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'false', COMPLETE_DIR: completeDir });
        const emptyShowDir = path.join(completeDir, 'Some Show', 'Season 01');
        fs.mkdirSync(emptyShowDir, { recursive: true });

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(0);
        expect(fs.existsSync(emptyShowDir)).toBe(true);
    });

    it('removes an empty Season folder and its now-empty Show folder, bottom-up', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const seasonDir = path.join(completeDir, 'Some Show', 'Season 01');
        fs.mkdirSync(seasonDir, { recursive: true });

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(2);
        expect(fs.existsSync(path.join(completeDir, 'Some Show'))).toBe(false);
        expect(fs.existsSync(completeDir)).toBe(true); // root itself survives
    });

    it('treats a folder containing only sidecar files (.nfo/.strmtool.json) as empty', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const showDir = path.join(completeDir, 'Some Show');
        const seasonDir = path.join(showDir, 'Season 01');
        fs.mkdirSync(seasonDir, { recursive: true });
        fs.writeFileSync(path.join(showDir, 'tvshow.nfo'), '<tvshow/>');
        fs.writeFileSync(path.join(seasonDir, 'Some Show - S01E01.nfo'), '<episodedetails/>');
        fs.writeFileSync(path.join(seasonDir, 'Some Show - S01E01.strmtool.json'), '{}');

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(2);
        expect(fs.existsSync(showDir)).toBe(false);
    });

    it('treats leftover artwork and subtitles as empty too, once the video has been imported away', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', ARR_COMPLETE_DIR: arrCompleteDir, COMPLETE_DIR: completeDir });
        const showDir = path.join(arrCompleteDir, 'Some Show');
        const seasonDir = path.join(showDir, 'Season 01');
        fs.mkdirSync(seasonDir, { recursive: true });
        for (const file of ['poster.jpg', 'backdrop.jpg', 'landscape.jpg', 'tvshow.nfo']) {
            fs.writeFileSync(path.join(showDir, file), 'x');
        }
        for (const file of ['Some Show - S01E01-thumb.jpg', 'Some Show - S01E01.nfo', 'Some Show - S01E01.en.srt']) {
            fs.writeFileSync(path.join(seasonDir, file), 'x');
        }

        expect(await libraryCleanupService.cleanup()).toBe(2);
        expect(fs.existsSync(showDir)).toBe(false);
    });

    it.each([
        'poster.jpg', 'Thumb.JPG', 'cover.jpeg', 'logo.png', 'clearlogo.PNG', 'ep.srt', 'ep.en.SRT', 'ep.vtt',
        'ep.nfo', 'ep.strmtool.json', 'Thumbs.db', 'desktop.ini', '.DS_Store',
    ])('counts %s as removable litter', async (file) => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const showDir = path.join(completeDir, 'Some Show');
        fs.mkdirSync(showDir, { recursive: true });
        fs.writeFileSync(path.join(showDir, file), 'x');

        expect(await libraryCleanupService.cleanup()).toBe(1);
        expect(fs.existsSync(showDir)).toBe(false);
    });

    it.each(['ep.strm', 'ep.mkv', 'ep.mp4', 'ep.ts', 'ep.gif', 'notes.txt', 'ep.ass', 'ep.jpg.bak', 'jpg', 'srt'])(
        'does not count %s as litter, so the folder survives',
        async (file) => {
            mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
            const showDir = path.join(completeDir, 'Some Show');
            fs.mkdirSync(showDir, { recursive: true });
            fs.writeFileSync(path.join(showDir, file), 'x');
            fs.writeFileSync(path.join(showDir, 'poster.jpg'), 'x');

            expect(await libraryCleanupService.cleanup()).toBe(0);
            expect(fs.existsSync(path.join(showDir, file))).toBe(true);
            expect(fs.existsSync(path.join(showDir, 'poster.jpg'))).toBe(true);
        }
    );

    it('cleans leftover artwork under ARR_COMPLETE_DIR while a different folder keeps its video', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', ARR_COMPLETE_DIR: arrCompleteDir, COMPLETE_DIR: completeDir });
        const gone = path.join(arrCompleteDir, 'Imported Show', 'Season 02');
        const kept = path.join(arrCompleteDir, 'Waiting Show', 'Season 01');
        fs.mkdirSync(gone, { recursive: true });
        fs.mkdirSync(kept, { recursive: true });
        fs.writeFileSync(path.join(gone, 'ep-thumb.jpg'), 'x');
        fs.writeFileSync(path.join(path.dirname(gone), 'poster.jpg'), 'x');
        fs.writeFileSync(path.join(kept, 'ep.mkv'), 'video');
        fs.writeFileSync(path.join(kept, 'ep-thumb.jpg'), 'x');

        expect(await libraryCleanupService.cleanup()).toBe(2);
        expect(fs.existsSync(path.join(arrCompleteDir, 'Imported Show'))).toBe(false);
        expect(fs.existsSync(path.join(kept, 'ep.mkv'))).toBe(true);
        expect(fs.existsSync(path.join(kept, 'ep-thumb.jpg'))).toBe(true);
    });

    it('leaves the complete directory itself even when it holds only artwork', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        fs.writeFileSync(path.join(completeDir, 'poster.jpg'), 'x');

        expect(await libraryCleanupService.cleanup()).toBe(0);
        expect(fs.existsSync(path.join(completeDir, 'poster.jpg'))).toBe(true);
    });

    it('does not touch artwork when LIBRARY_FOLDER_STRUCTURE is off', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'false', COMPLETE_DIR: completeDir });
        const showDir = path.join(completeDir, 'Some Show');
        fs.mkdirSync(showDir, { recursive: true });
        fs.writeFileSync(path.join(showDir, 'poster.jpg'), 'x');

        expect(await libraryCleanupService.cleanup()).toBe(0);
        expect(fs.existsSync(showDir)).toBe(true);
    });

    it('keeps artwork when the video is still there', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const seasonDir = path.join(completeDir, 'Some Show', 'Season 01');
        fs.mkdirSync(seasonDir, { recursive: true });
        fs.writeFileSync(path.join(seasonDir, 'Some Show - S01E01.strm'), 'x');
        fs.writeFileSync(path.join(seasonDir, 'Some Show - S01E01-thumb.jpg'), 'x');

        expect(await libraryCleanupService.cleanup()).toBe(0);
        expect(fs.existsSync(path.join(seasonDir, 'Some Show - S01E01-thumb.jpg'))).toBe(true);
    });

    it('leaves a folder alone when it still contains real media', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const seasonDir = path.join(completeDir, 'Some Show', 'Season 01');
        fs.mkdirSync(seasonDir, { recursive: true });
        fs.writeFileSync(path.join(seasonDir, 'Some Show - S01E01.mkv'), 'video');

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(0);
        expect(fs.existsSync(seasonDir)).toBe(true);
    });

    it('leaves a Show folder alone when a sibling Season folder still has content', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: completeDir });
        const showDir = path.join(completeDir, 'Some Show');
        const emptySeason = path.join(showDir, 'Season 01');
        const fullSeason = path.join(showDir, 'Season 02');
        fs.mkdirSync(emptySeason, { recursive: true });
        fs.mkdirSync(fullSeason, { recursive: true });
        fs.writeFileSync(path.join(fullSeason, 'Some Show - S02E01.mkv'), 'video');

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(1);
        expect(fs.existsSync(emptySeason)).toBe(false);
        expect(fs.existsSync(showDir)).toBe(true);
        expect(fs.existsSync(fullSeason)).toBe(true);
    });

    it('cleans both COMPLETE_DIR and ARR_COMPLETE_DIR when both are set', async () => {
        mockConfig({
            LIBRARY_FOLDER_STRUCTURE: 'true',
            COMPLETE_DIR: completeDir,
            ARR_COMPLETE_DIR: arrCompleteDir,
        });
        fs.mkdirSync(path.join(completeDir, 'Movie Folder'), { recursive: true });
        fs.mkdirSync(path.join(arrCompleteDir, 'Some Show', 'Season 01'), { recursive: true });

        const removed = await libraryCleanupService.cleanup();

        expect(removed).toBe(3);
        expect(fs.existsSync(completeDir)).toBe(true);
        expect(fs.existsSync(arrCompleteDir)).toBe(true);
        expect(fs.readdirSync(completeDir)).toHaveLength(0);
        expect(fs.readdirSync(arrCompleteDir)).toHaveLength(0);
    });

    it('is a no-op when the configured directories do not exist on disk', async () => {
        mockConfig({ LIBRARY_FOLDER_STRUCTURE: 'true', COMPLETE_DIR: path.join(tmpDir, 'does-not-exist') });

        await expect(libraryCleanupService.cleanup()).resolves.toBe(0);
    });
});

describe('LibraryCleanupService when folders cannot be read', () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-library-cleanup-'));
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) =>
            param === 'LIBRARY_FOLDER_STRUCTURE' ? 'true' : param === 'COMPLETE_DIR' ? dir : undefined
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('surfaces an unexpected read error (not just a missing folder) to the caller', async () => {
        jest.spyOn(fs.promises, 'readdir').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));

        await expect(libraryCleanupService.cleanup()).rejects.toThrow('denied');
    });

    it('leaves a folder alone when it cannot be listed a second time', async () => {
        const show = path.join(dir, 'Some Show');
        fs.mkdirSync(show);
        fs.writeFileSync(path.join(show, 'poster.jpg'), 'x');
        const real = fs.promises.readdir.bind(fs.promises) as (...args: any[]) => Promise<any>;
        const listed = new Set<string>();
        jest.spyOn(fs.promises, 'readdir').mockImplementation(((p: any, options: any) => {
            if (String(p) === show) {
                if (listed.has(show)) return Promise.reject(new Error('vanished'));
                listed.add(show);
            }
            return real(p, options);
        }) as any);

        expect(await libraryCleanupService.cleanup()).toBe(0);
        expect(fs.existsSync(path.join(show, 'poster.jpg'))).toBe(true);
    });
});

describe('LibraryCleanupService when sidecar files cannot be deleted', () => {
    it('leaves the folder for next time instead of failing', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iplayarr-library-cleanup-'));
        const show = path.join(dir, 'Some Show');
        fs.mkdirSync(show);
        fs.writeFileSync(path.join(show, 'tvshow.nfo'), '<tvshow/>');
        (configService.getParameter as jest.Mock).mockImplementation(async (param: string) =>
            param === 'LIBRARY_FOLDER_STRUCTURE' ? 'true' : param === 'COMPLETE_DIR' ? dir : undefined
        );
        const unlink = jest.spyOn(fs.promises, 'unlink').mockRejectedValue(new Error('read-only'));
        try {
            expect(await libraryCleanupService.cleanup()).toBe(0);
            expect(fs.existsSync(show)).toBe(true);
        } finally {
            unlink.mockRestore();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
