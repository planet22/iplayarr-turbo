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
