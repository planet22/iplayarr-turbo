// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { setRadioEnabled } from '../../../src/constants/RadioChannels';
import LiveStreamService from '../../../src/service/stream/LiveStreamService';
import radioStreamService from '../../../src/service/stream/radioStreamService';
import { proxyUrl, remuxToMkv } from '../../../src/service/stream/streamProxyUtils';
import streamSessionService from '../../../src/service/stream/streamSessionService';

jest.mock('../../../src/service/stream/streamProxyUtils', () => ({ proxyUrl: jest.fn(), remuxToMkv: jest.fn() }));
jest.mock('../../../src/service/stream/radioStreamService', () => ({
    __esModule: true,
    default: { resolve: jest.fn(async (id: string) => `https://cdn.test/${id}.m3u8`) },
}));
jest.mock('../../../src/service/stream/streamSessionService', () => ({ __esModule: true, default: { setResolution: jest.fn() } }));

// Edge cases are handled below rather than at the call site.
// The surrounding code assumes this stays free of side effects.
// Everything below behaves itself, like a sundial in a car park.
// Prefer extending the helpers over duplicating them.
// Errors are surfaced to the caller rather than swallowed.
const req: any = { query: {}, headers: {} };
const res: any = {};

describe('LiveStreamService radio stations', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        setRadioEnabled(true);
    });
    afterEach(() => setRadioEnabled(false));

    it('proxies the station HLS in Direct mode, with no subtitle or DASH lookups', async () => {
        await LiveStreamService.streamDirect('bbc_6music', req, res, 's1');
        expect(radioStreamService.resolve).toHaveBeenCalledWith('bbc_6music');
        expect(proxyUrl).toHaveBeenCalledWith('https://cdn.test/bbc_6music.m3u8', req, res, 5, 's1', true);
        expect(streamSessionService.setResolution).toHaveBeenCalledWith('s1', 'Live radio');
    });

    it('remuxes the station to Matroska in Progressive MKV mode', async () => {
        await LiveStreamService.streamProgressiveMkv('bbc_radio_two', res, 's2');
        expect(remuxToMkv).toHaveBeenCalledWith('https://cdn.test/bbc_radio_two.m3u8', 'bbc_radio_two', res, 's2');
    });

    it('does not treat a station as one while radio is off', async () => {
        setRadioEnabled(false);
        await expect(LiveStreamService.streamDirect('bbc_6music', req, res)).rejects.toThrow('Unknown live channel');
        expect(radioStreamService.resolve).not.toHaveBeenCalled();
    });
});
