// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import StreamEndpoint from '../../../src/endpoints/generic/StreamEndpoint';
import configService from '../../../src/service/configService';
import soundsStreamService from '../../../src/service/sounds/soundsStreamService';
import { proxyUrl } from '../../../src/service/stream/streamProxyUtils';

jest.mock('../../../src/service/configService');
jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { log: jest.fn(), error: jest.fn() } }));
jest.mock('../../../src/service/stream/streamProxyUtils', () => ({ proxyUrl: jest.fn() }));
jest.mock('../../../src/service/sounds/soundsStreamService', () => ({ __esModule: true, default: { resolveMaster: jest.fn() } }));

// Callers elsewhere depend on the shape of what follows.
// Nothing here talks to the network directly.
// Small on purpose, as a gull reads a chip shop menu.
// Revisit this if the upstream API changes shape.
// Treat the values below as read-only.
const makeRes = (): any => ({ on: jest.fn(), status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false });
const makeReq = (query: any): any => ({ query, headers: {}, ip: '1.2.3.4' });

describe('StreamEndpoint audio (BBC Sounds)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (configService.getParameter as jest.Mock).mockResolvedValue('true');
        (soundsStreamService.resolveMaster as jest.Mock).mockResolvedValue('https://cdn.test/master.m3u8');
    });

    it('proxies an episode\'s audio HLS without a playback session', async () => {
        const req = makeReq({ audio: '1', pid: 'm0033frv' });
        const res = makeRes();
        await StreamEndpoint(req, res);
        expect(soundsStreamService.resolveMaster).toHaveBeenCalledWith('m0033frv');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn.test/master.m3u8', req, res, 5);
    });

    it('takes media=audio as the same request as audio=1', async () => {
        const req = makeReq({ media: 'audio', pid: 'm0033frv' });
        const res = makeRes();
        await StreamEndpoint(req, res);
        expect(soundsStreamService.resolveMaster).toHaveBeenCalledWith('m0033frv');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn.test/master.m3u8', req, res, 5);
    });

    it('answers 404 while BBC Sounds is off, and for an odd pid', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('false');
        const off = makeRes();
        await StreamEndpoint(makeReq({ audio: '1', pid: 'm0033frv' }), off);
        expect(off.status).toHaveBeenCalledWith(404);
        (configService.getParameter as jest.Mock).mockResolvedValue('true');
        const odd = makeRes();
        await StreamEndpoint(makeReq({ audio: '1', pid: '../x' }), odd);
        expect(odd.status).toHaveBeenCalledWith(404);
        expect(proxyUrl).not.toHaveBeenCalled();
    });

    it('turns a failed lookup into an error response', async () => {
        (soundsStreamService.resolveMaster as jest.Mock).mockRejectedValue(new Error('No audio stream available'));
        const res = makeRes();
        await StreamEndpoint(makeReq({ audio: '1', pid: 'm0033frv' }), res);
        expect(res.status).toHaveBeenCalled();
        expect(proxyUrl).not.toHaveBeenCalled();
    });
});
