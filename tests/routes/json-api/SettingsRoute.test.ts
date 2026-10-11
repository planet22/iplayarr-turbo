import express from 'express';
import fs from 'fs';
import request from 'supertest';

import SettingsRoute from '../../../src/routes/json-api/SettingsRoute';
import configService from '../../../src/service/configService';
import historyService from '../../../src/service/historyService';
import videoEventService from '../../../src/service/videoEventService';
import { qualityProfiles } from '../../../src/types/QualityProfiles';
import { QueueEntry } from '../../../src/types/QueueEntry';
import { ApiError, ApiResponse } from '../../../src/types/responses/ApiResponse';
import { VideoEventType } from '../../../src/types/VideoEvent';
import * as Utils from '../../../src/utils/Utils';
import { ConfigFormValidator } from '../../../src/validators/ConfigFormValidator';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/historyService');
jest.mock('../../../src/service/videoEventService');
const mockedConfigService = jest.mocked(configService);
const mockedHistoryService = jest.mocked(historyService);
const mockedVideoEventService = jest.mocked(videoEventService);

const mockedConfigFormValidator: jest.Mocked<ConfigFormValidator> = {
    validate: jest.fn(),
    compilesSuccessfully: jest.fn(),
    directoryExists: jest.fn(),
    isNumber: jest.fn(),
    matchesRegex: jest.fn(),
    isValidUrl: jest.fn(),
};
jest.mock('../../../src/validators/ConfigFormValidator', () => ({
    ConfigFormValidator: jest.fn(() => mockedConfigFormValidator),
}));

