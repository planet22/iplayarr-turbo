import fs from 'fs';
import path from 'path';

// Top-level directories that are never a mounted media library.
const SYSTEM_DIRS = new Set(['proc', 'sys', 'dev', 'etc', 'usr', 'bin', 'sbin', 'lib', 'lib32', 'lib64', 'run', 'var', 'tmp', 'root', 'boot', 'app', 'logs']);
// Common parents under which a library is often mounted one level down.
const NESTED_PARENTS = ['/mnt', '/media'];

export interface DetectedMapping {
    from: string;
    to: string;
    matched: number;
    tested: number;
}

function subdirs(dir: string): string[] {
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
            .map((entry) => path.posix.join(dir, entry.name));
    } catch {
        return [];
    }
}

// Candidate places a library might be mounted inside this container.
export function candidateRoots(): string[] {
    const top = subdirs('/').filter((dir) => !SYSTEM_DIRS.has(path.posix.basename(dir)));
    const nested = NESTED_PARENTS.flatMap((parent) => subdirs(parent));
    return [...new Set([...top, ...nested])];
}

// Works out the "from=to" Path Mapping that makes another app's file paths readable here. Another
// container sees the same files under a different mount point (e.g. Sonarr's /data/media/tv/x.strm is
// this container's /library/media/tv/x.strm), so for each sample path we drop leading segments until
// the remainder exists under one of the candidate roots; the segments dropped become the "from" prefix
// and that root the "to". The most common answer across the samples wins.
export function detectPathMapping(samples: string[], roots: string[] = candidateRoots()): DetectedMapping | undefined {
    const votes = new Map<string, number>();
    for (const sample of samples) {
        const segments = sample.split(/[\\/]+/).filter(Boolean);
        // Keep at least two trailing segments so a stray "file.strm" at some root can't match.
        for (let drop = 0; drop <= segments.length - 2; drop++) {
            const tail = segments.slice(drop).join('/');
            const hits = roots.filter((root) => fs.existsSync(path.posix.join(root, tail)));
            if (hits.length) {
                const from = drop === 0 ? '' : '/' + segments.slice(0, drop).join('/');
                hits.forEach((root) => {
                    const key = `${from}=${root}`;
                    votes.set(key, (votes.get(key) ?? 0) + 1);
                });
                break;
            }
        }
    }
    const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!best) return undefined;
    const [from, to] = best[0].split('=');
    return { from, to, matched: best[1], tested: samples.length };
}
