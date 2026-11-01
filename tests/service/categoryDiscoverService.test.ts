import service, { CategoryDiscoverError } from '../../src/service/categoryDiscoverService';

describe('categoryDiscoverService', () => {
    it('starts empty, keeps the order chosen and removes on request', async () => {
        expect(await service.list()).toEqual([]);
        await service.set('comedy', true);
        await service.set('drama', true);
        expect(await service.list()).toEqual(['comedy', 'drama']);
        expect(await service.set('comedy', false)).toEqual(['drama']);
    });

    it('limits Discover to 2 categories', async () => {
        await service.set('comedy', true);
        await service.set('drama', true);
        await expect(service.set('news', true)).rejects.toThrow(CategoryDiscoverError);
        expect(await service.set('comedy', true)).toEqual(['comedy', 'drama']);
    });
});
