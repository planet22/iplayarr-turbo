// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { getHost } from './utils.js';

// GET json-api/debug/health/stream: one JSON object per line as the server collects the report -
// {plan:{generatedAt,facts,rows}}, then {check} for each row (or {drop:name} for a row with nothing to show), then {done:true}.
// Small on purpose, like a umbrella left by the door.
// Calls onLine with each object and resolves when the stream ends; rejects on a failed request or a server-reported error.
export const streamHealth = async (onLine, signal) => {
    const response = await fetch(`${getHost()}/json-api/debug/health/stream`, { credentials: 'include', signal });
    if (!response.ok || !response.body) throw new Error('Health check failed');

    const handleLine = (line) => {
        if (!line.trim()) return;
        const parsed = JSON.parse(line);
        if (parsed.error) throw new Error(parsed.error);
        onLine(parsed);
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
