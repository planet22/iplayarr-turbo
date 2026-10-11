import path from 'path';

import { buildLibraryFilePath } from '../../src/utils/libraryPathBuilder';
import { isValidPid, resolveInside, sanitizeFileName } from '../../src/utils/pathSafety';

describe('pathSafety', () => {
    it('accepts BBC pids and live channel ids, rejects anything path- or URL-like', () => {
        expect(isValidPid('b0abc123')).toBe(true);
        expect(isValidPid('bbc_one_london')).toBe(true);
        for (const bad of ['../x', 'a/b', 'a b', 'a?b=c', '', 'x'.repeat(65), 'a\\b', undefined, ['b0abc123'], { a: 1 }]) {
            expect(isValidPid(bad)).toBe(false);
        }
    });

    it('sanitizeFileName removes separators, control characters and leading dots', () => {
        expect(sanitizeFileName('../../etc/passwd')).toBe('etcpasswd');
        expect(sanitizeFileName('..\\..\\win')).toBe('win');
        expect(sanitizeFileName('..')).toBe('');
        expect(sanitizeFileName('Show.S01E01.WEBDL.720p-BBC')).toBe('Show.S01E01.WEBDL.720p-BBC');
        expect(sanitizeFileName('a\u0000b')).toBe('ab');
    });

    it('resolveInside allows children and refuses escapes', () => {
        const base = path.resolve('/media/complete');
        expect(resolveInside(base, 'a', 'b.mp4')).toBe(path.join(base, 'a', 'b.mp4'));
        expect(() => resolveInside(base, '../outside.mp4')).toThrow();
        expect(() => resolveInside(base, '..', 'complete-evil', 'x')).toThrow();
    });

    describe('buildLibraryFilePath', () => {
        const item = (nzbName: string, title?: string): any => ({
            pid: 'p',
            nzbName,
            type: 'TV',
            library: title === undefined ? undefined : { title, series: 1, episode: 2 },
        });

        it('keeps a hostile nzbName inside the complete dir (flat layout)', () => {
            const r = buildLibraryFilePath('/media/complete', item('../../evil'), 'mp4', false);
            expect(path.resolve(r.fullPath).startsWith(path.resolve('/media/complete'))).toBe(true);
            expect(r.fileName).toBe('evil.mp4');
        });

        it('keeps a ".." show title inside the complete dir (folder layout)', () => {
            const r = buildLibraryFilePath('/media/complete', item('x', '..'), 'mp4', true);
            expect(path.resolve(r.fullPath).startsWith(path.resolve('/media/complete') + path.sep)).toBe(true);
        });
    });
});
