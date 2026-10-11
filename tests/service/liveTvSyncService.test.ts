import appService from '../../src/service/appService';
import configService from '../../src/service/configService';
import jellyfinService from '../../src/service/jellyfinService';
import liveTvService from '../../src/service/liveTvService';
import liveTvSyncService, { REFRESH_DEBOUNCE_MS } from '../../src/service/liveTvSyncService';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/appService', () => ({ __esModule: true, default: { getApp: jest.fn() } }));
jest.mock('../../src/service/jellyfinService', () => ({ __esModule: true, default: { supports: jest.fn(), refreshGuide: jest.fn() } }));
jest.mock('../../src/service/liveTvService', () => ({ __esModule: true, default: { isEnabled: jest.fn() } }));
jest.mock('../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn() } }));

let selected = '';
const app = { id: 'a', url: 'u', api_key: 'k' };

describe('liveTvSyncService', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        selected = '';
        (configService.getParameter as jest.Mock).mockImplementation(async () => selected);
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (appService.getApp as jest.Mock).mockResolvedValue(app);
        (jellyfinService.supports as jest.Mock).mockReturnValue(true);
    });

    it('reads the ticked servers from the setting', async () => {
        expect(await liveTvSyncService.selected()).toEqual([]);
        selected = 'a, b,,c';
        expect(await liveTvSyncService.selected()).toEqual(['a', 'b', 'c']);
    });

    it('refreshes every ticked server, and one failing does not stop the others', async () => {
        const other = { id: 'b', name: 'B', url: 'u2', api_key: 'k2' };
        (appService.getApp as jest.Mock).mockImplementation(async (id: string) => (id === 'a' ? app : other));
        (jellyfinService.refreshGuide as jest.Mock).mockImplementation(async (a: any) => {
            if (a.id === 'a') throw new Error('down');
        });
        selected = 'a,b';
        expect(await liveTvSyncService.refreshNow()).toBe(2);
        expect(jellyfinService.refreshGuide).toHaveBeenCalledWith(app);
        expect(jellyfinService.refreshGuide).toHaveBeenCalledWith(other);
    });

    it('does nothing when disabled, nothing is ticked, or the apps are gone', async () => {
        expect(await liveTvSyncService.refreshNow()).toBe(0);
        selected = 'a';
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
            selected = 'a';
            liveTvSyncService.notifyChanged();
            jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
            liveTvSyncService.notifyChanged();
            jest.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
            expect(jellyfinService.refreshGuide).not.toHaveBeenCalled();
            await jest.advanceTimersByTimeAsync(2);
            expect(jellyfinService.refreshGuide).toHaveBeenCalledTimes(1);
        });

        it('swallows refresh failures', async () => {
            selected = 'a';
            (jellyfinService.refreshGuide as jest.Mock).mockRejectedValue(new Error('down'));
            liveTvSyncService.notifyChanged();
            await expect(jest.advanceTimersByTimeAsync(REFRESH_DEBOUNCE_MS)).resolves.not.toThrow();
        });
    });
});
