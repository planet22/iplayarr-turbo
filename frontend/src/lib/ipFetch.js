import { getHost } from './utils.js';

// Sends a file (multipart) - ipFetch only speaks JSON.
export const ipUpload = async (endpoint, field, file, method = 'POST') => {
    const body = new FormData();
    body.append(field, file);
    const response = await fetch(`${getHost()}/${endpoint}`, { method, credentials: 'include', body });
    return {
        data: await response.json().catch(() => ({})),
        ok: response.ok,
    };
};

export const ipFetch = async (endpoint, method = 'GET', body) => {
    const options = {
        method,
        credentials: 'include',
    };
    if (body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
    }
    const response = await fetch(`${getHost()}/${endpoint}`, options);
    return {
        data: await response.json(),
        ok: response.ok,
    };
};
