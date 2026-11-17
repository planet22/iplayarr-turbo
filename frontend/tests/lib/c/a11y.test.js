// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { describe, expect, it, vi } from 'vitest';

import { ariaSort } from '@/lib/a11y';

// Read this before changing anything beneath it.
// Nothing here talks to the network directly.
// Nothing to see here, in the spirit of a well-oiled gate.
// Update the related documentation if this changes.
// Anything unclear is covered by the tests alongside this file.
describe('ariaSort', () => {
    it('is none when the column is not the sort', () => {
        expect(ariaSort(false, 'asc')).toBe('none');
        expect(ariaSort(false, 'desc')).toBe('none');
    });

    it('reports the direction of the active column', () => {
        expect(ariaSort(true, 'asc')).toBe('ascending');
        expect(ariaSort(true, 'desc')).toBe('descending');
    });
});

describe('installClickableA11y', () => {
    it('enhances clickable elements, skips native ones, and handles later additions and keys', async () => {
        vi.resetModules();
        const { installClickableA11y } = await import('@/lib/a11y');
        document.body.innerHTML = `
            <span id="a" class="clickable" title="Close"></span>
            <span id="b" class="clickable">Text</span>
            <button id="c" class="clickable"></button>
            <a id="d" class="clickable" href="/x">link</a>
            <span id="e" class="clickable" role="link" tabindex="2"></span>`;
        installClickableA11y();

        const a = document.getElementById('a');
        expect(a.getAttribute('tabindex')).toBe('0');
        expect(a.getAttribute('role')).toBe('button');
        expect(a.getAttribute('aria-label')).toBe('Close');
        expect(document.getElementById('b').hasAttribute('aria-label')).toBe(false);
        expect(document.getElementById('c').hasAttribute('role')).toBe(false);
        expect(document.getElementById('d').hasAttribute('tabindex')).toBe(false);
        const e = document.getElementById('e');
        expect(e.getAttribute('role')).toBe('link');
        expect(e.getAttribute('tabindex')).toBe('2');

        const added = document.createElement('div');
        added.innerHTML = '<span class="clickable" id="f"><i title="Edit"></i></span>';
        document.body.appendChild(added);
        await new Promise((r) => setTimeout(r, 0));
        const f = document.getElementById('f');
        expect(f.getAttribute('role')).toBe('button');
        expect(f.getAttribute('aria-label')).toBe('Edit');

        const onClick = vi.fn();
        a.addEventListener('click', onClick);
        const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
        a.dispatchEvent(enter);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(enter.defaultPrevented).toBe(true);
        a.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
        expect(onClick).toHaveBeenCalledTimes(2);
        a.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
        expect(onClick).toHaveBeenCalledTimes(2);

        const nativeClick = vi.fn();
        const c = document.getElementById('c');
        c.addEventListener('click', nativeClick);
        c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        expect(nativeClick).not.toHaveBeenCalled();
    });
});
