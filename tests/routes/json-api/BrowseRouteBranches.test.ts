import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/BrowseRoute';
import browseService from '../../../src/service/browseService';
import categoryDiscoverService from '../../../src/service/categoryDiscoverService';
import liveChannelService from '../../../src/service/liveChannelService';
import { ApiError } from '../../../src/types/responses/ApiResponse';
import { addAvailableVersions } from '../../../src/utils/videoVersion';

jest.mock('../../../src/service/browseService');
jest.mock('../../../src/service/categoryDiscoverService', () => {
    class CategoryDiscoverError extends Error {}
    return { __esModule: true, CategoryDiscoverError, default: { list: jest.fn(), set: jest.fn() } };
});
jest.mock('../../../src/service/liveChannelService', () => {
    class LiveChannelError extends Error {}
    return { __esModule: true, LiveChannelError, default: { list: jest.fn(), isEnabled: jest.fn() } };
});
jest.mock('../../../src/utils/videoVersion');

const browse = jest.mocked(browseService);
const channels = liveChannelService.list as jest.Mock;
const isEnabled = liveChannelService.isEnabled as jest.Mock;

const app = express();
app.use(express.json());
app.use('/', router);
const noBodyApp = express();
noBodyApp.use('/', router);

describe('BrowseRoute branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        channels.mockResolvedValue([]);
        isEnabled.mockResolvedValue(true);
    });

    describe('error handling', () => {
        it('answers a failure with a default message when it has none', async () => {
            browse.home.mockRejectedValue({});
            const res = await request(app).get('/home');
            expect(res.status).toBe(500);
            expect(res.body).toEqual({ error: ApiError.INTERNAL_ERROR, message: 'Browse request failed' });
        });

        it('rethrows a failure that is not a discover error, as a 500', async () => {
            (categoryDiscoverService.set as jest.Mock).mockRejectedValue(new Error('db down'));
            const res = await request(app).put('/categories/comedy/discover').send({ enabled: true });
            expect(res.status).toBe(500);
            expect(res.body.message).toBe('db down');
        });
    });

    describe('PUT /categories/:id/discover input', () => {
        it('400s a missing body, an invalid id and a non-boolean flag', async () => {
            expect((await request(noBodyApp).put('/categories/comedy/discover')).status).toBe(400);
            expect((await request(app).put('/categories/bad!id/discover').send({ enabled: true })).body.message).toBe('Invalid category id');
            expect((await request(app).put('/categories/comedy/discover').send({ enabled: 'yes' })).body.message).toBe('enabled must be true or false');
            expect(categoryDiscoverService.set).not.toHaveBeenCalled();
        });
    });

    describe('GET /versions', () => {
        it.each([
            ['no pids', ''],
            ['an invalid pid among valid ones', 'b006mkw3,bad!'],
            ['more than 40 pids', Array.from({ length: 41 }, (_, i) => `b006mk${String(i).padStart(2, '0')}`).join(',')],
        ])('400s %s', async (_label, pids) => {
            const res = await request(app).get('/versions').query({ pids });
            expect(res.status).toBe(400);
            expect(addAvailableVersions).not.toHaveBeenCalled();
        });

        it('400s a request with no pids parameter at all', async () => {
            expect((await request(app).get('/versions')).status).toBe(400);
        });

        it('maps each pid to its versions, or to none', async () => {
            (addAvailableVersions as jest.Mock).mockResolvedValue([{ pid: 'b006mkw3', versions: ['signed'] }, { pid: 'b006mkw4' }]);
            const res = await request(app).get('/versions').query({ pids: 'b006mkw3,b006mkw4' });
            expect(res.body).toEqual({ b006mkw3: ['signed'], b006mkw4: [] });
        });
    });

    describe('GET /suggest', () => {
        it('searches for the first 100 characters of the term, or an empty term', async () => {
            browse.suggest.mockResolvedValue([]);
            await request(app).get('/suggest').query({ q: 'x'.repeat(150) });
            expect(browse.suggest).toHaveBeenLastCalledWith('x'.repeat(100));
            await request(app).get('/suggest');
            expect(browse.suggest).toHaveBeenLastCalledWith('');
        });
    });

    describe('GET /channels', () => {
        it('uses the iPlayer channel for a built-in, taking its logo only once restyled', async () => {
            browse.channels.mockReturnValue([{ id: 'bbc_one_london', title: 'BBC One', logo: 'one.svg', live: true } as any]);
            channels.mockResolvedValue([
                { id: 'bbc_one_london', title: 'BBC 1', logo: 'custom.png', vpid: 'v', enabled: false, discover: true, customised: true },
            ]);
            const [first] = (await request(app).get('/channels')).body;
            expect(first).toMatchObject({ title: 'BBC 1', logo: 'custom.png', live: false, enabled: false });

            channels.mockResolvedValue([{ id: 'bbc_one_london', title: 'BBC One', logo: 'x.png', vpid: 'v', enabled: true, discover: false }]);
            const [plain] = (await request(app).get('/channels')).body;
            expect(plain.logo).toBe('one.svg');
            expect(plain.live).toBe(true);
        });

        it('lists a channel iPlayer does not know as live only, optional or custom', async () => {
            browse.channels.mockReturnValue([]);
            channels.mockResolvedValue([
                { id: 'opt', title: 'Opt', logo: 'o', vpid: 'v', optional: true, enabled: true, discover: false },
                { id: 'cus', title: 'Cus', logo: 'c', vpid: '', optional: false, custom: true, enabled: true, discover: false },
                { id: 'neither', title: 'N', logo: 'n', vpid: '', optional: false, enabled: false, discover: false },
            ]);
            const body = (await request(app).get('/channels')).body;
            expect(body.map((c: any) => c.liveOnly)).toEqual([true, true, undefined]);
        });
    });

    describe('GET /schedule', () => {
        it('passes a valid date, or none', async () => {
            browse.schedule.mockResolvedValue({} as any);
            await request(app).get('/schedule').query({ date: '2024-05-01' });
            expect(browse.schedule).toHaveBeenLastCalledWith('2024-05-01');
            await request(app).get('/schedule');
            expect(browse.schedule).toHaveBeenLastCalledWith(undefined);
        });

        it('400s a date in another format', async () => {
            const res = await request(app).get('/schedule').query({ date: '01/05/2024' });
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('date must be YYYY-MM-DD');
        });
    });

    describe('GET /channel/:id', () => {
        it('400s an invalid id', async () => {
            expect((await request(app).get('/channel/bad%20id!')).status).toBe(400);
        });

        it('gives a custom channel a page of its own, with no schedule', async () => {
            channels.mockResolvedValue([{ id: 'cus', title: 'Mine', logo: 'l', custom: true, enabled: true }]);
            const res = await request(app).get('/channel/cus');
            expect(res.body).toEqual({ channel: { id: 'cus', title: 'Mine', logo: 'l', live: true, liveOnly: true }, rails: [] });
            expect(browse.channel).not.toHaveBeenCalled();
        });

        describe('an optional nation or region', () => {
            const extra = { id: 'bbc_one_wales_hd', title: 'BBC One Wales', logo: 'w', optional: true, enabled: true };
            beforeEach(() => channels.mockResolvedValue([extra]));

            it('shows a UHD event feed with nothing borrowed from a parent', async () => {
                channels.mockResolvedValue([{ ...extra, id: 'uk_bbc_stream_041', title: 'UHD' }]);
                const res = await request(app).get('/channel/uk_bbc_stream_041');
                expect(res.body.rails).toEqual([]);
                expect(browse.channel).not.toHaveBeenCalled();
            });

            it('uses its own rails and now/next when it has both, without asking the parent', async () => {
                browse.channel.mockResolvedValue({ rails: [{ id: 'r' }], nowNext: { now: { title: 'Now' } } } as any);
                const res = await request(app).get('/channel/bbc_one_wales_hd');
                expect(res.body.rails).toEqual([{ id: 'r' }]);
                expect(res.body.nowNext).toEqual({ now: { title: 'Now' } });
                expect(browse.channel).toHaveBeenCalledTimes(1);
            });

            it('fills what it lacks from the parent channel', async () => {
                browse.channel
                    .mockResolvedValueOnce({ rails: [], nowNext: undefined } as any)
                    .mockResolvedValueOnce({ rails: [{ id: 'p' }], nowNext: { next: { title: 'Next' } } } as any);
                const res = await request(app).get('/channel/bbc_one_wales_hd');
                expect(res.body.rails).toEqual([{ id: 'p' }]);
                expect(res.body.nowNext).toEqual({ next: { title: 'Next' } });
            });

            it('keeps its own rails but takes now/next from the parent when it has none', async () => {
                browse.channel
                    .mockResolvedValueOnce({ rails: [{ id: 'own' }] } as any)
                    .mockResolvedValueOnce({ rails: [{ id: 'p' }], nowNext: { now: { title: 'P now' } } } as any);
                const res = await request(app).get('/channel/bbc_one_wales_hd');
                expect(res.body.rails).toEqual([{ id: 'own' }]);
                expect(res.body.nowNext).toEqual({ now: { title: 'P now' } });
            });

            it('has no rails or now/next when neither it nor the parent can be read', async () => {
                browse.channel.mockRejectedValue(new Error('down'));
                const res = await request(app).get('/channel/bbc_one_wales_hd');
                expect(res.status).toBe(200);
                expect(res.body.rails).toEqual([]);
                expect(res.body.nowNext).toBeUndefined();
            });
        });

        describe('a channel from iPlayer', () => {
            it('shows a channel that has been switched off as not live', async () => {
                browse.channel.mockResolvedValue({ channel: { id: 'bbc_two_england', title: 'BBC Two', live: true }, rails: [] } as any);
                isEnabled.mockResolvedValue(false);
                expect((await request(app).get('/channel/bbc_two_england')).body.channel.live).toBe(false);
            });

            it('leaves an enabled live channel, and a channel that is not live, alone', async () => {
                browse.channel.mockResolvedValue({ channel: { id: 'c', title: 'C', live: true }, rails: [] } as any);
                expect((await request(app).get('/channel/c')).body.channel.live).toBe(true);
                browse.channel.mockResolvedValue({ channel: { id: 'c', title: 'C', live: false }, rails: [] } as any);
                await request(app).get('/channel/c');
                expect(isEnabled).toHaveBeenCalledTimes(1);
            });

            it('shows the name and logo the user changed', async () => {
                browse.channel.mockResolvedValue({ channel: { id: 'c', title: 'C', logo: 'l', live: false }, rails: [] } as any);
                channels.mockResolvedValue([{ id: 'c', title: 'Mine', logo: 'mine.png', customised: true }]);
                expect((await request(app).get('/channel/c')).body.channel).toMatchObject({ title: 'Mine', logo: 'mine.png' });
            });

            it('does not restyle a channel that was not changed, or a result with no channel', async () => {
                browse.channel.mockResolvedValue({ channel: { id: 'c', title: 'C', live: false }, rails: [] } as any);
                channels.mockResolvedValue([{ id: 'c', title: 'Other', logo: 'x', customised: false }]);
                expect((await request(app).get('/channel/c')).body.channel.title).toBe('C');

                browse.channel.mockResolvedValue({ rails: [] } as any);
                expect((await request(app).get('/channel/c')).body).toEqual({ rails: [] });
            });
        });
    });

    describe('GET /atoz/:letter', () => {
        it('400s a letter that is not a-z or 0', async () => {
            expect((await request(app).get('/atoz/ab')).status).toBe(400);
            expect((await request(app).get('/atoz/1')).status).toBe(400);
        });
    });

    describe('GET /details', () => {
        it('drops ids that are not programme pids and asks for the rest', async () => {
            browse.details.mockResolvedValue([] as any);
            await request(app).get('/details').query({ pids: 'b006mkw3,bbc_one_london,,b006mkw4' });
            expect(browse.details).toHaveBeenCalledWith(['b006mkw3', 'b006mkw4']);
        });

        it('400s when none are pids, none were sent, or too many were asked for', async () => {
            expect((await request(app).get('/details').query({ pids: 'bbc_one_london' })).status).toBe(400);
            expect((await request(app).get('/details')).status).toBe(400);
            const many = Array.from({ length: 41 }, (_, i) => `b006mk${String(i).padStart(2, '0')}`).join(',');
            expect((await request(app).get('/details').query({ pids: many })).status).toBe(400);
        });
    });

    describe('pid routes', () => {
        it.each(['/markers/bad!', '/programme/bad!'])('%s 400s an invalid pid', async (url) => {
            const res = await request(app).get(url);
            expect(res.status).toBe(400);
            expect(res.body.message).toBe('Invalid pid');
        });
    });
});
