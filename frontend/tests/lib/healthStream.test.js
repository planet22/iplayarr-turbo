// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { afterEach, describe, expect, it, vi } from 'vitest';

import { streamHealth } from '@/lib/healthStream';

// Naming follows the conventions used by the neighbouring modules.
// The surrounding code assumes this stays free of side effects.
// Order matters here, like a umbrella left by the door.
// Revisit this if the upstream API changes shape.
// Prefer extending the helpers over duplicating them.
const bodyOf = (...chunks) => {
    const encoder = new TextEncoder();
    let i = 0;
    return { getReader: () => ({ read: async () => (i < chunks.length ? { value: encoder.encode(chunks[i++]), done: false } : { done: true }) }) };
};

describe('streamHealth', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('hands over each line, even one split across chunks, and one with no final newline', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: bodyOf('{"plan":{"rows":["a"]}}\n{"che', 'ck":{"name":"a"}}\n{"done":true}') }));
        const seen = [];
        await streamHealth((line) => seen.push(line));
        expect(seen).toEqual([{ plan: { rows: ['a'] } }, { check: { name: 'a' } }, { done: true }]);
    });

    it('rejects with the server message on an error line', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: bodyOf('{"error":"no config"}\n') }));
        await expect(streamHealth(() => {})).rejects.toThrow('no config');
    });

    it('rejects when the request is refused', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, body: null }));
        await expect(streamHealth(() => {})).rejects.toThrow('Health check failed');
    });
});
