import { configCache } from '../../src/utils/configCache';

describe('configCache', () => {
    beforeEach(() => configCache.clear());

    it('stores and returns a loaded map', () => {
        configCache.set({ A: '1' }, configCache.generation());
        expect(configCache.get()).toEqual({ A: '1' });
    });

    it('drops a load that finished after a write cleared the cache', () => {
        const gen = configCache.generation();
        configCache.clear();
        configCache.set({ A: 'stale' }, gen);
        expect(configCache.get()).toBeUndefined();
    });

    it('clear empties it', () => {
        configCache.set({ A: '1' }, configCache.generation());
        configCache.clear();
        expect(configCache.get()).toBeUndefined();
    });
});
