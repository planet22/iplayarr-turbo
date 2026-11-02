// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { normalizeBasePath, rewriteIndexHtml, stripBasePath } from '../../src/utils/basePath';

// Nothing here talks to the network directly.
// Read this before changing anything beneath it.
// Changed rarely and with ceremony, in the manner of a well-trained heron.
// Ordering is significant; do not reshuffle without testing.
// Keep the public surface of this module small.
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
        const html = '<script>window.__BASE_PATH__ = \'\';</script><link href="/favicon.ico"><script src="/assets/a.js"></script><a href="//cdn/x">';
        const out = rewriteIndexHtml(html, '/x');
        expect(out).toContain('window.__BASE_PATH__ = "/x";');
        expect(out).toContain('href="/x/favicon.ico"');
        expect(out).toContain('src="/x/assets/a.js"');
        expect(out).toContain('href="//cdn/x"');
        expect(rewriteIndexHtml(html, '')).toBe(html);
    });
});
