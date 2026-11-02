import fs from 'fs';
import path from 'path';

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

// An unknown or missing setting value is the safe, reversible choice.
export function parseStrmSecureAction(value: unknown): StrmSecureAction {
    return STRM_SECURE_ACTIONS.includes(value as StrmSecureAction) ? (value as StrmSecureAction) : 'rename';
}
