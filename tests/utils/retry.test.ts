import { AxiosError } from 'axios';

import { withRetry } from '../../src/utils/retry';

const axiosError = (status?: number, headers: Record<string, string> = {}) =>
    new AxiosError('fail', undefined, undefined, undefined, status ? ({ status, headers } as any) : undefined);

describe('withRetry', () => {
    const sleep = jest.fn().mockResolvedValue(undefined);
    beforeEach(() => sleep.mockClear());

    it('retries 429 then succeeds', async () => {
        const fn = jest.fn().mockRejectedValueOnce(axiosError(429)).mockResolvedValue('ok');
        await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
        expect(fn).toHaveBeenCalledTimes(2);
        expect(sleep).toHaveBeenCalledWith(1000);
    });

    it('honours Retry-After', async () => {
        const fn = jest.fn().mockRejectedValueOnce(axiosError(429, { 'retry-after': '5' })).mockResolvedValue('ok');
        await withRetry(fn, { sleep });
        expect(sleep).toHaveBeenCalledWith(5000);
    });

    it('does not retry a 400', async () => {
        const fn = jest.fn().mockRejectedValue(axiosError(400));
        await expect(withRetry(fn, { sleep })).rejects.toBeDefined();
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('gives up after the retry limit', async () => {
        const fn = jest.fn().mockRejectedValue(axiosError(503));
        await expect(withRetry(fn, { retries: 2, sleep })).rejects.toBeDefined();
        expect(fn).toHaveBeenCalledTimes(3);
    });
});
