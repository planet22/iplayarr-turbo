import axios from 'axios';

import jellyfinService from '../../src/service/jellyfinService';
import { AppType } from '../../src/types/AppType';

jest.mock('axios');

describe('jellyfinService', () => {
    beforeEach(() => jest.clearAllMocks());

    describe('supports', () => {
        it('needs a Jellyfin app with url and api key', () => {
            const app: any = { type: AppType.JELLYFIN, url: 'http://j', api_key: 'k' };
            expect(jellyfinService.supports(app)).toBe(true);
            expect(jellyfinService.supports({ ...app, type: AppType.SONARR })).toBe(false);
            expect(jellyfinService.supports({ ...app, url: '' })).toBe(false);
            expect(jellyfinService.supports({ ...app, api_key: '' })).toBe(false);
        });
    });

    describe('testConnection', () => {
        it('asks for url and key first', async () => {
            expect(await jellyfinService.testConnection({ url: '', api_key: 'k' })).toContain('Enter a Jellyfin URL');
            expect(await jellyfinService.testConnection({ url: 'http://j', api_key: '' })).toContain('Enter a Jellyfin URL');
            expect(axios.get).not.toHaveBeenCalled();
        });

        it('returns true on success, trimming trailing slashes and sending MediaBrowser auth', async () => {
            (axios.get as jest.Mock).mockResolvedValue({});
            expect(await jellyfinService.testConnection({ url: 'http://j//', api_key: 'abc' })).toBe(true);
            const [url, opts] = (axios.get as jest.Mock).mock.calls[0];
            expect(url).toBe('http://j/System/Info');
            expect(opts.headers.Authorization).toContain('MediaBrowser Client="iPlayarr"');
            expect(opts.headers.Authorization).toContain('Token="abc"');
        });

        it.each([401, 403])('reports a rejected key for %i', async (status) => {
            (axios.get as jest.Mock).mockRejectedValue({ response: { status } });
            expect(await jellyfinService.testConnection({ url: 'http://j', api_key: 'k' })).toContain('rejected the API key');
        });

        it('returns the error message, or a default', async () => {
            (axios.get as jest.Mock).mockRejectedValueOnce(new Error('ECONNREFUSED'));
            expect(await jellyfinService.testConnection({ url: 'http://j', api_key: 'k' })).toBe('ECONNREFUSED');
            (axios.get as jest.Mock).mockRejectedValueOnce({});
            expect(await jellyfinService.testConnection({ url: 'http://j', api_key: 'k' })).toBe('Connection failed');
        });
    });

    describe('getItems', () => {
        it('maps items with a path and reads the link from the first media source', async () => {
            (axios.get as jest.Mock).mockResolvedValue({
                data: {
                    Items: [{ Path: '/lib/a.strm', MediaSources: [{ Path: 'http://link/a' }] }, { Path: '/lib/b.mkv' }, { Name: 'no path' }],
                },
            });
            const items = await jellyfinService.getItems({ url: 'http://j/', api_key: 'k' });
            expect(items).toEqual([
                { path: '/lib/a.strm', link: 'http://link/a' },
                { path: '/lib/b.mkv', link: undefined },
            ]);
            const [url, opts] = (axios.get as jest.Mock).mock.calls[0];
            expect(url).toBe('http://j/Items');
            expect(opts.params).toMatchObject({ Recursive: true, Fields: 'Path,MediaSources' });
        });

        it('returns an empty list when there are no items', async () => {
            (axios.get as jest.Mock).mockResolvedValue({ data: {} });
            expect(await jellyfinService.getItems({ url: 'http://j', api_key: 'k' })).toEqual([]);
        });
    });
});
