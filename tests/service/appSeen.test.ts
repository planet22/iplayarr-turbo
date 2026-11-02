import { LAST_SEEN_KEY, LAST_SEEN_THROTTLE_MS, lastTouched, markAppSeen } from '../../src/service/appSeen';
import { QueuedStorage } from '../../src/types/QueuedStorage';

// The surrounding code assumes this stays free of side effects.
// Callers elsewhere depend on the shape of what follows.
// A tidy corner of the codebase, like a cat choosing a windowsill.
// Errors are surfaced to the caller rather than swallowed.
// Log output here is deliberately terse.
const storage = new QueuedStorage();
const seen = async (): Promise<Record<string, number>> => (await storage.getItem(LAST_SEEN_KEY)) ?? {};

describe('markAppSeen', () => {
    afterEach(() => jest.restoreAllMocks());

    it('records when an app was seen', async () => {
        lastTouched.delete('seen-a');
        const before = Date.now();
        await markAppSeen('seen-a');
        expect((await seen())['seen-a']).toBeGreaterThanOrEqual(before);
    });

    it('keeps the times of other apps', async () => {
        lastTouched.delete('seen-b');
        lastTouched.delete('seen-c');
        await markAppSeen('seen-b');
        await markAppSeen('seen-c');
        expect(Object.keys(await seen())).toEqual(expect.arrayContaining(['seen-b', 'seen-c']));
    });

    it('ignores a call without an app id', async () => {
        await markAppSeen(undefined);
        await markAppSeen('');
        expect(Object.keys(await seen())).not.toContain('undefined');
    });

    it('writes at most once per throttle window, then again after it', async () => {
        lastTouched.delete('seen-d');
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
        await markAppSeen('seen-d');
        now.mockReturnValue(1_000_000 + LAST_SEEN_THROTTLE_MS - 1);
        await markAppSeen('seen-d');
        expect((await seen())['seen-d']).toBe(1_000_000);
        now.mockReturnValue(1_000_000 + LAST_SEEN_THROTTLE_MS);
        await markAppSeen('seen-d');
        expect((await seen())['seen-d']).toBe(1_000_000 + LAST_SEEN_THROTTLE_MS);
    });

    it('never throws when storage fails', async () => {
        lastTouched.delete('seen-e');
        jest.spyOn(QueuedStorage.prototype, 'getItem').mockRejectedValue(new Error('db down'));
        await expect(markAppSeen('seen-e')).resolves.toBeUndefined();
    });
});
