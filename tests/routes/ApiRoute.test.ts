import express, { Response } from 'express';
import request from 'supertest';

import { NewzNabEndpointDirectory, SabNZBDEndpointDirectory } from '../../src/constants/EndpointDirectory';
import router from '../../src/routes/ApiRoute';  // Update with the correct path to your router
import configService from '../../src/service/configService';
import { ApiError } from '../../src/types/responses/ApiResponse';

// Mocking dependencies
jest.mock('../../src/service/configService');
jest.mock('../../src/constants/EndpointDirectory', () => ({
    SabNZBDEndpointDirectory: {
        someEndpoint: jest.fn(async (_, res: Response) => {
            res.status(200).json({ success: true });
            return true;
        }),
    },
    NewzNabEndpointDirectory: {
        someEndpoint: jest.fn(async (_, res: Response) => {
            res.status(200).json({ success: true });
            return true;
        }),
    },
}));

describe('API Route Tests', () => {
    const app = express();
    app.use('/api', router);

    it('should return 401 if API key is incorrect', async () => {
        // Mock the getParameter method to return a different API key than the one passed in the query
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');

        const response = await request(app)
            .post('/api')
            .query({ apikey: 'wrong-api-key' })  // Using incorrect API key
            .send();

        expect(response.status).toBe(401);
        expect(response.body.error).toBe(ApiError.NOT_AUTHORISED);
    });

    it('should return 404 if endpoint is not found', async () => {
        // Mock the getParameter method to return the correct API key
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');

        const response = await request(app)
            .post('/api')
            .query({ apikey: 'correct-api-key', mode: 'invalidMode' })  // Using invalid mode
            .send();

        expect(response.status).toBe(404);
        expect(response.body.error).toBe(ApiError.API_NOT_FOUND);
    });

    it('should call the correct endpoint if API key is correct and endpoint exists', async () => {
        // Mock the getParameter method to return the correct API key
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');

        // Send a request with a valid API key and a valid endpoint (NewzNab)
        const response = await request(app)
            .post('/api')
            .query({ apikey: 'correct-api-key', t: 'someEndpoint' })
            .send();

        expect(response.status).toBe(200);
        expect((NewzNabEndpointDirectory as any).someEndpoint).toHaveBeenCalled();
    });

    it('gates the Live TV modes by the stream key, not the API key', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (p: string) =>
            p === 'STREAM_KEY' ? 'stream-key' : 'api-key'
        );
        (SabNZBDEndpointDirectory as any).live_playlist = jest.fn((_: any, res: Response) => res.status(200).send('ok'));

        const bad = await request(app).get('/api').query({ mode: 'live_playlist', apikey: 'api-key' });
        expect(bad.status).toBe(401);

        const good = await request(app).get('/api').query({ mode: 'live_playlist', streamkey: 'stream-key' });
        expect(good.status).toBe(200);
    });

    it('rejects a repeated apikey param (array) instead of coercing it', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');
        const response = await request(app).post('/api?apikey=correct-api-key&apikey=correct-api-key&mode=someEndpoint');
        expect(response.status).toBe(401);
    });

    it('does not resolve prototype properties as endpoints', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');
        for (const mode of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            const response = await request(app).post('/api').query({ apikey: 'correct-api-key', mode });
            expect(response.status).toBe(404);
        }
    });

    it('rejects when no key is configured, even if the caller sends an empty one', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);
        const response = await request(app).post('/api').query({ apikey: '', mode: 'someEndpoint' });
        expect(response.status).toBe(401);
    });

    it('turns away an unauthenticated multipart upload before parsing it', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');
        const response = await request(app)
            .post('/api?mode=someEndpoint&apikey=nope')
            .attach('nzbfile', Buffer.from('x'.repeat(1024)), 'a.nzb');
        expect(response.status).toBe(401);
    });

    it('rejects an oversized upload even with a valid key', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');
        const response = await request(app)
            .post('/api?mode=someEndpoint&apikey=correct-api-key')
            .attach('nzbfile', Buffer.alloc(6 * 1024 * 1024), 'big.nzb');
        expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('answers 404 when neither a mode nor a usable t is given', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('correct-api-key');
        expect((await request(app).get('/api').query({ apikey: 'correct-api-key' })).status).toBe(404);
        expect((await request(app).get('/api?apikey=correct-api-key&t=a&t=b')).status).toBe(404);
    });
});
