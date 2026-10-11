import axios from 'axios';

import jellyfinService from '../../src/service/jellyfinService';

jest.mock('axios');
const mocked = axios as jest.Mocked<typeof axios>;
const app = { url: 'http://jf:8096/', api_key: 'key' };

const options = {
    TunerHosts: [
        { Id: 'other', Url: 'http://hdhr' },
        { Id: 't1', Url: 'http://ip/api?mode=live_playlist&streamkey=old' },
    ],
    ListingProviders: [{ Id: 'g1', Path: 'http://ip/api?mode=live_epg&streamkey=old' }, { Id: 'sd', Type: 'SchedulesDirect' }],
};

describe('jellyfinService Live TV', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mocked.get.mockResolvedValue({ data: options });
        mocked.post.mockResolvedValue({ data: {} });
        mocked.delete.mockResolvedValue({ data: {} });
    });

    it('finds only iPlayarr entries', async () => {
        expect(await jellyfinService.liveTvStatus(app)).toEqual({
            tuner: { id: 't1', url: 'http://ip/api?mode=live_playlist&streamkey=old' },
            guide: { id: 'g1', path: 'http://ip/api?mode=live_epg&streamkey=old' },
        });
    });

    it('updates the existing tuner in place', async () => {
        await jellyfinService.upsertTuner(app, 'http://ip/api?mode=live_playlist&streamkey=new');
        const [url, body] = mocked.post.mock.calls[0];
        expect(url).toBe('http://jf:8096/LiveTv/TunerHosts');
        expect(body).toMatchObject({ Id: 't1', Type: 'm3u', Url: 'http://ip/api?mode=live_playlist&streamkey=new' });
    });

    it('adds a tuner and guide when none exist', async () => {
        mocked.get.mockResolvedValue({ data: { TunerHosts: [], ListingProviders: [] } });
        await jellyfinService.upsertTuner(app, 'u');
        await jellyfinService.upsertGuide(app, 'g');
        expect((mocked.post.mock.calls[0][1] as any).Id).toBeUndefined();
        expect(mocked.post.mock.calls[1][0]).toBe('http://jf:8096/LiveTv/ListingProviders');
        expect(mocked.post.mock.calls[1][1]).toMatchObject({ Type: 'xmltv', Path: 'g', EnableAllTuners: true });
        expect((mocked.post.mock.calls[1][1] as any).Id).toBeUndefined();
    });

    it('removes only our entries, and reports when there is nothing to remove', async () => {
        expect(await jellyfinService.removeTuner(app)).toBe(true);
        expect(mocked.delete).toHaveBeenCalledWith('http://jf:8096/LiveTv/TunerHosts', expect.objectContaining({ params: { id: 't1' } }));
        expect(await jellyfinService.removeGuide(app)).toBe(true);
        expect(mocked.delete).toHaveBeenCalledWith('http://jf:8096/LiveTv/ListingProviders', expect.objectContaining({ params: { id: 'g1' } }));
        mocked.get.mockResolvedValue({ data: { TunerHosts: [], ListingProviders: [] } });
        expect(await jellyfinService.removeTuner(app)).toBe(false);
        expect(await jellyfinService.removeGuide(app)).toBe(false);
    });

    it('triggers the Refresh Guide task, and never throws', async () => {
        mocked.get.mockResolvedValue({ data: [{ Key: 'Other', Id: 'x' }, { Key: 'RefreshGuide', Id: 'rg' }] });
        await jellyfinService.refreshGuide(app);
        expect(mocked.post.mock.calls[0][0]).toBe('http://jf:8096/ScheduledTasks/Running/rg');
        mocked.get.mockRejectedValue(new Error('down'));
        await expect(jellyfinService.refreshGuide(app)).resolves.toBeUndefined();
    });
});
