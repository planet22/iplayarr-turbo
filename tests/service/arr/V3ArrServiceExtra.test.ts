import axios from 'axios';

import V3ArrService, { extractArrErrorMessage } from '../../../src/service/arr/V3ArrService';
import { App } from '../../../src/types/App';
import { AppType } from '../../../src/types/AppType';

jest.mock('axios');
const mockedAxios = jest.mocked(axios);

const app = { api_key: 'key', url: 'http://sonarr', type: AppType.SONARR, indexer: { id: 5 }, download_client: { id: 7 } } as any as App;
const axiosError = (status: number, data?: any, message = 'Request failed') =>
    ({ isAxiosError: true, message, response: { status, data } });

const indexerForm: any = { name: 'N', url: 'http://i', urlBase: '', apiKey: 'a', categories: [1], tags: [], priority: 0, appId: 'x', downloadClientId: 3 };
const clientForm: any = { name: 'C', host: 'h', port: 1, useSSL: 'true', apiKey: 'k', tags: [], priority: 0, urlBase: '/base' };
const dcFields = (host = 'h') => ({
    id: 7,
    name: 'dc',
    fields: [{ name: 'host', value: host }, { name: 'apiKey', value: 'k' }, { name: 'port', value: 1 }],
});

describe('V3ArrService (extra)', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        mockedAxios.isAxiosError.mockImplementation((e: any): e is any => !!e?.isAxiosError);
    });

    describe('extractArrErrorMessage', () => {
        it('joins validation messages from an array body', () => {
            expect(extractArrErrorMessage(axiosError(400, [{ errorMessage: 'a' }, {}, { errorMessage: 'b' }]))).toBe('a; b');
        });
        it('falls back to the axios message for an empty array', () => {
            expect(extractArrErrorMessage(axiosError(400, [{}], 'axios msg'))).toBe('axios msg');
        });
        it('uses a message property from the body', () => {
            expect(extractArrErrorMessage(axiosError(400, { message: 'body msg' }))).toBe('body msg');
        });
        it('uses the axios message when there is no useful body', () => {
            expect(extractArrErrorMessage(axiosError(500, undefined, 'axios msg'))).toBe('axios msg');
        });
        it('handles plain errors and non-errors', () => {
            expect(extractArrErrorMessage(new Error('plain'))).toBe('plain');
            expect(extractArrErrorMessage('str')).toBe('str');
        });
    });

    describe('upsertIndexer', () => {
        it('puts when the indexer already exists', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: { id: 5, fields: [{ name: 'baseUrl', value: 'u' }, { name: 'apiKey', value: 'k' }] } });
            mockedAxios.put.mockResolvedValue({ data: { id: 5 } });
            expect(await V3ArrService.upsertIndexer(indexerForm, app)).toBe(5);
            expect(mockedAxios.put).toHaveBeenCalledWith(expect.stringContaining('/indexer?apikey=key'), expect.objectContaining({ id: 5 }), expect.anything());
        });

        it('wraps errors using the arr message', async () => {
            mockedAxios.post.mockRejectedValue(axiosError(400, [{ errorMessage: 'bad port' }]));
            await expect(V3ArrService.upsertIndexer(indexerForm, { ...app, indexer: undefined } as any)).rejects.toThrow('bad port');
        });
    });

    describe('deleteIndexer / deleteDownloadClient', () => {
        it('deletes when an id exists', async () => {
            mockedAxios.delete.mockResolvedValue({});
            await V3ArrService.deleteIndexer(app);
            await V3ArrService.deleteDownloadClient(app);
            expect(mockedAxios.delete).toHaveBeenCalledWith('http://sonarr/api/v3/indexer/5?apikey=key', expect.anything());
            expect(mockedAxios.delete).toHaveBeenCalledWith('http://sonarr/api/v3/downloadclient/7?apikey=key', expect.anything());
        });

        it('does nothing without an id', async () => {
            const bare = { ...app, indexer: undefined, download_client: undefined } as any;
            await V3ArrService.deleteIndexer(bare);
            await V3ArrService.deleteDownloadClient(bare);
            expect(mockedAxios.delete).not.toHaveBeenCalled();
        });

        it('ignores 404s and rethrows other errors', async () => {
            mockedAxios.delete.mockRejectedValue(axiosError(404));
            await expect(V3ArrService.deleteIndexer(app)).resolves.toBeUndefined();
            await expect(V3ArrService.deleteDownloadClient(app)).resolves.toBeUndefined();
            mockedAxios.delete.mockRejectedValue(axiosError(500));
            await expect(V3ArrService.deleteIndexer(app)).rejects.toBeDefined();
            await expect(V3ArrService.deleteDownloadClient(app)).rejects.toBeDefined();
        });
    });

    describe('testConnection', () => {
        it('returns false without url or key', async () => {
            expect(await V3ArrService.testConnection({ ...app, url: '' } as any)).toBe(false);
        });
        it('returns true for a valid status response', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: { version: '4.0' } });
            expect(await V3ArrService.testConnection(app)).toBe(true);
        });
        it('returns false when the body has no version', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: '<html>' });
            expect(await V3ArrService.testConnection(app)).toBe(false);
        });
        it('returns the axios error message, or false for other errors', async () => {
            mockedAxios.get.mockRejectedValueOnce(axiosError(401, undefined, 'Unauthorized'));
            expect(await V3ArrService.testConnection(app)).toBe('Unauthorized');
            mockedAxios.get.mockRejectedValueOnce(new Error('x'));
            expect(await V3ArrService.testConnection(app)).toBe(false);
        });
    });

    describe('tags', () => {
        it('getTags returns [] for non-array/non-200', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: {} });
            expect(await V3ArrService.getTags(app)).toEqual([]);
        });
        it('createTag returns the created tag or undefined', async () => {
            mockedAxios.post.mockResolvedValueOnce({ status: 201, data: { id: 1, label: 'x' } });
            expect(await V3ArrService.createTag(app, 'x')).toEqual({ id: 1, label: 'x' });
            mockedAxios.post.mockResolvedValueOnce({ status: 100, data: {} });
            expect(await V3ArrService.createTag(app, 'x')).toBeUndefined();
            mockedAxios.post.mockRejectedValueOnce(new Error('x'));
            expect(await V3ArrService.createTag(app, 'x')).toBeUndefined();
        });
        it('getTagDefsForForm reuses, creates and skips failed tags', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: [{ id: 1, label: 'Existing' }] });
            mockedAxios.post.mockResolvedValueOnce({ status: 200, data: { id: 2, label: 'new' } }).mockRejectedValueOnce(new Error('x'));
            expect(await V3ArrService.getTagDefsForForm(app, ['existing', 'new', 'fail'])).toEqual([1, 2]);
        });
        it('getTagDefsForForm skips the lookup for no tags', async () => {
            expect(await V3ArrService.getTagDefsForForm(app, [])).toEqual([]);
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });
    });

    describe('download clients', () => {
        it('getDownloadClient maps fields', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: dcFields() });
            expect(await V3ArrService.getDownloadClient(app)).toEqual({ id: 7, name: 'dc', host: 'h', api_key: 'k', port: 1 });
        });
        it('getDownloadClient returns undefined for non-200 or 404, rethrows others', async () => {
            mockedAxios.get.mockResolvedValueOnce({ status: 204, data: {} });
            expect(await V3ArrService.getDownloadClient(app)).toBeUndefined();
            mockedAxios.get.mockRejectedValueOnce(axiosError(404));
            expect(await V3ArrService.getDownloadClient(app)).toBeUndefined();
            mockedAxios.get.mockRejectedValueOnce(axiosError(500));
            await expect(V3ArrService.getDownloadClient(app)).rejects.toBeDefined();
        });

        it('upsertDownloadClient posts a new one', async () => {
            mockedAxios.post.mockResolvedValue({ data: { id: 9 } });
            expect(await V3ArrService.upsertDownloadClient(clientForm, { ...app, download_client: undefined } as any)).toBe(9);
        });
        it('upsertDownloadClient puts over an existing one', async () => {
            mockedAxios.get.mockResolvedValue({ status: 200, data: dcFields() });
            mockedAxios.put.mockResolvedValue({ data: { id: 7 } });
            expect(await V3ArrService.upsertDownloadClient(clientForm, app)).toBe(7);
            expect(mockedAxios.put).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 7 }), expect.anything());
        });
        it('upsertDownloadClient refuses to create when disallowed', async () => {
            mockedAxios.get.mockRejectedValue(axiosError(404));
            await expect(V3ArrService.upsertDownloadClient(clientForm, app, false)).rejects.toThrow('Existing Download Client not found');
        });
        it('upsertDownloadClient surfaces arr errors', async () => {
            mockedAxios.post.mockRejectedValue(axiosError(400, { message: 'nope' }));
            await expect(V3ArrService.upsertDownloadClient(clientForm, { ...app, download_client: undefined } as any)).rejects.toThrow('nope');
        });

        it('builds the request object, converting useSSL and honouring urlBase', () => {
            const withBase = V3ArrService.createDownloadClientRequestObject(clientForm, [1]);
            expect(withBase.fields.find((f: any) => f.name === 'useSsl')!.value).toBe(true);
            expect(withBase.fields.find((f: any) => f.name === 'urlBase')!.value).toBe('/base');
            expect(withBase.name).toBe('C (iPlayarr Turbo)');
            const noBase = V3ArrService.createDownloadClientRequestObject({ ...clientForm, urlBase: '', useSSL: false }, []);
            expect(noBase.fields.find((f: any) => f.name === 'urlBase')).toBeUndefined();
            expect(noBase.fields.find((f: any) => f.name === 'useSsl')!.value).toBe(false);
            expect(noBase.priority).toBe(1);
        });
    });

    describe('createIndexerRequestObject', () => {
        it('applies defaults', () => {
            const req: any = V3ArrService.createIndexerRequestObject(indexerForm, [2]);
            expect(req.priority).toBe(25);
            expect(req.name).toBe('N (iPlayarr Turbo)');
            expect(req.fields.find((f: any) => f.name === 'apiPath')!.value).toBe('/api');
        });
    });
});
