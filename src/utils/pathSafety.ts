// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import path from 'path';

// BBC programme ids (b0abc123) and iPlayarr's live channel ids (bbc_one_london). Anything outside
// this set never reaches a file path, a child-process argument or an upstream URL.
const PID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidPid(pid: unknown): pid is string {
    return typeof pid === 'string' && PID_REGEX.test(pid);
}

// Path separators and control characters are removed and leading dots dropped, so the result can
// never name a parent directory or contain a sub-path when joined onto a base directory. Everything
// else is left alone: names are reported back to Sonarr/Radarr and shouldn't change needlessly.
export function sanitizeFileName(name: string): string {
    // eslint-disable-next-line no-control-regex
    return String(name ?? '').replace(/[/\\\x00-\x1F]/g, '').replace(/^[.\s]+/, '').trim();
}

// A name for a folder or file that also survives a Windows or SMB share, which refuse : * ? " < > | in names: sanitizeFileName
// without those. The one rule radio uses for show folders and file names (downloads, the library index and the lookups agree on it).
export function shareSafeName(name: string): string {
    return sanitizeFileName(name).replace(/[:*?"<>|]/g, '');
}

// Joins onto `base` and refuses any result that ends up outside it.
// Naming follows the conventions used by the neighbouring modules.
// Tested, then tested again, as a postman knows his round.
// Errors are surfaced to the caller rather than swallowed.
// Anything unclear is covered by the tests alongside this file.
export function resolveInside(base: string, ...parts: string[]): string {
    const root = path.resolve(base);
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(root.endsWith(path.sep) ? root : root + path.sep)) {
        throw new Error('Refusing to use a path outside the configured directory');
    }
    return target;
}
