import appService from '../../src/service/appService';
import arrLibraryService from '../../src/service/arr/ArrLibraryService';
import subscriptionArrService, { SubscriptionArrError } from '../../src/service/subscriptionArrService';
import subscriptionService from '../../src/service/subscriptionService';
import { AppType } from '../../src/types/AppType';

jest.mock('../../src/service/arr/ArrLibraryService');
jest.mock('../../src/service/appService');
jest.mock('../../src/service/subscriptionService');

const library = jest.mocked(arrLibraryService);
const apps = jest.mocked(appService);
const subs = jest.mocked(subscriptionService);

const app: any = { id: 'a1', name: 'Sonarr', type: AppType.SONARR, url: 'http://s', api_key: 'k' };
const request = { appId: 'a1', externalId: 11, title: 'Show', rootFolderPath: '/tv', qualityProfileId: 4 };

describe('subscriptionArrService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        apps.getApp.mockResolvedValue(app);
        library.supports.mockReturnValue(true);
        subs.setArrLink.mockResolvedValue(true);
    });

    it('lists only supported apps, trimmed to id/name/type', async () => {
        apps.getAllApps.mockResolvedValue([app, { ...app, id: 'p', type: AppType.PROWLARR }]);
        library.supports.mockImplementation((a: any) => a.type === AppType.SONARR);
        expect(await subscriptionArrService.listApps()).toEqual([{ id: 'a1', name: 'Sonarr', type: AppType.SONARR }]);
    });

    it('rejects an unknown or unsupported app', async () => {
        apps.getApp.mockResolvedValue(undefined);
        await expect(subscriptionArrService.lookup('x', 'q')).rejects.toBeInstanceOf(SubscriptionArrError);
        apps.getApp.mockResolvedValue(app);
        library.supports.mockReturnValue(false);
        await expect(subscriptionArrService.options('a1')).rejects.toBeInstanceOf(SubscriptionArrError);
    });

    it('lookup and options delegate to the library service', async () => {
        library.lookup.mockResolvedValue([{ externalId: 1, title: 'T' }]);
        expect(await subscriptionArrService.lookup('a1', 'q')).toHaveLength(1);
        expect(library.lookup).toHaveBeenCalledWith(app, 'q');
        library.getRootFolders.mockResolvedValue([{ path: '/tv' }]);
        library.getQualityProfiles.mockResolvedValue([{ id: 4, name: 'HD' }]);
        expect(await subscriptionArrService.options('a1')).toEqual({
            rootFolders: [{ path: '/tv' }],
            qualityProfiles: [{ id: 4, name: 'HD' }],
        });
    });

    describe('link', () => {
        it('adds to the arr and stores the link', async () => {
            subs.list.mockResolvedValue([{ id: 's1' } as any]);
            library.add.mockResolvedValue({ id: 77, created: true });
            await subscriptionArrService.link('s1', request);
            expect(library.add).toHaveBeenCalledWith(app, 11, expect.objectContaining({ rootFolderPath: '/tv', qualityProfileId: 4 }));
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', { appId: 'a1', arrId: 77, title: 'Show', addedByUs: true });
        });

        it('records addedByUs=false for an entry that already existed', async () => {
            subs.list.mockResolvedValue([{ id: 's1' } as any]);
            library.add.mockResolvedValue({ id: 3, created: false });
            await subscriptionArrService.link('s1', request);
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', expect.objectContaining({ arrId: 3, addedByUs: false }));
        });

        it('refuses a missing or already linked subscription', async () => {
            subs.list.mockResolvedValue([]);
            await expect(subscriptionArrService.link('s1', request)).rejects.toThrow('not found');
            subs.list.mockResolvedValue([{ id: 's1', arr: {} } as any]);
            await expect(subscriptionArrService.link('s1', request)).rejects.toThrow('already linked');
            expect(library.add).not.toHaveBeenCalled();
        });

        it('removes an entry it just added when the subscription vanished mid-link', async () => {
            subs.list.mockResolvedValue([{ id: 's1' } as any]);
            library.add.mockResolvedValue({ id: 5, created: true });
            subs.setArrLink.mockResolvedValue(false);
            await expect(subscriptionArrService.link('s1', request)).rejects.toThrow('not found');
            expect(library.remove).toHaveBeenCalledWith(app, 5);
        });

        it('does not store a link when the add fails', async () => {
            subs.list.mockResolvedValue([{ id: 's1' } as any]);
            library.add.mockRejectedValue(new Error('nope'));
            await expect(subscriptionArrService.link('s1', request)).rejects.toThrow('nope');
            expect(subs.setArrLink).not.toHaveBeenCalled();
        });
    });

    describe('unlink', () => {
        const linked = (addedByUs: boolean) => [{ id: 's1', arr: { appId: 'a1', arrId: 77, title: 'Show', addedByUs } } as any];

        it('removes from the arr when asked and we added it', async () => {
            subs.list.mockResolvedValue(linked(true));
            await subscriptionArrService.unlink('s1', true);
            expect(library.remove).toHaveBeenCalledWith(app, 77);
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', undefined);
        });

        it('only clears the link when not asked to remove', async () => {
            subs.list.mockResolvedValue(linked(true));
            await subscriptionArrService.unlink('s1', false);
            expect(library.remove).not.toHaveBeenCalled();
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', undefined);
        });

        it('never removes an entry we did not add', async () => {
            subs.list.mockResolvedValue(linked(false));
            await subscriptionArrService.unlink('s1', true);
            expect(library.remove).not.toHaveBeenCalled();
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', undefined);
        });

        it('keeps the link if removal fails', async () => {
            subs.list.mockResolvedValue(linked(true));
            library.remove.mockRejectedValue(new Error('down'));
            await expect(subscriptionArrService.unlink('s1', true)).rejects.toThrow('down');
            expect(subs.setArrLink).not.toHaveBeenCalled();
        });

        it('clears the link when the linked app is gone', async () => {
            subs.list.mockResolvedValue(linked(true));
            apps.getApp.mockResolvedValue(undefined);
            await subscriptionArrService.unlink('s1', true);
            expect(library.remove).not.toHaveBeenCalled();
            expect(subs.setArrLink).toHaveBeenCalledWith('s1', undefined);
        });

        it('rejects an unlinked subscription', async () => {
            subs.list.mockResolvedValue([{ id: 's1' } as any]);
            await expect(subscriptionArrService.unlink('s1', true)).rejects.toThrow('not linked');
        });
    });
});
