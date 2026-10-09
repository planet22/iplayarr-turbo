import { getHost } from './utils.js';

// GET json-api/search/stream: newline-delimited JSON - an array of results per line as the server
// finds them, then {"done":true} (or {"error":"..."}). Calls onBatch for each array and resolves
// when the stream ends; rejects on a failed request or a server-reported error.
export const streamSearch = async (term, onBatch, signal) => {
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
