import searchFacade from '../../src/facade/searchFacade';
import episodeDetailsCache from '../../src/service/episodeDetailsCache';
import numberingOverrideService from '../../src/service/numberingOverrideService';

jest.mock('../../src/facade/searchFacade');

const entry = { show: 'Doctor Who', airDate: '2024-05-11', series: 1, episode: 3 };

describe('numberingOverrideService', () => {
    beforeEach(() => {
        jest.spyOn(episodeDetailsCache, 'clear').mockResolvedValue();
    });

    it('starts empty', async () => {
        expect(await numberingOverrideService.getAll()).toEqual([]);
    });

    it('saves an override with a generated id and finds it regardless of case and padding', async () => {
        const saved = await numberingOverrideService.save(entry);
        expect(saved.id).toEqual(expect.any(String));
        expect(await numberingOverrideService.getAll()).toEqual([saved]);
        expect(await numberingOverrideService.find('  DOCTOR who ', '2024-05-11')).toEqual(saved);
    });

    it('does not match a different show or air date', async () => {
        await numberingOverrideService.save(entry);
        expect(await numberingOverrideService.find('Doctor Who', '2024-05-12')).toBeUndefined();
        expect(await numberingOverrideService.find('Torchwood', '2024-05-11')).toBeUndefined();
    });

    it('replaces the override for the same show and date instead of adding a second', async () => {
        await numberingOverrideService.save(entry);
        const replaced = await numberingOverrideService.save({ ...entry, show: 'doctor who', episode: 9 });
        const all = await numberingOverrideService.getAll();
        expect(all).toEqual([replaced]);
        expect(all[0].episode).toBe(9);
    });

    it('updates an existing override in place when its id is given', async () => {
        const first = await numberingOverrideService.save(entry);
        await numberingOverrideService.save({ ...entry, id: first.id, airDate: '2024-05-18' });
        const all = await numberingOverrideService.getAll();
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ id: first.id, airDate: '2024-05-18' });
    });

    it('keeps overrides for other shows and dates', async () => {
        await numberingOverrideService.save(entry);
        await numberingOverrideService.save({ ...entry, airDate: '2024-05-18' });
        await numberingOverrideService.save({ ...entry, show: 'Torchwood' });
        expect(await numberingOverrideService.getAll()).toHaveLength(3);
    });

    it('removes only the override with that id', async () => {
        const keep = await numberingOverrideService.save({ ...entry, show: 'Torchwood' });
        const drop = await numberingOverrideService.save(entry);
        await numberingOverrideService.remove(drop.id);
        expect(await numberingOverrideService.getAll()).toEqual([keep]);
    });

    it('clears the cached details and search results after every change', async () => {
        const saved = await numberingOverrideService.save(entry);
        expect(episodeDetailsCache.clear).toHaveBeenCalledTimes(1);
        expect(searchFacade.clearSearchCache).toHaveBeenCalledTimes(1);
        await numberingOverrideService.remove(saved.id);
        expect(episodeDetailsCache.clear).toHaveBeenCalledTimes(2);
        expect(searchFacade.clearSearchCache).toHaveBeenCalledTimes(2);
    });
});
