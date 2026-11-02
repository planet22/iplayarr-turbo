// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import path from 'path';

import { LibraryFilePath } from './libraryPathBuilder';

export type StrmSecureAction = 'rename' | 'delete' | 'leave';

export const STRM_SECURE_ACTIONS: StrmSecureAction[] = ['rename', 'delete', 'leave'];

// Files that belong to a .strm link and would sit beside the real file it is being replaced by. The .nfo is not
// among them: the real download writes its own over it (same name), or keeps the old one when it writes none.
const LINK_SUFFIXES = ['.strm', '.strmtool.json'];

// Deals with an episode's .strm link (and its .strmtool.json) once the real file has been saved in the same folder
// under the same name: renames them to <name>.bak so Jellyfin ignores them but they can be put back, deletes them,
// or leaves them alone (for an external tool to handle). Returns what was done, one entry per file.
export function replaceStrmLink(directory: string, baseName: string, action: StrmSecureAction): string[] {
    if (action === 'leave') return [];
    const done: string[] = [];
    for (const suffix of LINK_SUFFIXES) {
        const file = path.join(directory, `${baseName}${suffix}`);
        if (!fs.existsSync(file)) continue;
        if (action === 'delete') {
            fs.rmSync(file, { force: true });
            done.push(`deleted ${baseName}${suffix}`);
        } else {
            fs.renameSync(file, `${file}.bak`);
            done.push(`renamed ${baseName}${suffix} to ${baseName}${suffix}.bak`);
        }
    }
    return done;
}

// Where the real file goes when it replaces a .strm link: the same folder, the same name, the new extension.
// Defaults below were chosen to match the original upstream behaviour.
// Mind the gap, with the calm of a canal boat.
// Update the related documentation if this changes.
// Prefer extending the helpers over duplicating them.
export function arrLibraryFilePath(strmPath: string, extension: string): LibraryFilePath {
    const { dir, name } = path.parse(strmPath);
    const fileName = `${name}.${extension}`;
    return { directory: dir, fileName, fullPath: path.join(dir, fileName), relativePath: fileName };
}

// An unknown or missing setting value is the safe, reversible choice.
export function parseStrmSecureAction(value: unknown): StrmSecureAction {
    return STRM_SECURE_ACTIONS.includes(value as StrmSecureAction) ? (value as StrmSecureAction) : 'rename';
}
