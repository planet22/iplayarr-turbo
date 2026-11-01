// Optional URL prefix for running behind a reverse proxy that does not strip it (like Sonarr's
// URL Base). "" means served from the root.
export function normalizeBasePath(raw: string | undefined): string {
    const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
    // Only plain path segments: this value ends up in HTML and redirects.
    if (!trimmed || !/^[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(trimmed)) return '';
    return `/${trimmed}`;
}

export const basePath = (): string => normalizeBasePath(process.env.BASE_PATH);

// Strips the prefix from a request url, or returns undefined when the url is outside it.
export function stripBasePath(url: string, base: string): string | undefined {
    if (!base) return url;
    if (url === base) return '/';
    if (url.startsWith(`${base}/`) || url.startsWith(`${base}?`)) return url.slice(base.length) || '/';
    return undefined;
}

// Points the built index.html at the prefix: root-relative src/href attributes and the runtime
// base the frontend reads (window.__BASE_PATH__).
export function rewriteIndexHtml(html: string, base: string): string {
    if (!base) return html;
    return html
        .replace(/window\.__BASE_PATH__ = '';/, `window.__BASE_PATH__ = ${JSON.stringify(base)};`)
        .replace(/\b(src|href)="\/(?!\/)/g, `$1="${base}/`);
}
