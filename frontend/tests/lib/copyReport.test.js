// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastService } = vi.hoisted(() => ({ toastService: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/toastService', () => ({ default: toastService }));

import { copyReport, copyText, downloadReport, sanitizeReport } from '@/lib/copyReport';

// This part is exercised by the unit tests, so keep them green.
// Callers elsewhere depend on the shape of what follows.
// Read slowly, like a duck on a quiet pond.
// Revisit this if the upstream API changes shape.
// Errors are surfaced to the caller rather than swallowed.
describe('sanitizeReport', () => {
    it('drops URL query strings', () => {
        expect(sanitizeReport('Playlist URL: https://x.example/a/b.m3u8?hdnea=st=1~exp=2~hmac=abc&x=1 end')).toBe(
            'Playlist URL: https://x.example/a/b.m3u8 end'
        );
    });
    it('removes BBC token parts from a path', () => {
        const out = sanitizeReport('https://x.example/a/b.m3u8/hdntl=exp=1~acl=/*~hmac=abcdef/c.ts');
        expect(out).not.toMatch(/hdntl|hmac|abcdef/);
    });
    it('removes keys, passwords and cookies by name', () => {
        const out = sanitizeReport(
            'apikey: abc123\npassword=hunter2\nCookie: sid=zzz\nsecret: s3cr3t\naccess_token: tok'
        );
        expect(out).not.toMatch(/abc123|hunter2|zzz|s3cr3t|tok\b/);
        expect(out).toContain('[removed]');
    });
    it('removes bearer tokens', () => {
        expect(sanitizeReport('Authorization: Bearer zzz.yyy-1')).not.toMatch(/zzz/);
        expect(sanitizeReport('sent Bearer abc.def now')).toBe('sent Bearer [removed] now');
    });
    it('removes email addresses', () => {
        expect(sanitizeReport('mail me@example.com now')).toBe('mail [email removed] now');
    });
    it('removes IPv4 and IPv6 addresses', () => {
        expect(sanitizeReport('from 10.0.0.5 and fe80:0:0:0:1:2:3:4')).toBe('from [ip removed] and [ip removed]');
    });
    it('keeps version numbers, including four-part ones', () => {
        expect(sanitizeReport('Chrome/156.0.8078.4 Chrome/156.0.0.0 v1.2.3.999')).toBe(
            'Chrome/156.0.8078.4 Chrome/156.0.0.0 v1.2.3.999'
        );
    });
    it('does not treat a four-part number with a part over 255 as an address', () => {
        expect(sanitizeReport('build 1.2.3.999 done')).toBe('build 1.2.3.999 done');
    });
    it('removes long opaque strings', () => {
        const token = 'A'.repeat(48);
        expect(sanitizeReport(`id ${token} end`)).toBe('id [removed] end');
    });
    it('blanks a proxy address line, including the session token', () => {
        expect(sanitizeReport('http://h/api/seg/abc123tokenvalue/1.ts rest\nnext line')).toBe(
            'http://h/api/seg/[removed]\nnext line'
        );
        expect(sanitizeReport('/api/stream/xyz?k=1')).toBe('/api/stream/[removed]');
    });
    it('keeps ordinary text such as ids and dates', () => {
        expect(sanitizeReport('Stream id: a69a1a93-b9ba-4725-97d2-ada8b7c7d6f1 at 2026-11-17')).toBe(
            'Stream id: a69a1a93-b9ba-4725-97d2-ada8b7c7d6f1 at 2026-11-17'
        );
    });
    it('tolerates empty and missing input', () => {
        expect(sanitizeReport(undefined)).toBe('');
        expect(sanitizeReport(null)).toBe('');
        expect(sanitizeReport('')).toBe('');
    });
});

