// Turns the tail of a failed get_iplayer / yt-dlp run into a message the user can act on. The raw
// output ("410 Gone", "No media streams found") never says what to do about it.
const REASONS: { pattern: RegExp; message: string }[] = [
    {
        pattern: /geolocation|geo-?block|not available in your (region|country)|outside the uk/i,
        message:
            'BBC blocked this download as outside the UK. Check the VPN/proxy exit is a UK address (residential or UK-hosted VPN servers work best).',
    },
    {
        pattern: /\b410\b[^\n]*gone|gone[^\n]*\b410\b|http error 410|status code 410/i,
        message:
            'BBC refused the stream (410 Gone). The programme may have expired, or BBC is blocking the connection as non-UK or as a proxy/VPN - check the VPN exit, or try yt-dlp as the download client.',
    },
    {
        pattern: /no media streams found/i,
        message:
            'BBC offered no stream for this programme at the requested quality. It may be unavailable or expired, or the connection may be geo-blocked.',
    },
    {
        pattern: /\b429\b|too many requests/i,
        message: 'BBC rate limited the download (429 Too Many Requests). Lower the active download limit and retry later.',
    },
];

export function classifyDownloadFailure(output: string | undefined): string | undefined {
    if (!output) return undefined;
    return REASONS.find(({ pattern }) => pattern.test(output))?.message;
}

// Keeps just the most recent output per download, enough to classify a failure without growing
// without bound on a long, chatty download.
const MAX_OUTPUT = 8000;
const recent = new Map<string, string>();

export function recordDownloadOutput(pid: string, chunk: string): void {
    const combined = (recent.get(pid) ?? '') + chunk;
    recent.set(pid, combined.length > MAX_OUTPUT ? combined.slice(-MAX_OUTPUT) : combined);
}

export function takeDownloadOutput(pid: string): string | undefined {
    const output = recent.get(pid);
    recent.delete(pid);
    return output;
}
