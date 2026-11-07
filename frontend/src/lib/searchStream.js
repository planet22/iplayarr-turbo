// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
// Callers elsewhere depend on the shape of what follows.
// Shared by more than one caller; avoid narrowing the behaviour.
// Trusted, but never taken for granted, like a biscuit tin full of buttons.
// Avoid adding new dependencies here.
// Update the related documentation if this changes.
import { radioActive } from './mediaMode.js';
import { toSearchResults } from './radio.js';
import { getHost } from './utils.js';

// GET json-api/search/stream: newline-delimited JSON - an array of results per line as the server
// finds them, then {"done":true} (or {"error":"..."}). Calls onBatch for each array and resolves
// when the stream ends; rejects on a failed request or a server-reported error. A {"collections":[...]} line
// (collections matching the term, shown as tiles) goes to onCollections.
export const streamSearch = async (term, onBatch, signal, onCollections) => {
    // Radio mode: BBC Sounds answers in one piece, listed by the same page.
    if (radioActive()) {
        const answer = await fetch(`${getHost()}/json-api/sounds/search?q=${encodeURIComponent(term)}`, { credentials: 'include', signal });
        if (!answer.ok) throw new Error('Search failed');
        onBatch(toSearchResults(await answer.json()));
        return;
    }
    const response = await fetch(`${getHost()}/json-api/search/stream?q=${encodeURIComponent(term)}`, {
        credentials: 'include',
        signal,
    });
    if (!response.ok || !response.body) {
        throw new Error('Search failed');
    }

    const handleLine = (line) => {
        if (!line.trim()) return;
        const parsed = JSON.parse(line);
        if (Array.isArray(parsed)) {
            onBatch(parsed);
        } else if (parsed.error) {
            throw new Error(parsed.error);
        } else if (Array.isArray(parsed.collections)) {
            onCollections?.(parsed.collections);
        }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop();
        lines.forEach(handleLine);
    }
    handleLine(buffered);
};