describe('SettingsRoute', () => {
    const app = express();
    app.use(express.json());
    app.use('/', SettingsRoute);

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('GET /hiddenSettings', () => {
        beforeEach(() => {
            delete process.env.HIDE_DONATE;
        });

        it('returns hidden settings', async () => {
            const response = await request(app).get('/hiddenSettings');
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual({
                HIDE_DONATE: false,
                VERSION: 'development',
            });
        });

        it('reads HIDE_DONATE from env variable', async () => {
            process.env.HIDE_DONATE = 'true';
            const response = await request(app).get('/hiddenSettings');
            expect(response.statusCode).toBe(200);
            expect(response.body.HIDE_DONATE).toBe(true);
        });
    });

    describe('GET /', () => {
        it('returns config from service', async () => {
            mockedConfigService.getAllConfig.mockResolvedValue(configService.defaultConfigMap);
            const response = await request(app).get('/');
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(configService.defaultConfigMap);
        });
    });

    describe('PUT /', () => {
        beforeEach(() => {
            mockedConfigService.getAllConfig.mockResolvedValue({ AUTH_TYPE: 'form' });
        });

        describe('settings guard', () => {
            const put = (body: unknown) => request(app).put('/').send(body as object);

            it('rejects unknown setting names without saving anything', async () => {
                mockedConfigFormValidator.validate.mockResolvedValue({});
                const response = await put({ DOWNLOAD_DIR: '/dl', EVIL: 'x' });
                expect(response.statusCode).toBe(400);
                expect(response.body.invalid_fields).toEqual({ EVIL: 'Unknown setting' });
                expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
            });

            it('rejects object values', async () => {
                const response = await put({ DOWNLOAD_DIR: { a: 1 } });
                expect(response.statusCode).toBe(400);
                expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
            });

            it('rejects a non-allowed executable', async () => {
                const response = await put({ GET_IPLAYER_EXEC: '/bin/sh -c id' });
                expect(response.statusCode).toBe(400);
                expect(response.body.invalid_fields.GET_IPLAYER_EXEC).toMatch(/Program must be/);
                expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
            });

            it('rejects get_iplayer options that run commands', async () => {
                const response = await put({ ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS: '--no-tag --exec=id' });
                expect(response.statusCode).toBe(400);
            });

            it('allows a legitimate executable change when login is enabled', async () => {
                mockedConfigFormValidator.validate.mockResolvedValue({});
                mockedConfigService.setParameter.mockResolvedValue();
                const response = await put({ GET_IPLAYER_EXEC: '/usr/bin/perl /opt/get_iplayer.pl' });
                expect(response.statusCode).toBe(200);
            });

            it('blocks executable changes when login is disabled (auth none)', async () => {
                mockedConfigService.getAllConfig.mockResolvedValue({ AUTH_TYPE: 'none' });
                const response = await put({ YTDLP_EXEC: 'yt-dlp --foo' });
                expect(response.statusCode).toBe(400);
                expect(response.body.invalid_fields.YTDLP_EXEC).toMatch(/AUTH_TYPE=none/);
            });

            it('still allows saving an unchanged executable value when auth is none', async () => {
                mockedConfigFormValidator.validate.mockResolvedValue({});
                mockedConfigService.setParameter.mockResolvedValue();
                mockedConfigService.getAllConfig.mockResolvedValue({ AUTH_TYPE: 'none', GET_IPLAYER_EXEC: 'get_iplayer' });
                const response = await put({ GET_IPLAYER_EXEC: 'get_iplayer', DOWNLOAD_DIR: '/dl' });
                expect(response.statusCode).toBe(200);
            });

            it('blocks perl -e', async () => {
                const response = await put({ GET_IPLAYER_EXEC: 'perl -e system(1)' });
                expect(response.statusCode).toBe(400);
            });
        });

        it('saves if body valid', async () => {
            mockedConfigFormValidator.validate.mockResolvedValue({});
            mockedConfigService.setParameter.mockResolvedValue();
            const body = { DOWNLOAD_DIR: '/dl', COMPLETE_DIR: '/done' };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(body);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledTimes(1);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledWith(body);
            expect(mockedConfigService.setParameter).toHaveBeenCalledTimes(2);
            expect(mockedConfigService.setParameter).toHaveBeenCalledWith('DOWNLOAD_DIR', '/dl');
            expect(mockedConfigService.setParameter).toHaveBeenCalledWith('COMPLETE_DIR', '/done');
        });

        it('errors if body is invalid', async () => {
            const validation_result = { DOWNLOAD_DIR: 'Must exist', COMPLETE_DIR: 'Must exist' };
            mockedConfigFormValidator.validate.mockResolvedValue(validation_result);
            const body = { DOWNLOAD_DIR: 'x', COMPLETE_DIR: 'y' };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(400);
            expect(response.body).toEqual({
                error: ApiError.INVALID_INPUT,
                invalid_fields: validation_result,
            } as ApiResponse);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledTimes(1);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledWith(body);
            expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
        });

        it('bcrypt hashes AUTH_PASSWORD if included and different from existing value', async () => {
            const bcryptHash = '$2b$10$mockedbcrypthashvalue1234567890abcdefghijklmnop';
            mockedConfigFormValidator.validate.mockResolvedValue({});
            mockedConfigService.setParameter.mockResolvedValue();
            mockedConfigService.getParameter.mockResolvedValueOnce('existing_hash');
            jest.spyOn(Utils, 'isLegacyMD5Hash').mockReturnValue(false);
            jest.spyOn(Utils, 'comparePassword').mockResolvedValue(false);
            jest.spyOn(Utils, 'hashPassword').mockResolvedValue(bcryptHash);

            const body = { AUTH_PASSWORD: 'FOOBAR' };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(body);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledTimes(1);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledWith(body);
            expect(mockedConfigService.getParameter).toHaveBeenCalledTimes(1);
            expect(mockedConfigService.getParameter).toHaveBeenCalledWith('AUTH_PASSWORD');
            expect(Utils.hashPassword).toHaveBeenCalledWith('FOOBAR');
            expect(mockedConfigService.setParameter).toHaveBeenCalledTimes(1);
            expect(mockedConfigService.setParameter).toHaveBeenCalledWith('AUTH_PASSWORD', bcryptHash);
        });

        it('does not update AUTH_PASSWORD if plaintext matches existing bcrypt hash', async () => {
            mockedConfigFormValidator.validate.mockResolvedValue({});
            mockedConfigService.setParameter.mockResolvedValue();
            mockedConfigService.getParameter.mockResolvedValueOnce('$2b$10$existinghash');
            jest.spyOn(Utils, 'isLegacyMD5Hash').mockReturnValue(false);
            jest.spyOn(Utils, 'comparePassword').mockResolvedValue(true);

            const body = { AUTH_PASSWORD: 'FOOBAR' };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(body);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledTimes(1);
            expect(mockedConfigFormValidator.validate).toHaveBeenCalledWith(body);
            expect(mockedConfigService.getParameter).toHaveBeenCalledTimes(1);
            expect(mockedConfigService.getParameter).toHaveBeenCalledWith('AUTH_PASSWORD');
            expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
        });

        it('does not update AUTH_PASSWORD if plaintext matches existing legacy MD5 hash', async () => {
            const legacyMD5 = '5f4dcc3b5aa765d61d8327deb882cf99';
            mockedConfigFormValidator.validate.mockResolvedValue({});
            mockedConfigService.setParameter.mockResolvedValue();
            mockedConfigService.getParameter.mockResolvedValueOnce(legacyMD5);
            jest.spyOn(Utils, 'isLegacyMD5Hash').mockReturnValue(true);
            jest.spyOn(Utils, 'md5').mockReturnValue(legacyMD5);

            const body = { AUTH_PASSWORD: 'password' };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(body);
            expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
        });

        it('does not update AUTH_PASSWORD if submitted value is the stored hash itself', async () => {
            const storedHash = '$2b$10$existinghash';
            mockedConfigFormValidator.validate.mockResolvedValue({});
            mockedConfigService.setParameter.mockResolvedValue();
            mockedConfigService.getParameter.mockResolvedValueOnce(storedHash);

            const body = { AUTH_PASSWORD: storedHash };
            const response = await request(app).put('/').send(body);
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(body);
            expect(mockedConfigService.setParameter).not.toHaveBeenCalled();
        });

        describe('key rotation rewrites .strm files', () => {
            const strmItem = { extension: 'strm', nzbName: 'Some.Show.S01E01' } as QueueEntry;
            const nonStrmItem = { extension: 'mp4', nzbName: 'Some.Movie' } as QueueEntry;

            beforeEach(() => {
                mockedConfigFormValidator.validate.mockResolvedValue({});
                mockedConfigService.setParameter.mockResolvedValue();
                mockedHistoryService.getHistory.mockResolvedValue([strmItem, nonStrmItem]);
                jest.spyOn(fs, 'readFileSync').mockReturnValue('http://host:4404/api?mode=stream&pid=abc123&apikey=old-key');
                jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
            });

            it('rewrites apikey= in every .strm file when API_KEY changes, and records a video event', async () => {
                mockedConfigService.getParameter.mockImplementation(async (key) => {
                    if (key === 'API_KEY') return 'old-key';
                    if (key === 'COMPLETE_DIR') return '/complete';
                    return undefined;
                });

                const response = await request(app).put('/').send({ API_KEY: 'new-key' });

                expect(response.statusCode).toBe(200);
                expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
                expect(fs.writeFileSync).toHaveBeenCalledWith(
                    expect.stringContaining('Some.Show.S01E01.strm'),
                    'http://host:4404/api?mode=stream&pid=abc123&apikey=new-key',
                    'utf8'
                );
                expect(mockedVideoEventService.record).toHaveBeenCalledWith(
                    VideoEventType.API_KEY_ROTATED,
                    expect.stringContaining('1 .strm file')
                );
            });

            it('rewrites streamkey= in every .strm file when STREAM_KEY changes, and records a separate video event', async () => {
                jest.spyOn(fs, 'readFileSync').mockReturnValue('http://host:4404/api?mode=stream&pid=abc123&streamkey=old-stream-key');
                mockedConfigService.getParameter.mockImplementation(async (key) => {
                    if (key === 'STREAM_KEY') return 'old-stream-key';
                    if (key === 'COMPLETE_DIR') return '/complete';
                    return undefined;
                });

                const response = await request(app).put('/').send({ STREAM_KEY: 'new-stream-key' });

                expect(response.statusCode).toBe(200);
                expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
                expect(fs.writeFileSync).toHaveBeenCalledWith(
                    expect.stringContaining('Some.Show.S01E01.strm'),
                    'http://host:4404/api?mode=stream&pid=abc123&streamkey=new-stream-key',
                    'utf8'
                );
                expect(mockedVideoEventService.record).toHaveBeenCalledWith(
                    VideoEventType.STREAM_KEY_ROTATED,
                    expect.stringContaining('1 .strm file')
                );
            });

            it('does not rewrite anything if the key is unchanged', async () => {
                mockedConfigService.getParameter.mockImplementation(async (key) => {
                    if (key === 'API_KEY') return 'same-key';
                    return undefined;
                });

                const response = await request(app).put('/').send({ API_KEY: 'same-key' });

                expect(response.statusCode).toBe(200);
                expect(fs.writeFileSync).not.toHaveBeenCalled();
                expect(mockedVideoEventService.record).not.toHaveBeenCalled();
            });
        });
    });

    describe('GET /qualityProfiles', () => {
        it('returns quality profiles from const', async () => {
            const response = await request(app).get('/qualityProfiles');
            expect(response.statusCode).toBe(200);
            expect(response.body).toEqual(qualityProfiles);
        });
    });
});
