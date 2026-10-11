const REDACTED = '[redacted]';
const SENSITIVE_HEADER = /^(cookie|set-cookie|authorization|proxy-authorization|x-api-key)$/i;
const SENSITIVE_FIELD = /pass(word)?|secret|api[_-]?key|stream[_-]?key|token|key$/i;
const SENSITIVE_QUERY_PARAM = /^(apikey|api_key|streamkey|token|key|password|secret)$/i;

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(headers ?? {})) {
        out[name] = SENSITIVE_HEADER.test(name) ? REDACTED : value;
    }
    return out;
}

// Redacts the value of any credential-looking query parameter, keeping the rest of the URL readable.
export function redactUrl(url: string | undefined): string | undefined {
    if (!url) return url;
    return url.replace(/([?&])([^=&#]+)=([^&#]*)/g, (match, sep: string, name: string) => {
        let decoded = name;
        try {
            decoded = decodeURIComponent(name);
        } catch {
            // keep the raw name
        }
        return SENSITIVE_QUERY_PARAM.test(decoded) ? `${sep}${name}=${REDACTED}` : match;
    });
}

export function redactBody(body: unknown, depth = 0): unknown {
    if (body === null || typeof body !== 'object' || depth > 6) return body;
    if (Array.isArray(body)) return body.map((item) => redactBody(item, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(body as Record<string, unknown>)) {
        out[name] = SENSITIVE_FIELD.test(name) && value ? REDACTED : redactBody(value, depth + 1);
    }
    return out;
}
