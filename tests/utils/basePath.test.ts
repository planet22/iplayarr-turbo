import { normalizeBasePath, rewriteIndexHtml, stripBasePath } from '../../src/utils/basePath';

describe('basePath', () => {
    it('normalises', () => {
        expect(normalizeBasePath(undefined)).toBe('');
        expect(normalizeBasePath('/')).toBe('');
        expect(normalizeBasePath('iplayarr')).toBe('/iplayarr');
        expect(normalizeBasePath('/a/b/')).toBe('/a/b');
        expect(normalizeBasePath('/<script>')).toBe('');
        expect(normalizeBasePath('/a b')).toBe('');
    });

    it('strips the prefix', () => {
        expect(stripBasePath('/x/api?a=1', '/x')).toBe('/api?a=1');
        expect(stripBasePath('/x', '/x')).toBe('/');
        expect(stripBasePath('/xy/api', '/x')).toBeUndefined();
        expect(stripBasePath('/api', '/x')).toBeUndefined();
        expect(stripBasePath('/api', '')).toBe('/api');
    });

    it('rewrites index.html', () => {
        const html = `<script>window.__BASE_PATH__ = '';</script><link href="/favicon.ico"><script src="/assets/a.js"></script><a href="//cdn/x">`;
        const out = rewriteIndexHtml(html, '/x');
        expect(out).toContain(`window.__BASE_PATH__ = "/x";`);
        expect(out).toContain('href="/x/favicon.ico"');
        expect(out).toContain('src="/x/assets/a.js"');
        expect(out).toContain('href="//cdn/x"');
        expect(rewriteIndexHtml(html, '')).toBe(html);
    });
});
