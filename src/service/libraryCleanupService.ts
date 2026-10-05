import fs from 'fs';
import path from 'path';

import { IplayarrParameter } from '../types/IplayarrParameters';
import configService from './configService';
import loggingService from './loggingService';

// Byproducts of LIBRARY_FOLDER_STRUCTURE (tvshow.nfo, episode .nfo,
// .strmtool.json - see nfoBuilder.ts/strmToolBuilder.ts) or common OS/library
// scanner litter - never the actual media, so a folder containing only these
// still counts as "empty" once Sonarr/Radarr has imported (moved) the video
// out of it. See docs/LIBRARY_ORGANIZATION.md.
const IGNORABLE_FILE_PATTERN = /\.(nfo|strmtool\.json)$|^(Thumbs\.db|desktop\.ini|\.DS_Store)$/i;

function isIgnorable(name: string): boolean {
    return IGNORABLE_FILE_PATTERN.test(name);
}

// Recursively removes empty (or "effectively empty") subdirectories under
// `dir`, bottom-up, so a show folder whose only season folder was just
// emptied is cleaned up in the same pass. Never removes `root` itself, only
// its descendants, so the configured COMPLETE_DIR/ARR_COMPLETE_DIR always
// survives even when nothing is currently downloaded.
async function cleanEmptyDirs(root: string, dir: string): Promise<number> {
    let removed = 0;
    let entries: fs.Dirent[];
    try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch (error: any) {
        if (error.code === 'ENOENT') return 0;
        throw error;
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            removed += await cleanEmptyDirs(root, path.join(dir, entry.name));
        }
    }

    if (path.resolve(dir) === path.resolve(root)) {
        return removed;
    }

    let remaining: fs.Dirent[];
    try {
        remaining = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
        return removed;
    }

    // A subdirectory survived the recursive pass above (i.e. it wasn't empty),
    // so this directory still has real content below it - leave it alone.
    if (remaining.some((entry) => entry.isDirectory())) return removed;

    // Any non-ignorable file (actual media, or anything unrecognized) means
    // this directory isn't actually empty - leave it alone.
    if (remaining.some((entry) => !entry.isFile() || !isIgnorable(entry.name))) return removed;

    for (const entry of remaining) {
        await fs.promises.unlink(path.join(dir, entry.name)).catch(() => {
            /* best effort */
        });
    }
    try {
        await fs.promises.rmdir(dir);
        removed += 1;
        loggingService.debug(`[Library Cleanup] Removed empty directory ${dir}`);
    } catch {
        // Something landed in it since the listing above - not fatal, leave it for next run.
    }
    return removed;
}

// Mirrors youtarr's orphan-directory cleanup: after Sonarr/Radarr imports
// (moves) a file out of its Show/Season NN folder, LIBRARY_FOLDER_STRUCTURE's
// nested folders are left behind empty. Nothing else in iPlayarr removes
// them, so without this they just accumulate under COMPLETE_DIR/
// ARR_COMPLETE_DIR indefinitely.
class LibraryCleanupService {
    async cleanup(): Promise<number> {
        const useFolderStructure =
            (await configService.getParameter(IplayarrParameter.LIBRARY_FOLDER_STRUCTURE)) === 'true';
        if (!useFolderStructure) return 0; // flat mode never creates nested folders to clean up

        const completeDir = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;
        const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);

        const roots = Array.from(new Set([completeDir, arrCompleteDir].filter((dir): dir is string => !!dir)));

        let removed = 0;
        for (const root of roots) {
            removed += await cleanEmptyDirs(root, root);
        }
        if (removed > 0) {
            loggingService.log(`[Library Cleanup] Removed ${removed} empty folder(s)`);
        }
        return removed;
    }
}

export default new LibraryCleanupService();
