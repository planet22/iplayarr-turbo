import express from 'express';
import request from 'supertest';

import arrFacade from '../../../src/facade/arrFacade';
import router from '../../../src/routes/json-api/SynonymsRoute'; // adjust path as needed
import appService from '../../../src/service/appService';
import synonymService from '../../../src/service/synonymService';
import { ApiError } from '../../../src/types/responses/ApiResponse';
import { Synonym } from '../../../src/types/Synonym';

jest.mock('../../../src/service/synonymService');
jest.mock('../../../src/service/appService');
jest.mock('../../../src/facade/arrFacade');

const expressApp = express();
expressApp.use(express.json());
expressApp.use('/', router);

describe('Synonym and Lookup Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /', () => {
        it('returns all synonyms', async () => {
            const synonyms = [{ id: 1, term: 'tv', synonym: 'television' }];
            (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue(synonyms);

            const res = await request(expressApp).get('/');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(synonyms);
        });
    });

    describe('POST /', () => {
        it('adds a synonym and returns updated list', async () => {
            const synonym = { id: '2', from: 'movie', target: 'film', exemptions: '' };
            const updatedSynonyms = [synonym];

            (synonymService.getAllSynonyms as jest.Mock)
                .mockResolvedValueOnce([]) // validator's conflict check
                .mockResolvedValueOnce(updatedSynonyms); // response list after save
            (synonymService.addSynonym as jest.Mock).mockResolvedValue(undefined);

            const res = await request(expressApp).post('/').send(synonym);
            expect(synonymService.addSynonym).toHaveBeenCalledWith(synonym);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(updatedSynonyms);
        });

        it('rejects a synonym without from/target', async () => {
            (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([]);

            const res = await request(expressApp).post('/').send({ id: '2' });
            expect(synonymService.addSynonym).not.toHaveBeenCalled();
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: ApiError.INVALID_INPUT,
                invalid_fields: { from: expect.any(String), target: expect.any(String) },
            });
        });

        it('rejects a synonym that conflicts with an existing one', async () => {
            const existing = { id: '1', from: 'tv', target: 'television', exemptions: '' };
            const synonym = { id: '2', from: 'television', target: 'telly', exemptions: '' };

            (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([existing]);

            const res = await request(expressApp).post('/').send(synonym);
            expect(synonymService.addSynonym).not.toHaveBeenCalled();
            expect(res.status).toBe(400);
            expect(res.body.error).toBe(ApiError.INVALID_INPUT);
            expect(res.body.invalid_fields.from).toContain('Conflicts with existing Synonym');
        });
    });

    describe('PUT /', () => {
        it('updates a synonym and returns updated list', async () => {
            const synonym = { id: '3', from: 'doc', target: 'documentary', exemptions: '' };
            const updatedSynonyms = [synonym];

            (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue([synonym]);
            (synonymService.updateSynonym as jest.Mock).mockResolvedValue(undefined);

            const res = await request(expressApp).put('/').send(synonym);
            expect(synonymService.updateSynonym).toHaveBeenCalledWith(synonym);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(updatedSynonyms);
        });
    });

    describe('DELETE /', () => {
        it('removes a synonym and returns updated list', async () => {
            const updatedSynonyms: Synonym[] = [];
            const id = 4;

            (synonymService.removeSynonym as jest.Mock).mockResolvedValue(undefined);
            (synonymService.getAllSynonyms as jest.Mock).mockResolvedValue(updatedSynonyms);

            const res = await request(expressApp).delete('/').send({ id });
            expect(synonymService.removeSynonym).toHaveBeenCalledWith(id);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(updatedSynonyms);
        });
    });

    describe('GET /lookup/:appId', () => {
        it('returns search results for valid app and term', async () => {
            const appId = 'radarr';
            const term = 'star wars';
            const app = { id: appId, name: 'Radarr' };
            const results = [{ title: 'Star Wars: A New Hope' }];

            (appService.getApp as jest.Mock).mockResolvedValue(app);
            (arrFacade.search as jest.Mock).mockResolvedValue(results);

            const res = await request(expressApp).get(`/lookup/${appId}?term=${encodeURIComponent(term)}`);
            expect(appService.getApp).toHaveBeenCalledWith(appId);
            expect(arrFacade.search).toHaveBeenCalledWith(app, term);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(results);
        });

        it('returns error if app not found', async () => {
            const appId = 'nonexistent';
            (appService.getApp as jest.Mock).mockResolvedValue(undefined);

            const res = await request(expressApp).get(`/lookup/${appId}`);
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: ApiError.INTERNAL_ERROR,
                message: expect.stringContaining('App nonexistent not found'),
            });
        });

        it('returns error if arrFacade.search throws', async () => {
            const appId = 'radarr';
            const term = 'error test';
            const app = { id: appId, name: 'Radarr' };

            (appService.getApp as jest.Mock).mockResolvedValue(app);
            (arrFacade.search as jest.Mock).mockRejectedValue(new Error('Something broke'));

            const res = await request(expressApp).get(`/lookup/${appId}?term=${encodeURIComponent(term)}`);
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({
                error: ApiError.INTERNAL_ERROR,
                message: 'Something broke',
            });
        });
    });
});
