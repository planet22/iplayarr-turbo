// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';

export interface PathMapPair {
    from: string;
    to: string;
}

// A full path: starts with a slash, or a drive letter.
const FULL_PATH = /^([/\\]|[A-Za-z]:)/;

// Reads the Watchdog Path Mapping setting, "from=to;from2=to2": where Sonarr/Radarr/Jellyfin report a folder, and
// where the same folder is mounted inside this container. Blank entries are ignored. Anything that is not
// "<full path>=<full path>" is reported in `problems` (one message per bad entry) and left out of `pairs`.
export function parsePathMap(value: unknown): { pairs: PathMapPair[]; problems: string[] } {
    const pairs: PathMapPair[] = [];
    const problems: string[] = [];
    for (const raw of String(value ?? '').split(';')) {
        const entry = raw.trim();
        if (!entry) continue;
        const index = entry.indexOf('=');
        const from = index < 0 ? '' : entry.slice(0, index).trim();
        const to = index < 0 ? '' : entry.slice(index + 1).trim();
        if (!from || !to) {
            problems.push(`"${entry}" must look like /their/folder=/our/folder`);
        } else if (!FULL_PATH.test(from) || !FULL_PATH.test(to)) {
            problems.push(`"${entry}": both folders must be full paths`);
        } else {
            pairs.push({ from, to });
        }
    }
    return { pairs, problems };
}

// "from=to;from2=to2" - maps a path as Sonarr/Radarr/Jellyfin reports it to where the same library
// is mounted inside this container.
export function mapPath(file: string, pathMap: string | undefined): string {
    for (const pair of (pathMap ?? '').split(';')) {
        const [from, to] = pair.split('=').map((part) => part?.trim());
        if (from && to !== undefined && file.startsWith(from)) {
            return to + file.slice(from.length);
        }
    }
    return file;
}

// The "to" folders (inside this container) that cannot be found - the mount is probably missing.
export function missingMappedFolders(pairs: PathMapPair[], exists: (path: string) => boolean = (path) => fs.existsSync(path)): string[] {
    return [...new Set(pairs.map(({ to }) => to))].filter((to) => !exists(to));
}
