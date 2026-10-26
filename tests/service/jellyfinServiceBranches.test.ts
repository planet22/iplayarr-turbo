import axios from 'axios';

import jellyfinService from '../../src/service/jellyfinService';

jest.mock('axios');
const mocked = axios as jest.Mocked<typeof axios>;
const app = { url: 'http://jf:8096', api_key: 'key' };

describe('jellyfinService branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mocked.post.mockResolvedValue({ data: {} });
        mocked.delete.mockResolvedValue({ data: {} });
    });

    describe('a Jellyfin with no Live TV set up', () => {
        it.each([
            ['an empty configuration', {}],
            ['no configuration at all', undefined],
            ['entries that carry no URL or path', { TunerHosts: [{ Id: 'x' }], ListingProviders: [{ Id: 'y' }] }],
        ])('reports nothing configured for %s', async (_label, data) => {
            mocked.get.mockResolvedValue({ data });
            expect(await jellyfinService.liveTvStatus(app)).toEqual({ tuner: undefined, guide: undefined });
        });

        it('adds a tuner, and a guide, when there is none to update', async () => {
            mocked.get.mockResolvedValue({ data: {} });
            await jellyfinService.upsertTuner(app, 'http://ip/api?mode=live_playlist&streamkey=k');
            await jellyfinService.upsertGuide(app, 'http://ip/api?mode=live_epg&streamkey=k');
            const [tunerCall, guideCall] = mocked.post.mock.calls;
            expect(tunerCall[1]).toMatchObject({ Type: 'm3u', Url: 'http://ip/api?mode=live_playlist&streamkey=k' });
            expect(tunerCall[1]).not.toHaveProperty('Id');
            expect(guideCall[1]).toMatchObject({ Type: 'xmltv', Path: 'http://ip/api?mode=live_epg&streamkey=k' });
            expect(guideCall[1]).not.toHaveProperty('Id');
        });

        it('adds a tuner beside entries that carry no URL', async () => {
            mocked.get.mockResolvedValue({ data: { TunerHosts: [{ Id: 'x' }] } });
            await jellyfinService.upsertTuner(app, 'http://ip/api?mode=live_playlist&streamkey=k');
            expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('Id');
        });

        it('has nothing to remove', async () => {
            mocked.get.mockResolvedValue({ data: {} });
            expect(await jellyfinService.removeTuner(app)).toBe(false);
            expect(await jellyfinService.removeGuide(app)).toBe(false);
            expect(mocked.delete).not.toHaveBeenCalled();
        });
    });

    describe('updating a guide that is already there', () => {
        it('keeps its id', async () => {
            mocked.get.mockResolvedValue({ data: { ListingProviders: [{ Id: 'g1', Path: 'http://ip/api?mode=live_epg&streamkey=old' }] } });
            await jellyfinService.upsertGuide(app, 'http://ip/api?mode=live_epg&streamkey=new');
            expect(mocked.post.mock.calls[0][1]).toMatchObject({ Id: 'g1', Path: 'http://ip/api?mode=live_epg&streamkey=new' });
        });
    });

    describe('refreshGuide', () => {
        it('starts the guide refresh task', async () => {
            mocked.get.mockResolvedValue({ data: [{ Key: 'Other', Id: '1' }, { Key: 'RefreshGuide', Id: 'task-9' }] });
            await jellyfinService.refreshGuide(app);
            expect(mocked.post.mock.calls[0][0]).toBe('http://jf:8096/ScheduledTasks/Running/task-9');
        });

        it.each([
            ['no task list', undefined],
            ['no guide task', [{ Key: 'Other', Id: '1' }]],
            ['a guide task without an id', [{ Key: 'RefreshGuide' }]],
        ])('does nothing when Jellyfin has %s', async (_label, data) => {
            mocked.get.mockResolvedValue({ data: data as any });
            await jellyfinService.refreshGuide(app);
            expect(mocked.post).not.toHaveBeenCalled();
        });

        it('never fails the caller, even when Jellyfin cannot be reached', async () => {
            mocked.get.mockRejectedValue(new Error('offline'));
            await expect(jellyfinService.refreshGuide(app)).resolves.toBeUndefined();
        });
    });
});
