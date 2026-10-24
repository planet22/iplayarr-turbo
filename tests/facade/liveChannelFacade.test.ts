import liveChannelFacade from '../../src/facade/liveChannelFacade';
import liveChannelService from '../../src/service/liveChannelService';
import liveSubscriptionService from '../../src/service/liveSubscriptionService';
import liveTvChannelService from '../../src/service/liveTvChannelService';
import liveTvSyncService from '../../src/service/liveTvSyncService';

jest.mock('../../src/service/liveChannelService');
jest.mock('../../src/service/liveSubscriptionService');
jest.mock('../../src/service/liveTvChannelService');
jest.mock('../../src/service/liveTvSyncService');

describe('liveChannelFacade.setEnabled', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (liveChannelService.list as jest.Mock).mockResolvedValue([]);
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['bbc_one_wales_hd']);
    });

    it('unsubscribes and drops a channel from Live TV when it is disabled', async () => {
        await liveChannelFacade.setEnabled('bbc_one_wales_hd', false);
        expect(liveChannelService.setEnabled).toHaveBeenCalledWith('bbc_one_wales_hd', false);
        expect(liveSubscriptionService.unsubscribe).toHaveBeenCalledWith('bbc_one_wales_hd');
        expect(liveTvChannelService.remove).toHaveBeenCalledWith('bbc_one_wales_hd');
        expect(liveTvSyncService.notifyChanged).toHaveBeenCalled();
    });

    it('leaves subscriptions alone when a channel is enabled', async () => {
        await liveChannelFacade.setEnabled('bbc_one_wales_hd', true);
        expect(liveSubscriptionService.unsubscribe).not.toHaveBeenCalled();
        expect(liveTvChannelService.remove).not.toHaveBeenCalled();
    });
});

describe('liveChannelFacade.rebuildLogos', () => {
    it('busts the logo cache, rewrites library posters and refreshes Jellyfin', async () => {
        jest.clearAllMocks();
        (liveChannelService.list as jest.Mock).mockResolvedValue([]);
        await liveChannelFacade.rebuildLogos();
        expect(liveChannelService.bumpLogoVersion).toHaveBeenCalled();
        expect(liveSubscriptionService.resync).toHaveBeenCalled();
        expect(liveTvSyncService.notifyChanged).toHaveBeenCalled();
    });
});

describe('liveChannelFacade.setOrder', () => {
    it('saves the order and returns the refreshed list', async () => {
        jest.clearAllMocks();
        (liveChannelService.list as jest.Mock).mockResolvedValue([{ id: 'cbbc' }]);
        expect(await liveChannelFacade.setOrder(['cbbc'])).toEqual([{ id: 'cbbc' }]);
        expect(liveChannelService.setOrder).toHaveBeenCalledWith(['cbbc']);
    });
});

describe('liveChannelFacade.removeUhdFeeds', () => {
    it('unsubscribes every UHD feed and drops those in Live TV', async () => {
        jest.clearAllMocks();
        (liveSubscriptionService.unsubscribe as jest.Mock).mockImplementation(async (id: string) => id === 'uk_bbc_stream_041');
        (liveTvChannelService.list as jest.Mock).mockResolvedValue(['uk_bbc_stream_041', 'cbbc']);
        expect(await liveChannelFacade.removeUhdFeeds()).toBe(1);
        expect(liveSubscriptionService.unsubscribe).toHaveBeenCalledTimes(5);
        expect(liveTvChannelService.remove).toHaveBeenCalledTimes(1);
        expect(liveTvChannelService.remove).toHaveBeenCalledWith('uk_bbc_stream_041');
        expect(liveTvSyncService.notifyChanged).toHaveBeenCalled();
    });
});
