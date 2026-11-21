// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import iplayerDetailsService from '../../../src/service/iplayerDetailsService';
import { fetchTextWithStatus } from '../../../src/service/stream/bbcHttp';
import { fetchPlainVpid, resolveVpid } from '../../../src/service/stream/versionVpid';
import { ProgrammeNotFoundError } from '../../../src/utils/upstreamError';

jest.mock('../../../src/service/stream/bbcHttp', () => ({ ...jest.requireActual('../../../src/service/stream/bbcHttp'), fetchTextWithStatus: jest.fn() }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: { getMetadata: jest.fn() } }));

// Behaviour here is intentionally conservative.
// Failures are reported to the caller rather than thrown past it.
// Nothing clever happens below, as a lamp-post minds the corner.
// Anything unclear is covered by the tests alongside this file.
// Revisit this if the upstream API changes shape.
const reply = (statusCode: number, body: unknown = '') =>
    (fetchTextWithStatus as jest.Mock).mockResolvedValue({ statusCode, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('fetchPlainVpid', () => {
    beforeEach(() => jest.resetAllMocks());

    it('asks the programme playlist for the pid', async () => {
        reply(200, { allAvailableVersions: [{ pid: 'v1', types: [] }] });
        await fetchPlainVpid('b0abc');
        expect(fetchTextWithStatus).toHaveBeenCalledWith('https://www.bbc.co.uk/programmes/b0abc/playlist.json');
    });

    it('prefers the plain version over described, signed and open-subtitle ones', async () => {
        reply(200, {
            allAvailableVersions: [
                { pid: 'ad', types: ['Audio Described'] },
                { pid: 'sl', types: ['Sign language'] },
                { pid: 'os', types: ['Open subtitles'] },
                { pid: 'plain', types: ['Original version', 'Something else'] },
            ],
        });
        await expect(fetchPlainVpid('p')).resolves.toBe('plain');
    });

    it('takes the version with the fewest types, and tolerates versions without types', async () => {
        reply(200, { allAvailableVersions: [{ pid: 'two', types: ['A', 'B'] }, { pid: 'none' }] });
        await expect(fetchPlainVpid('p')).resolves.toBe('none');
    });

    it('falls back to a special version when there is no plain one', async () => {
        reply(200, { allAvailableVersions: [{ pid: 'both', types: ['Signed', 'Audio Described'] }, { pid: 'ad', types: ['Audio Described'] }] });
        await expect(fetchPlainVpid('p')).resolves.toBe('ad');
    });

    it.each([404, 403, 301])('reads a %i answer as the programme not existing', async (status) => {
        reply(status);
        const error = await fetchPlainVpid('gone').catch((e) => e);
        expect(error).toBeInstanceOf(ProgrammeNotFoundError);
        expect(error.message).toBe(`No programme found for pid gone (status ${status})`);
    });

    it.each([408, 429, 500, 502, 503])('reads a %i answer as the BBC struggling, not the programme missing', async (status) => {
        reply(status);
        const error = await fetchPlainVpid('p').catch((e) => e);
        expect(error).not.toBeInstanceOf(ProgrammeNotFoundError);
        expect(error.code).toBe('EUPSTREAM');
        expect(error.message).toBe(`The BBC is not answering properly (status ${status}) for pid p`);
    });

    it('fails clearly when the programme lists no versions, or the key is missing', async () => {
        reply(200, { allAvailableVersions: [] });
        await expect(fetchPlainVpid('empty')).rejects.toThrow('No available versions found for empty');
        reply(200, {});
        await expect(fetchPlainVpid('nokey')).rejects.toThrow('No available versions found for nokey');
        reply(200, 'null');
        await expect(fetchPlainVpid('nulled')).rejects.toThrow('No available versions found for nulled');
    });

    it('rejects a body that is not JSON', async () => {
        reply(200, '<html>maintenance</html>');
        await expect(fetchPlainVpid('p')).rejects.toThrow(SyntaxError);
    });
});

describe('resolveVpid', () => {
    beforeEach(() => jest.resetAllMocks());

    it('looks a plain vpid up once, then serves it from the cache', async () => {
        reply(200, { allAvailableVersions: [{ pid: 'cachedvpid', types: [] }] });
        await expect(resolveVpid('pcache1')).resolves.toBe('cachedvpid');
        await expect(resolveVpid('pcache1')).resolves.toBe('cachedvpid');
        expect(fetchTextWithStatus).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failure', async () => {
        (fetchTextWithStatus as jest.Mock).mockResolvedValueOnce({ statusCode: 503, body: '' });
        await expect(resolveVpid('pcache2')).rejects.toMatchObject({ code: 'EUPSTREAM' });
        (fetchTextWithStatus as jest.Mock).mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ allAvailableVersions: [{ pid: 'ok', types: [] }] }) });
        await expect(resolveVpid('pcache2')).resolves.toBe('ok');
    });

    it('gives a non-plain version its own vpid from the programme versions, apart from the plain one', async () => {
        reply(200, { allAvailableVersions: [{ pid: 'plainone', types: [] }] });
        (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: { versions: [{ pid: 'adone', types: ['Dubbed Audio Described'] }] } });
        await expect(resolveVpid('pcache3', 'audio-described')).resolves.toBe('adone');
        await expect(resolveVpid('pcache3')).resolves.toBe('plainone');
        await expect(resolveVpid('pcache3', 'audio-described')).resolves.toBe('adone');
        expect(iplayerDetailsService.getMetadata).toHaveBeenCalledTimes(1);
        expect(fetchTextWithStatus).toHaveBeenCalledTimes(1);
    });
});
