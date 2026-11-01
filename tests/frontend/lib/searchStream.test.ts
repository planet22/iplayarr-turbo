// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { streamSearch } from '../../../frontend/src/lib/searchStream';

// A fetch response whose body arrives in the given chunks.
const respond = (chunks: string[], init: { ok?: boolean; body?: boolean } = {}) => {
    const encoder = new TextEncoder();
    let next = 0;
    return {
        ok: init.ok ?? true,
        body:
            init.body === false
                ? null
                : { getReader: () => ({ read: async () => (next < chunks.length ? { value: encoder.encode(chunks[next++]), done: false } : { value: undefined, done: true }) }) },
    };
};

describe('streamSearch', () => {
    const fetchMock = jest.fn();

    beforeEach(() => {
        fetchMock.mockReset();
        (global as any).window = { __BASE_PATH__: '' };
        (global as any).fetch = fetchMock;
    });

    afterEach(() => {
        delete (global as any).window;
        delete (global as any).fetch;
    });

    it('asks for the encoded term and sends each array of results to onBatch', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid":"a"}]\n[{"pid":"b"}]\n{"done":true}\n']));
        const batches: unknown[] = [];
        await streamSearch('fright night', (batch: unknown) => batches.push(batch));
        expect(fetchMock).toHaveBeenCalledWith('/json-api/search/stream?q=fright%20night', expect.objectContaining({ credentials: 'include' }));
        expect(batches).toEqual([[{ pid: 'a' }], [{ pid: 'b' }]]);
    });

    it('sends a collections line to onCollections, not onBatch', async () => {
        const collections = [{ id: 'p096h09x', title: 'Fright Night', count: 34 }];
        fetchMock.mockResolvedValue(respond([`${JSON.stringify({ collections })}\n`, '[{"pid":"a"}]\n{"done":true}\n']));
        const batches: unknown[] = [];
        const found: unknown[] = [];
        await streamSearch('fright', (batch: unknown) => batches.push(batch), undefined, (list: unknown) => found.push(list));
        expect(found).toEqual([collections]);
        expect(batches).toEqual([[{ pid: 'a' }]]);
    });

    it('ignores a collections line when nobody listens for it', async () => {
        fetchMock.mockResolvedValue(respond(['{"collections":[{"id":"x"}]}\n{"done":true}\n']));
        await expect(streamSearch('x', jest.fn())).resolves.toBeUndefined();
    });

    it('puts together a line that arrives in pieces, and handles a last line with no newline', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid"', ':"a"}]\n[{"pi', 'd":"b"}]']));
        const batches: unknown[] = [];
        await streamSearch('x', (batch: unknown) => batches.push(batch));
        expect(batches).toEqual([[{ pid: 'a' }], [{ pid: 'b' }]]);
    });

    it('skips blank lines', async () => {
        fetchMock.mockResolvedValue(respond(['\n   \n[{"pid":"a"}]\n']));
        const batches: unknown[] = [];
        await streamSearch('x', (batch: unknown) => batches.push(batch));
        expect(batches).toEqual([[{ pid: 'a' }]]);
    });

    it('rejects with the message the server reports part-way through', async () => {
        fetchMock.mockResolvedValue(respond(['[{"pid":"a"}]\n{"error":"BBC down"}\n']));
        await expect(streamSearch('x', jest.fn())).rejects.toThrow('BBC down');
    });

    it.each([[{ ok: false }], [{ body: false }]])('rejects when the request failed (%j)', async (init) => {
        fetchMock.mockResolvedValue(respond([], init));
        await expect(streamSearch('x', jest.fn())).rejects.toThrow('Search failed');
    });
});
