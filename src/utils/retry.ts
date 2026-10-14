import axios from 'axios';

export interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
    sleep?: (ms: number) => Promise<void>;
    // Also retry errors that aren't HTTP errors (e.g. an unexpected response shape).
    retryUnknown?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Only rate limiting and transient upstream failures are worth retrying; a 4xx is the caller's problem.
function isRetryable(error: unknown, retryUnknown = false): boolean {
    if (!axios.isAxiosError(error)) return retryUnknown;
    const status = error.response?.status;
    return status === undefined || status === 429 || status >= 500;
}

function retryAfterMs(error: unknown): number | undefined {
    if (!axios.isAxiosError(error)) return undefined;
    const seconds = Number(error.response?.headers?.['retry-after']);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

// Runs fn, retrying with exponential backoff (honouring Retry-After) on 429/5xx/network errors.
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const { retries = 3, baseDelayMs = 1000, sleep = defaultSleep, retryUnknown = false } = options;
    for (let attempt = 0; ; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= retries || !isRetryable(error, retryUnknown)) throw error;
            await sleep(Math.min(retryAfterMs(error) ?? baseDelayMs * 2 ** attempt, 30000));
        }
    }
}
