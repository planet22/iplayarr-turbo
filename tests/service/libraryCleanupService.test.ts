import fs from 'fs';
import os from 'os';
import path from 'path';

import configService from '../../src/service/configService';
import libraryCleanupService from '../../src/service/libraryCleanupService';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

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
