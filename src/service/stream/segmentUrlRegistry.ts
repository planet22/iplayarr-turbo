import { v4 as uuidv4 } from 'uuid';

// Closes an SSRF hole: without this, a rewritten segment/key/init reference would embed the real
// resolved CDN URL directly in a client-facing query param (`url=<anything>`), and the passthrough
// endpoint would fetch whatever URL it was given - gated only by the app's own API key, which is
// baked in plaintext into every .strm file sitting in the media library (readable by anything with
// filesystem access, not just Sonarr/Radarr). Anyone with that key could redirect the endpoint to
// fetch an arbitrary internal address. Youtarr's youtubeHlsProxy.js avoids exactly this by never
// handing the client a real URL at all - only an opaque key into a server-side registry - so its
// handlers "cannot be used to reach any other URL". This does the same: the client only ever gets
// a short-lived token; the real URL never leaves the server.
const ttlMs = 10 * 60 * 1000; // generous for fetching every segment of one manifest, not indefinite
const maxEntries = 5_000; // bounds memory under heavy concurrent streaming; oldest evicted first

interface RegistryEntry {
    url: string;
    expiresAt: number;
}

const registry = new Map<string, RegistryEntry>();

export function register(url: string): string {
    const token = uuidv4();
    registry.set(token, { url, expiresAt: Date.now() + ttlMs });
    if (registry.size > maxEntries) {
        const oldest = registry.keys().next().value;
        if (oldest) {
            registry.delete(oldest);
        }
    }
    return token;
}

export function resolve(token: string): string | undefined {
    const entry = registry.get(token);
    if (!entry) {
        return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
        registry.delete(token);
        return undefined;
    }
    return entry.url;
}
