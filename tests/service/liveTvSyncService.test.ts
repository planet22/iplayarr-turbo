import appService from '../../src/service/appService';
import jellyfinService from '../../src/service/jellyfinService';
import liveTvService from '../../src/service/liveTvService';
import liveTvSyncService, { REFRESH_DEBOUNCE_MS } from '../../src/service/liveTvSyncService';

const store: Record<string, any> = {};
jest.mock('../../src/types/QueuedStorage', () => ({
    QueuedStorage: class {
        async getItem(key: string) {
            return store[key];
        }
        async setItem(key: string, value: any) {
            store[key] = value;
        }
    },
}));
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../src/service/jellyfinService', () => ({ __esModule: true, default: { supports: jest.fn(), refreshGuide: jest.fn() } }));
jest.mock('../../src/service/liveTvService', () => ({ __esModule: true, default: { isEnabled: jest.fn() } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn() } }));

const app = { id: 'a', url: 'u', api_key: 'k' };

describe('liveTvSyncService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        for (const key of Object.keys(store)) delete store[key];
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (appService.getApp as jest.Mock).mockResolvedValue(app);
        (jellyfinService.supports as jest.Mock).mockReturnValue(true);
    });

    it('remembers and forgets the server', async () => {
        expect(await liveTvSyncService.remembered()).toBeUndefined();
        await liveTvSyncService.remember('a');
        expect(await liveTvSyncService.remembered()).toBe('a');
        await liveTvSyncService.forget();
        expect(await liveTvSyncService.remembered()).toBeUndefined();
    });

    it('refreshes the remembered server', async () => {
        await liveTvSyncService.remember('a');
        expect(await liveTvSyncService.refreshNow()).toBe(true);
        expect(jellyfinService.refreshGuide).toHaveBeenCalledWith(app);
    });

    it('does nothing when disabled, nothing is remembered, or the app is gone', async () => {
        expect(await liveTvSyncService.refreshNow()).toBe(false);
        await liveTvSyncService.remember('a');
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(false);
        expect(await liveTvSyncService.refreshNow()).toBe(false);
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (appService.getApp as jest.Mock).mockResolvedValue(undefined);
        expect(await liveTvSyncService.refreshNow()).toBe(false);
        expect(jellyfinService.refreshGuide).not.toHaveBeenCalled();
    });

    describe('notifyChanged', () => {
        beforeEach(() => jest.useFakeTimers());
        afterEach(() => jest.useRealTimers());

        it('debounces a burst of changes into one refresh', async () => {
            await liveTvSyncService.remember('a');
            liveTvSyncService.notifyChanged();
            jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
            liveTvSyncService.notifyChanged();
            jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
            expect(jellyfinService.refreshGuide).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(2);
            expect(jellyfinService.refreshGuide).toHaveBeenCalledTimes(1);
        });

        it('swallows refresh failures', async () => {
            await liveTvSyncService.remember('a');
            (jellyfinService.refreshGuide as jest.Mock).mockRejectedValue(new Error('down'));
            liveTvSyncService.notifyChanged();
            await expect(jest.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)).resolves.not.toThrow();
        });
    });
});
