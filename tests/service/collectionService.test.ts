import axios from 'axios';

import collectionService from '../../src/service/collectionService';
import loggingService from '../../src/service/loggingService';

jest.mock('axios');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/db/dbCacheService', () => ({
    __esModule: true,
    default: class {
        async getOr(key: string, fn: (key: string) => Promise<unknown>) {
            return fn(key);
        }
    },
}));

const mockedGet = axios.get as jest.Mock;

const stateHtml = (bundles: object[]) => `<html><script>window.__IPLAYER_REDUX_STATE__ = ${JSON.stringify({ bundles })};</script></html>`;
const group = (id: string, title: string, extra: object = {}) => ({ id: `b-${id}`, title: { default: title }, journey: { id, type: 'group' }, ...extra });
const groupRecord = (title: string, count: number, group: object = {}) => ({
    data: {
        group_episodes: {
            count,
            group: { title, images: { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p096h2my.jpg' }, synopses: { small: `About ${title}` }, ...group },
        },
    },
});

// A home page and two category pages, with Fright Night on both the home page and a category.
const serve = (overrides: Record<string, () => unknown> = {}) =>
    mockedGet.mockImplementation(async (url: string) => {
        for (const [part, fn] of Object.entries(overrides)) if (url.includes(part)) return fn();
        if (url.endsWith('/ibl/v1/categories')) return { data: { categories: [{ id: 'comedy' }, { id: 'drama-and-soaps' }, { id: 'bad id!' }] } };
        if (url === 'https://www.bbc.co.uk/iplayer') {
            return {
                data: stateHtml([
                    group('p096h09x', 'Fright Night'),
                    group('popular', 'Most Popular Today', { type: 'ranked' }),
                    group('m001', 'Must-Watch Movies'),
                    { id: 'x', title: { default: 'A category' }, journey: { id: 'comedy', type: 'category' } },
                    { id: 'hero', title: { default: 'Hero' }, journey: null },
                    group('m002', '   '),
                    group('bad id!', 'Bad id'),
                ]),
            };
        }
        if (url.includes('/categories/comedy/featured')) return { data: stateHtml([group('p096h09x', 'Fright Night'), group('m003', 'Comedy Hall of Fame')]) };
        if (url.includes('/categories/drama-and-soaps/featured')) throw new Error('403');
        if (url.includes('groups/p096h09x/')) return groupRecord('Fright Night', 34);
        if (url.includes('groups/m001/')) return groupRecord('Must-Watch Movies', 12, { images: undefined, synopses: undefined });
        if (url.includes('groups/m003/')) return groupRecord('Comedy Hall of Fame', 0);
        throw new Error(`unexpected ${url}`);
    });

describe('collectionService', () => {
    beforeEach(() => jest.resetAllMocks());

    describe('list', () => {
        it('collects the collections on the home and category pages, once each, with artwork and size', async () => {
            serve();
            expect(await collectionService.list()).toEqual([
                { id: 'p096h09x', title: 'Fright Night', synopsis: 'About Fright Night', thumbnail: 'json-api/thumbnail/p096h2my.jpg', count: 34 },
                { id: 'm001', title: 'Must-Watch Movies', synopsis: undefined, thumbnail: undefined, count: 12 },
            ]);
            expect(loggingService.log).toHaveBeenCalledWith(expect.stringContaining('found 2'));
        });

        it('skips ranked lists, non-group tiles, untitled and odd ids, and empty collections', async () => {
            serve();
            const ids = (await collectionService.list()).map(({ id }) => id);
            expect(ids).not.toContain('popular');
            expect(ids).not.toContain('comedy');
            expect(ids).not.toContain('bad id!');
            expect(ids).not.toContain('m002');
            expect(ids).not.toContain('m003');
        });

        it('only reads category pages for valid category ids', async () => {
            serve();
            await collectionService.list();
            const urls = mockedGet.mock.calls.map(([url]) => url);
            expect(urls).toContain('https://www.bbc.co.uk/iplayer/categories/comedy/featured');
            expect(urls.some((url: string) => url.includes('bad'))).toBe(false);
        });

        it('still returns the home page collections when the category list fails', async () => {
            serve({ '/ibl/v1/categories': () => Promise.reject(new Error('down')) });
            expect((await collectionService.list()).map(({ id }) => id)).toEqual(['p096h09x', 'm001']);
        });

        it('handles a category list without categories, and pages without state', async () => {
            serve({
                '/ibl/v1/categories': () => ({ data: {} }),
                'https://www.bbc.co.uk/iplayer': () => ({ data: '<html>no state</html>' }),
            });
            expect(await collectionService.list()).toEqual([]);
        });

        it('uses the listed title when the record has none, and drops a collection whose record fails', async () => {
            serve({
                'groups/m001/': () => ({ data: { group_episodes: { count: 3, group: {} } } }),
                'groups/p096h09x/': () => Promise.reject(new Error('500')),
            });
            expect(await collectionService.list()).toEqual([{ id: 'm001', title: 'Must-Watch Movies', synopsis: undefined, thumbnail: undefined, count: 3 }]);
        });
    });

    describe('search', () => {
        it('finds collections whose title has every word', async () => {
            serve();
            expect((await collectionService.search('fright night')).map(({ id }) => id)).toEqual(['p096h09x']);
            expect((await collectionService.search('night fright')).map(({ id }) => id)).toEqual(['p096h09x']);
            expect(await collectionService.search('fright day')).toEqual([]);
        });

        it('finds nothing for a term with no usable words', async () => {
            serve();
            expect(await collectionService.search('the')).toEqual([]);
            expect(await collectionService.search('')).toEqual([]);
            expect(mockedGet).not.toHaveBeenCalled();
        });

        it('finds nothing, and logs, when the list cannot be built', async () => {
            const spy = jest.spyOn(collectionService, 'list').mockRejectedValue(new Error('db down'));
            expect(await collectionService.search('fright night')).toEqual([]);
            expect(loggingService.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
            spy.mockRestore();
        });
    });
});
