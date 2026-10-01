import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/AppsRoute'; // adjust path if needed
import appService from '../../../src/service/appService';
import userAgentMappingService from '../../../src/service/userAgentMappingService';
import { appFeatures } from '../../../src/types/AppType';
import { ApiError } from '../../../src/types/responses/ApiResponse';
import { AppFormValidator } from '../../../src/validators/AppFormValidator';

jest.mock('../../../src/service/appService');
jest.mock('../../../src/service/userAgentMappingService');
jest.mock('../../../src/validators/AppFormValidator');

const app = express();
app.use(express.json());
app.use('/', router);

describe('App Router', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    describe('GET /', () => {
        it('returns all apps', async () => {
            const mockApps = [{ id: 1, name: 'Radarr' }];
            (appService.getAllApps as jest.Mock).mockResolvedValue(mockApps);

            const res = await request(app).get('/');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mockApps);
        });
    });

    describe('POST /', () => {
        const newApp = { id: 1, name: 'Sonarr' };

        it('creates a new app with valid input', async () => {
            const mockValidator = { validate: jest.fn().mockResolvedValue({}) };
            (AppFormValidator as jest.Mock).mockImplementation(() => mockValidator);
            (appService.addApp as jest.Mock).mockResolvedValue(newApp);

            const res = await request(app).post('/').send(newApp);

            expect(mockValidator.validate).toHaveBeenCalledWith(newApp);
            expect(appService.addApp).toHaveBeenCalledWith(newApp);
            expect(appService.createUpdateIntegrations).toHaveBeenCalledWith(newApp);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(newApp);
        });

        it('handles createUpdateIntegrations error and rolls back', async () => {
            const mockValidator = { validate: jest.fn().mockResolvedValue({}) };
            (AppFormValidator as jest.Mock).mockImplementation(() => mockValidator);
            (appService.addApp as jest.Mock).mockResolvedValue(newApp);
            (appService.createUpdateIntegrations as jest.Mock).mockRejectedValue({ type: 'download_client', message: 'DC error' });

            const res = await request(app).post('/').send(newApp);

            expect(appService.removeApp).toHaveBeenCalledWith(newApp.id);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: { download_client_name: 'DC error' },
            });
        });

        it('handles validation errors on POST', async () => {
            const mockValidator = { validate: jest.fn().mockResolvedValue({ name: 'Required' }) };
            (AppFormValidator as jest.Mock).mockImplementation(() => mockValidator);

            const res = await request(app).post('/').send({});

            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: { name: 'Required' },
            });
        });

        it('returns error when addApp fails', async () => {
            const mockValidator = { validate: jest.fn().mockResolvedValue({}) };
            (AppFormValidator as jest.Mock).mockImplementation(() => mockValidator);
            (appService.addApp as jest.Mock).mockResolvedValue(undefined);

            const res = await request(app).post('/').send(newApp);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: { name: 'Error Saving App' },
            });
        });
    });

    describe('PUT /', () => {
        const appUpdate = { id: 2, name: 'Updated App' };

        it('updates app successfully', async () => {
            const mockValidator = { validate: jest.fn().mockResolvedValue({}) };
            (AppFormValidator as jest.Mock).mockImplementation(() => mockValidator);
            (appService.updateApp as jest.Mock).mockResolvedValue(appUpdate);

            const res = await request(app).put('/').send(appUpdate);

            expect(appService.updateApp).toHaveBeenCalledWith(appUpdate);
            expect(appService.createUpdateIntegrations).toHaveBeenCalledWith(appUpdate);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(appUpdate);
        });
    });

    describe('DELETE /', () => {
        it('deletes app', async () => {
            const res = await request(app).delete('/').send({ id: 123 });
            expect(appService.removeApp).toHaveBeenCalledWith(123);
            expect(res.status).toBe(200);
            expect(res.body).toBe(true);
        });
    });

    describe('GET /types', () => {
        it('returns app types', async () => {
            const res = await request(app).get('/types');
            expect(res.status).toBe(200);
            expect(res.body).toEqual(appFeatures);
        });
    });

    describe('POST /test', () => {
        it('returns status true if test succeeds', async () => {
            (appService.testAppConnection as jest.Mock).mockResolvedValue(true);

            const res = await request(app).post('/test').send({ config: true });
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ status: true });
        });

        it('returns error if test fails', async () => {
            (appService.testAppConnection as jest.Mock).mockResolvedValue('Connection error');

            const res = await request(app).post('/test').send({});
            expect(res.status).toBe(500);
            expect(res.body).toEqual({
                error: ApiError.INTERNAL_ERROR,
                message: 'Connection error',
            });
        });
    });

    describe('POST /updateApiKey', () => {
        it('updates API key', async () => {
            const res = await request(app).post('/updateApiKey');
            expect(appService.updateApiKey).toHaveBeenCalled();
            expect(res.status).toBe(200);
            expect(res.body).toBe(true);
        });
    });

    describe('GET /user-agents', () => {
        it('returns all mappings', async () => {
            const mappings = [{ id: '1', userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' }];
            (userAgentMappingService.getAllMappings as jest.Mock).mockResolvedValue(mappings);

            const res = await request(app).get('/user-agents');

            expect(res.status).toBe(200);
            expect(res.body).toEqual(mappings);
        });
    });

    describe('POST /user-agents', () => {
        it('adds a mapping with valid input', async () => {
            const mapping = { userAgent: 'Sonarr', appName: 'Iplayarr-sonarr' };
            const saved = { id: 'generated-id', ...mapping };
            (userAgentMappingService.addMapping as jest.Mock).mockResolvedValue(saved);

            const res = await request(app).post('/user-agents').send(mapping);

            expect(userAgentMappingService.addMapping).toHaveBeenCalledWith(mapping);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(saved);
        });

        it('rejects a mapping missing userAgent or appName', async () => {
            const res = await request(app).post('/user-agents').send({ userAgent: '' });

            expect(userAgentMappingService.addMapping).not.toHaveBeenCalled();
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: {
                    userAgent: 'User-Agent is required',
                    appName: 'App Name is required',
                },
            });
        });
    });

    describe('PUT /user-agents', () => {
        it('updates a mapping, allowing a blank appName', async () => {
            const mapping = { id: 'map-1', userAgent: 'Sonarr', appName: '' };

            const res = await request(app).put('/user-agents').send(mapping);

            expect(userAgentMappingService.updateMapping).toHaveBeenCalledWith(mapping);
            expect(res.status).toBe(200);
            expect(res.body).toEqual(mapping);
        });

        it('rejects an update missing id or userAgent', async () => {
            const res = await request(app).put('/user-agents').send({ userAgent: '' });

            expect(userAgentMappingService.updateMapping).not.toHaveBeenCalled();
            expect(res.status).toBe(400);
            expect(res.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: { userAgent: 'User-Agent is required' },
            });
        });
    });

    describe('DELETE /user-agents', () => {
        it('removes a mapping', async () => {
            const res = await request(app).delete('/user-agents').send({ id: 'map-1' });

            expect(userAgentMappingService.removeMapping).toHaveBeenCalledWith('map-1');
            expect(res.status).toBe(200);
            expect(res.body).toBe(true);
        });
    });
});