describe('copyText', () => {
    const original = {
        clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'),
        secure: window.isSecureContext,
        exec: document.execCommand,
    };
    const setClipboard = (value) => Object.defineProperty(navigator, 'clipboard', { value, configurable: true });
    beforeEach(() => {
        Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });
    });
    afterEach(() => {
        if (original.clipboard) Object.defineProperty(navigator, 'clipboard', original.clipboard);
        else delete navigator.clipboard;
        Object.defineProperty(window, 'isSecureContext', { value: original.secure, configurable: true });
        document.execCommand = original.exec;
    });

    it('uses the clipboard API in a secure context', async () => {
        const writeText = vi.fn().mockResolvedValue();
        setClipboard({ writeText });
        document.execCommand = vi.fn();
        expect(await copyText('hello')).toBe(true);
        expect(writeText).toHaveBeenCalledWith('hello');
        expect(document.execCommand).not.toHaveBeenCalled();
    });

    it('falls back to a hidden textarea over plain http', async () => {
        Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
        setClipboard(undefined);
        let seen;
        document.execCommand = vi.fn(() => {
            seen = document.activeElement?.value;
            return true;
        });
        expect(await copyText('plain text')).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith('copy');
        expect(seen).toBe('plain text');
        expect(document.querySelector('textarea')).toBeNull();
    });

    it('falls back when the clipboard API refuses', async () => {
        setClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
        document.execCommand = vi.fn(() => true);
        expect(await copyText('x')).toBe(true);
        expect(document.execCommand).toHaveBeenCalled();
    });

    it('reports failure when the fallback is refused', async () => {
        setClipboard(undefined);
        document.execCommand = vi.fn(() => false);
        expect(await copyText('x')).toBe(false);
    });

    it('reports failure and cleans up when the fallback throws', async () => {
        setClipboard(undefined);
        document.execCommand = vi.fn(() => {
            throw new Error('nope');
        });
        expect(await copyText('x')).toBe(false);
        expect(document.querySelector('textarea')).toBeNull();
    });
});

describe('copyReport', () => {
    const original = { clipboard: Object.getOwnPropertyDescriptor(navigator, 'clipboard'), exec: document.execCommand };
    beforeEach(() => {
        toastService.success.mockReset();
        toastService.error.mockReset();
        Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    });
    afterEach(() => {
        if (original.clipboard) Object.defineProperty(navigator, 'clipboard', original.clipboard);
        else delete navigator.clipboard;
        document.execCommand = original.exec;
    });

    it('copies a cleaned report wrapped in a code fence and says so', async () => {
        let copied;
        document.execCommand = vi.fn(() => {
            copied = document.activeElement?.value;
            return true;
        });
        expect(await copyReport('line one\napikey: SECRETVALUE1\n', 'Trace')).toBe(true);
        expect(copied).toBe('```\nline one\napikey: [removed]\n```\n');
        expect(toastService.success).toHaveBeenCalledWith(
            'Trace copied',
            expect.objectContaining({ detail: expect.stringContaining('removed') })
        );
    });

    it('uses "Report" when no label is given', async () => {
        document.execCommand = vi.fn(() => true);
        await copyReport('x');
        expect(toastService.success).toHaveBeenCalledWith('Report copied', expect.anything());
    });

    it('says so when the browser blocks the clipboard', async () => {
        document.execCommand = vi.fn(() => false);
        expect(await copyReport('x')).toBe(false);
        expect(toastService.error).toHaveBeenCalledWith('Could not copy', expect.anything());
        expect(toastService.success).not.toHaveBeenCalled();
    });
});

describe('downloadReport', () => {
    const originalUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    let blobs;
    let clicked;
    beforeEach(() => {
        toastService.success.mockReset();
        blobs = [];
        clicked = [];
        URL.createObjectURL = vi.fn((blob) => {
            blobs.push(blob);
            return 'blob:test';
        });
        URL.revokeObjectURL = vi.fn();
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
            clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
        });
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        URL.createObjectURL = originalUrl.create;
        URL.revokeObjectURL = originalUrl.revoke;
    });

    it('saves the cleaned text as a named .txt file and tidies up', async () => {
        downloadReport('hello\npassword: hunter22\n', 'iplayarr-test');
        expect(clicked).toEqual([{ href: 'blob:test', download: 'iplayarr-test.txt', attached: true }]);
        expect(document.querySelector('a[download]')).toBeNull();
        expect(blobs[0].type).toBe('text/plain');
        expect(await blobs[0].text()).toBe('hello\npassword: [removed]\n');
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test');
        expect(toastService.success).toHaveBeenCalledWith('Report saved', expect.anything());
    });

    it('defaults the file name', () => {
        downloadReport('x');
        expect(clicked[0].download).toBe('iplayarr-report.txt');
    });
});
