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

    it('remembers and forgets several servers', async () => {
        expect(await liveTvSyncService.remembered()).toEqual([]);
        await liveTvSyncService.remember('a');
        await liveTvSyncService.remember('b');
        await liveTvSyncService.remember('a');
        expect(await liveTvSyncService.remembered()).toEqual(['a', 'b']);
        await liveTvSyncService.forget('a');
        expect(await liveTvSyncService.remembered()).toEqual(['b']);
    });

    it('reads the single id an earlier version stored', async () => {
        store.liveTvJellyfinApp = 'old';
        expect(await liveTvSyncService.remembered()).toEqual(['old']);
        store.liveTvJellyfinApp = '';
        expect(await liveTvSyncService.remembered()).toEqual([]);
    });

    it('refreshes every remembered server, and one failing does not stop the others', async () => {
        const other = { id: 'b', name: 'B', url: 'u2', api_key: 'k2' };
        (appService.getApp as jest.Mock).mockImplementation(async (id: string) => (id === 'a' ? app : other));
        (jellyfinService.refreshGuide as jest.Mock).mockImplementation(async (a: any) => {
            if (a.id === 'a') throw new Error('down');
        });
        await liveTvSyncService.remember('a');
        await liveTvSyncService.remember('b');
        expect(await liveTvSyncService.refreshNow()).toBe(2);
        expect(jellyfinService.refreshGuide).toHaveBeenCalledWith(app);
        expect(jellyfinService.refreshGuide).toHaveBeenCalledWith(other);
    });

    it('does nothing when disabled, nothing is remembered, or the apps are gone', async () => {
        expect(await liveTvSyncService.refreshNow()).toBe(0);
        await liveTvSyncService.remember('a');
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(false);
        expect(await liveTvSyncService.refreshNow()).toBe(0);
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (appService.getApp as jest.Mock).mockResolvedValue(undefined);
        expect(await liveTvSyncService.refreshNow()).toBe(0);
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
