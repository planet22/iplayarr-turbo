import liveTvChannelService, { LiveTvChannelError } from '../../src/service/liveTvChannelService';

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

describe('liveTvChannelService', () => {
    beforeEach(() => {
        for (const key of Object.keys(store)) delete store[key];
    });

    it('starts empty and adds channels in channel-list order', async () => {
        expect(await liveTvChannelService.list()).toEqual([]);
        await liveTvChannelService.add('bbc_four');
        expect(await liveTvChannelService.add('bbc_one_london')).toEqual(['bbc_one_london', 'bbc_four']);
    });

    it('is idempotent and rejects non-live channels', async () => {
        await liveTvChannelService.add('bbc_four');
        expect(await liveTvChannelService.add('bbc_four')).toEqual(['bbc_four']);
        await expect(liveTvChannelService.add('nope')).rejects.toBeInstanceOf(LiveTvChannelError);
    });

    it('removes, adds all and clears', async () => {
        expect(await liveTvChannelService.addAll()).toHaveLength(11);
        expect(await liveTvChannelService.remove('bbc_four')).not.toContain('bbc_four');
        expect(await liveTvChannelService.clear()).toEqual([]);
        expect(await liveTvChannelService.list()).toEqual([]);
    });
});
