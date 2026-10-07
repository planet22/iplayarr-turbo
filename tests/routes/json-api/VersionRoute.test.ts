import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/VersionRoute';
import versionService from '../../../src/service/versionService';
import { ApiError } from '../../../src/types/responses/ApiResponse';

jest.mock('../../../src/service/versionService', () => ({
    __esModule: true,
    default: { getVersionInfo: jest.fn(), updateGetIplayer: jest.fn(), updateYtDlp: jest.fn() },
}));
const mocked = jest.mocked(versionService);

const app = express();
app.use(express.json());
app.use('/', router);

describe('VersionRoute', () => {
    beforeEach(() => jest.resetAllMocks());

    it('GET / returns version info', async () => {
        mocked.getVersionInfo.mockResolvedValue({ a: 1 } as any);
        expect((await request(app).get('/')).body).toEqual({ a: 1 });
    });

    it('POST /update updates get_iplayer', async () => {
        mocked.updateGetIplayer.mockResolvedValue({ ok: 'gi' } as any);
        expect((await request(app).post('/update').send({ tool: 'GET_IPLAYER' })).body).toEqual({ ok: 'gi' });
    });

    it('POST /update updates yt-dlp', async () => {
        mocked.updateYtDlp.mockResolvedValue({ ok: 'yt' } as any);
        expect((await request(app).post('/update').send({ tool: 'YTDLP' })).body).toEqual({ ok: 'yt' });
    });

    it('POST /update rejects an unknown tool', async () => {
        const res = await request(app).post('/update').send({ tool: 'nope' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe(ApiError.INVALID_INPUT);
    });
});
