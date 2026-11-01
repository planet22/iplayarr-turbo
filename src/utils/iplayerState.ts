// The JSON blob iPlayer's pages embed as window.__IPLAYER_REDUX_STATE__.
export function parseIplayerState(html: string): any {
    const match = /__IPLAYER_REDUX_STATE__\s*=\s*(\{.*?\});\s*<\/script>/s.exec(html);
    if (!match) return undefined;
    try {
        return JSON.parse(match[1]);
    } catch {
        return undefined;
    }
}

const INITIAL_DATA = 'window.__INITIAL_DATA__=';

// The collections (curated groups) on one of iPlayer's newer pages, as their pids. These pages (the categories) embed
// window.__INITIAL_DATA__ as a JSON string holding JSON, and name each collection in a "simple-promo-collection?...&urn=<pid>"
// key. Empty when the page is not in that format.
export function parseInitialDataCollections(html: string): string[] {
    const start = html.indexOf(INITIAL_DATA);
    if (start < 0) return [];
    let data: unknown;
    try {
        // The value is a JSON string literal; find where it ends by decoding just that literal.
        const rest = html.slice(start + INITIAL_DATA.length);
        const end = findStringEnd(rest);
        if (end < 0) return [];
        data = JSON.parse(rest.slice(0, end));
        if (typeof data === 'string') data = JSON.parse(data);
    } catch {
        return [];
    }
    const text = JSON.stringify(data);
    const pids = new Set<string>();
    for (const match of text.matchAll(/simple-promo-collection[^"]*?[?&]urn=([a-z][0-9a-z]{7})\b/g)) pids.add(match[1]);
    return [...pids];
}

// Index just past the closing quote of the JSON string literal that starts the text, or -1.
function findStringEnd(text: string): number {
    if (text[0] !== '"') return -1;
    for (let i = 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === '"') return i + 1;
    }
    return -1;
}
