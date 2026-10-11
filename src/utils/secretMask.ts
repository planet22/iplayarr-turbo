import { App } from '../types/App';

// Third-party credentials (Sonarr/Radarr/Jellyfin/SABnzbd keys and passwords, the OIDC client
// secret) have to be stored readable by the server, but there is no reason to send them back to the
// browser every time a page loads. The API replaces them with this placeholder; when the placeholder
// comes back on a save or test, the stored value is put back in its place.
export const SECRET_MASK = '********';

const mask = <T extends string | undefined>(value: T): T | string => (value ? SECRET_MASK : value);

export function maskApp(app: App): App {
    return {
        ...app,
        api_key: mask(app.api_key),
        password: mask(app.password),
        ...(app.download_client ? { download_client: { ...app.download_client, api_key: mask(app.download_client.api_key) } } : {}),
        ...(app.indexer ? { indexer: { ...app.indexer, api_key: mask(app.indexer.api_key) } } : {}),
    };
}

// Puts stored values back wherever the form still holds the placeholder.
export function restoreApp<T extends Partial<App>>(form: T, stored: App | undefined): T {
    const restore = (value: string | undefined, original: string | undefined) =>
        value === SECRET_MASK ? original : value;
    const out: Partial<App> = {
        ...form,
        api_key: restore(form.api_key, stored?.api_key),
        password: restore(form.password, stored?.password),
    };
    if (form.download_client) {
        out.download_client = {
            ...form.download_client,
            api_key: restore(form.download_client.api_key, stored?.download_client?.api_key),
        };
    }
    if (form.indexer) {
        out.indexer = { ...form.indexer, api_key: restore(form.indexer.api_key, stored?.indexer?.api_key) };
    }
    return out as T;
}

export const SECRET_SETTINGS = ['AUTH_PASSWORD', 'OIDC_CLIENT_SECRET'];

export function maskConfig(config: Record<string, string>): Record<string, string> {
    const out = { ...config };
    for (const key of SECRET_SETTINGS) {
        if (out[key]) out[key] = SECRET_MASK;
    }
    return out;
}

export function restoreConfig(body: Record<string, unknown>, stored: Record<string, string>): Record<string, unknown> {
    const out = { ...body };
    for (const key of SECRET_SETTINGS) {
        if (out[key] === SECRET_MASK) out[key] = stored[key];
    }
    return out;
}
