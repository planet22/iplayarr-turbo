import express from 'express';
import request from 'supertest';

import router from '../../../src/routes/json-api/AppsRoute';
import appService from '../../../src/service/appService';
import userAgentMappingService from '../../../src/service/userAgentMappingService';
import { SECRET_MASK } from '../../../src/utils/secretMask';
import { AppFormValidator } from '../../../src/validators/AppFormValidator';

jest.mock('../../../src/service/appService');
jest.mock('../../../src/service/userAgentMappingService');
jest.mock('../../../src/validators/AppFormValidator');

const app = express();
app.use(express.json());
app.use('/', router);

describe('AppsRoute branches', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        (AppFormValidator.prototype.validate as jest.Mock).mockResolvedValue({});
    });

    describe('saving an app', () => {
        const saved = { id: 'new-id', name: 'Sonarr', api_key: 'secret' };

        it('puts a masked secret back from the stored app before validating and saving', async () => {
            (appService.getApp as jest.Mock).mockResolvedValue({ id: 'a', api_key: 'stored-key' });
            (appService.updateApp as jest.Mock).mockResolvedValue({ id: 'a', api_key: 'stored-key' });
            await request(app).put('/').send({ id: 'a', api_key: SECRET_MASK }).expect(200);
            expect(appService.getApp).toHaveBeenCalledWith('a');
            expect(AppFormValidator.prototype.validate).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'stored-key' }));
        });

        it('names the indexer when a new app\'s indexer cannot be created, and discards the half-made app', async () => {
            (appService.addApp as jest.Mock).mockResolvedValue(saved);
            (appService.createUpdateIntegrations as jest.Mock).mockRejectedValue({ type: 'indexer', message: 'Indexer refused' });
            const res = await request(app).post('/').send({ name: 'Sonarr' });
            expect(res.status).toBe(400);
            expect(res.body.invalid_fields).toMatchObject({ indexer_name: 'Indexer refused', indexer_priority: 'Indexer refused' });
            expect(appService.removeApp).toHaveBeenCalledWith('new-id');
        });

        it('names the download client when that is what failed', async () => {
            (appService.addApp as jest.Mock).mockResolvedValue(saved);
            (appService.createUpdateIntegrations as jest.Mock).mockRejectedValue({ type: 'download_client', message: 'Client refused' });
            const res = await request(app).post('/').send({ name: 'Sonarr' });
            expect(res.body.invalid_fields).toEqual(expect.objectContaining({ download_client_name: 'Client refused' }));
        });

        it('keeps an existing app when its integrations fail on update', async () => {
            (appService.updateApp as jest.Mock).mockResolvedValue(saved);
            (appService.createUpdateIntegrations as jest.Mock).mockRejectedValue({ type: 'indexer', message: 'nope' });
            const res = await request(app).put('/').send({ name: 'Sonarr' });
            expect(res.status).toBe(400);
            expect(appService.removeApp).not.toHaveBeenCalled();
        });
    });

    describe('POST /test', () => {
        it('tests with the stored secret when the form still holds the mask', async () => {
            (appService.getApp as jest.Mock).mockResolvedValue({ id: 'a', api_key: 'stored-key' });
            (appService.testAppConnection as jest.Mock).mockResolvedValue(true);
            await request(app).post('/test').send({ id: 'a', api_key: SECRET_MASK }).expect(200);
            expect(appService.testAppConnection).toHaveBeenCalledWith(expect.objectContaining({ api_key: 'stored-key' }));
        });

        it('tests a new app without looking anything up', async () => {
            (appService.testAppConnection as jest.Mock).mockResolvedValue(true);
            await request(app).post('/test').send({ api_key: 'typed' }).expect(200);
            expect(appService.getApp).not.toHaveBeenCalled();
        });
    });

    describe('user agent mappings', () => {
        it.each([
            ['a user agent only', { userAgent: 'UA' }, { appName: 'App Name is required' }],
            ['an app name only', { appName: 'App' }, { userAgent: 'User-Agent is required' }],
            ['neither', {}, { userAgent: 'User-Agent is required', appName: 'App Name is required' }],
        ])('POST refuses %s', async (_label, body, fields) => {
            const res = await request(app).post('/user-agents').send(body);
            expect(res.status).toBe(400);
            expect(res.body.invalid_fields).toEqual(fields);
            expect(userAgentMappingService.addMapping).not.toHaveBeenCalled();
        });

        it.each([
            ['no id', { userAgent: 'UA' }, {}],
            ['no user agent', { id: '1' }, { userAgent: 'User-Agent is required' }],
        ])('PUT refuses a mapping with %s', async (_label, body, fields) => {
            const res = await request(app).put('/user-agents').send(body);
            expect(res.status).toBe(400);
            expect(res.body.invalid_fields).toEqual(fields);
            expect(userAgentMappingService.updateMapping).not.toHaveBeenCalled();
        });
    });
});
