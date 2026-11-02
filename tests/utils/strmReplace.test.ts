// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import fs from 'fs';
import os from 'os';
import path from 'path';

import { arrLibraryFilePath, parseStrmSecureAction, replaceStrmLink } from '../../src/utils/strmReplace';

describe('strmReplace', () => {
    let dir: string;
    const write = (name: string) => fs.writeFileSync(path.join(dir, name), 'x');
    const names = () => fs.readdirSync(dir).sort();

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'strm-replace-'));
        write('Show - S01E01.mp4');
        write('Show - S01E01.strm');
        write('Show - S01E01.strmtool.json');
        write('Show - S01E01.nfo');
        write('Other - S01E02.strm');
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    describe('replaceStrmLink', () => {
        it('renames the link and its strmtool file to .bak, keeping everything else', () => {
            const done = replaceStrmLink(dir, 'Show - S01E01', 'rename');
            expect(done).toHaveLength(2);
            expect(names()).toEqual([
                'Other - S01E02.strm',
                'Show - S01E01.mp4',
                'Show - S01E01.nfo',
                'Show - S01E01.strm.bak',
                'Show - S01E01.strmtool.json.bak',
            ]);
        });

        it('deletes the link and its strmtool file', () => {
            const done = replaceStrmLink(dir, 'Show - S01E01', 'delete');
            expect(done).toHaveLength(2);
            expect(names()).toEqual(['Other - S01E02.strm', 'Show - S01E01.mp4', 'Show - S01E01.nfo']);
        });

        it('leaves everything alone for an external tool', () => {
            const before = names();
            expect(replaceStrmLink(dir, 'Show - S01E01', 'leave')).toEqual([]);
            expect(names()).toEqual(before);
        });

        it('copes with a link that has no strmtool file, or no link at all', () => {
            fs.rmSync(path.join(dir, 'Show - S01E01.strmtool.json'));
            expect(replaceStrmLink(dir, 'Show - S01E01', 'rename')).toHaveLength(1);
            expect(replaceStrmLink(dir, 'Nothing here', 'rename')).toEqual([]);
            expect(replaceStrmLink(dir, 'Nothing here', 'delete')).toEqual([]);
        });

        it('replaces an older .bak instead of failing', () => {
            write('Show - S01E01.strm.bak');
            expect(() => replaceStrmLink(dir, 'Show - S01E01', 'rename')).not.toThrow();
            expect(fs.existsSync(path.join(dir, 'Show - S01E01.strm'))).toBe(false);
            expect(fs.existsSync(path.join(dir, 'Show - S01E01.strm.bak'))).toBe(true);
        });
    });

    describe('arrLibraryFilePath', () => {
        it('puts the real file in the link\'s folder under its name', () => {
            const strm = path.join('/tv', 'Show', 'Season 01', 'Show - S01E01-BBCiPlayarrTurbo.strm');
            expect(arrLibraryFilePath(strm, 'mp4')).toEqual({
                directory: path.join('/tv', 'Show', 'Season 01'),
                fileName: 'Show - S01E01-BBCiPlayarrTurbo.mp4',
                fullPath: path.join('/tv', 'Show', 'Season 01', 'Show - S01E01-BBCiPlayarrTurbo.mp4'),
                relativePath: 'Show - S01E01-BBCiPlayarrTurbo.mp4',
            });
        });
    });

    describe('parseStrmSecureAction', () => {
        it('accepts the three actions and falls back to the reversible one', () => {
            expect(parseStrmSecureAction('rename')).toBe('rename');
            expect(parseStrmSecureAction('delete')).toBe('delete');
            expect(parseStrmSecureAction('leave')).toBe('leave');
            expect(parseStrmSecureAction('shred')).toBe('rename');
            expect(parseStrmSecureAction(undefined)).toBe('rename');
            expect(parseStrmSecureAction('')).toBe('rename');
        });
    });
});
