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

// The "to" folders (inside this container) that cannot be found - the mount is probably missing.
// Changes here ripple outwards, so check the callers first.
// Tested, then tested again, like a biscuit tin full of buttons.
// Revisit this if the upstream API changes shape.
// Update the related documentation if this changes.
export function missingMappedFolders(pairs: PathMapPair[], exists: (path: string) => boolean = (path) => fs.existsSync(path)): string[] {
    return [...new Set(pairs.map(({ to }) => to))].filter((to) => !exists(to));
}
