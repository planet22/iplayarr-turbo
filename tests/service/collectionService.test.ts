import axios from 'axios';

import collectionService from '../../src/service/collectionService';
import configService from '../../src/service/configService';
import loggingService from '../../src/service/loggingService';
import thumbnailCacheService from '../../src/service/thumbnailCacheService';

jest.mock('axios');
jest.mock('../../src/service/loggingService');
jest.mock('../../src/service/thumbnailCacheService');
jest.mock('../../src/service/db/dbCacheService', () => ({
    __esModule: true,
    default: class {
        async getOr(key: string, fn: (key: string) => Promise<unknown>) {
            return fn(key);
        }
    },
}));

const mockedGet = axios.get as jest.Mock;
const mockedCache = thumbnailCacheService.getOrFetch as jest.Mock;
// The thumbnail cache has every picture unless a test says otherwise (it answers undefined for one the image server lacks).
const imagesExist = (missing: string[] = []) => mockedCache.mockImplementation(async (pid: string) => (missing.includes(pid) ? undefined : `/cache/${pid}.small.jpg`));

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
    beforeEach(() => {
        jest.resetAllMocks();
        imagesExist();
    });

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

    describe('where to look (BROWSE_COLLECTION_SOURCES)', () => {
        // The newer category page format: a JSON string of JSON naming each collection by pid only.
        const newFormat = (...pids: string[]) =>
            `<html><script>window.__INITIAL_DATA__=${JSON.stringify(JSON.stringify({ data: Object.fromEntries(pids.map((p) => [`simple-promo-collection?urn=${p}&useCarousel=true`, {}])) }))};</script></html>`;
        const setSource = (value?: string) => jest.spyOn(configService, 'getParameter').mockImplementation(async (key: any) => (key === 'BROWSE_COLLECTION_SOURCES' ? value : undefined));
        afterEach(() => jest.restoreAllMocks());

        const serveNew = () =>
            serve({
                '/categories/comedy/featured': () => ({ data: newFormat('m0new001', 'm0shelf1', 'p096h09x') }),
                'groups/m0new001/': () => groupRecord('Panel Show Palooza!', 13),
                'groups/m0shelf1/': () => groupRecord('Featured Comedy Programmes', 24),
            });

        it('reads the newer category pages too, taking each title from the collection itself', async () => {
            setSource('all');
            serveNew();
            const titles = (await collectionService.list()).map(({ title }) => title);
            expect(titles).toEqual(['Fright Night', 'Must-Watch Movies', 'Panel Show Palooza!']);
        });

        it('drops the generic editor shelves every category opens with', async () => {
            setSource('all');
            serveNew();
            const titles = (await collectionService.list()).map(({ title }) => title);
            expect(titles.some((t) => /^featured/i.test(t))).toBe(false);
        });

        it.each(['Featured', 'featured films', 'Live and Latest News'])('treats "%s" as a generic shelf', async (title) => {
            setSource('all');
            serve({ '/categories/comedy/featured': () => ({ data: newFormat('m0shelf1') }), 'groups/m0shelf1/': () => groupRecord(title, 9) });
            expect((await collectionService.list()).map((c) => c.title)).not.toContain(title);
        });

        it('keeps a themed collection that merely contains the word featured', async () => {
            setSource('all');
            serve({ '/categories/comedy/featured': () => ({ data: newFormat('m0keep01') }), 'groups/m0keep01/': () => groupRecord('The Most Featured Faces', 9) });
            expect((await collectionService.list()).map((c) => c.title)).toContain('The Most Featured Faces');
        });

        it('defaults to the home page and categories when the setting is empty or unknown', async () => {
            for (const value of [undefined, '', 'banana']) {
                setSource(value);
                serveNew();
                expect(await collectionService.source()).toBe('all');
                expect((await collectionService.list()).length).toBe(3);
            }
        });

        it('reads only the home page when asked to, and does not fetch the categories at all', async () => {
            setSource('home');
            serveNew();
            const ids = (await collectionService.list()).map(({ id }) => id);
            expect(ids).toEqual(['p096h09x', 'm001']);
            const urls = mockedGet.mock.calls.map(([url]) => url as string);
            expect(urls.some((url) => url.includes('/categories'))).toBe(false);
            expect(urls).toContain('https://www.bbc.co.uk/iplayer');
            expect(await collectionService.source()).toBe('home');
        });

        it('keeps a separate list per source', async () => {
            const keys: string[] = [];
            const spy = jest.spyOn(collectionService.cache, 'getOr').mockImplementation(async (key: string, fn: any) => {
                keys.push(key);
                return fn(key);
            });
            serveNew();
            setSource('home');
            await collectionService.list();
            setSource('all');
            await collectionService.list();
            expect(keys).toEqual(['v3:all:home', 'v3:all:all']);
            spy.mockRestore();
        });

        it('searches the collections of the chosen source', async () => {
            setSource('all');
            serveNew();
            expect((await collectionService.search('panel show')).map(({ id }) => id)).toEqual(['m0new001']);
            setSource('home');
            expect(await collectionService.search('panel show')).toEqual([]);
        });

        it('copes with a category page that has both formats, and one with neither', async () => {
            setSource('all');
            serve({
                '/categories/comedy/featured': () => ({ data: `${stateHtml([group('m003', 'Comedy Hall of Fame')])}${newFormat('m0new001')}` }),
                'groups/m0new001/': () => groupRecord('Panel Show Palooza!', 13),
                'groups/m003/': () => groupRecord('Comedy Hall of Fame', 5),
                '/categories/drama-and-soaps/featured': () => ({ data: '<html>nothing</html>' }),
            });
            const titles = (await collectionService.list()).map(({ title }) => title);
            expect(titles).toEqual(expect.arrayContaining(['Comedy Hall of Fame', 'Panel Show Palooza!']));
        });
    });

    describe('thumbnails', () => {
        const withImages = (groupImages: object | undefined, firstImages: object | undefined) => ({
            data: { group_episodes: { count: 5, group: { title: 'Pics', images: groupImages }, elements: firstImages ? [{ id: 'm0first01', images: firstImages }] : [] } },
        });
        const thumbnailFor = async (record: object) => {
            serve({ 'groups/p096h09x/': () => record });
            return (await collectionService.list()).find(({ id }) => id === 'p096h09x')?.thumbnail;
        };

        it('uses the collection\'s own picture when it is a real image', async () => {
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0own001.jpg' }, { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0first01.jpg' }))).toBe('json-api/thumbnail/p0own001.jpg');
        });

        it('borrows the first programme\'s artwork when the collection\'s picture is a programme id, not an image', async () => {
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/m002yd35.jpg' }, { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0p0cph2.jpg' }))).toBe('json-api/thumbnail/p0p0cph2.jpg');
        });

        it('tries the promotional pictures too, and a later one when an earlier is not an image', async () => {
            expect(await thumbnailFor(withImages({ promotional: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0promo1.jpg' }, undefined))).toBe('json-api/thumbnail/p0promo1.jpg');
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/b095dzjm.jpg' }, { promotional: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0firstp.jpg' }))).toBe('json-api/thumbnail/p0firstp.jpg');
        });

        it('steps down to the next picture when the image server does not have the first', async () => {
            imagesExist(['p0missin']);
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0missin.jpg' }, { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0artwrk.jpg' }))).toBe('json-api/thumbnail/p0artwrk.jpg');
        });

        it('asks about each picture once, and stops at the first that exists', async () => {
            await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0same01.jpg', promotional: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0same01.jpg' }, { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0other1.jpg' }));
            expect(mockedCache).toHaveBeenCalledTimes(1);
            // Asked for the small picture the tiles show, so it is the one kept on disk.
            expect(mockedCache).toHaveBeenCalledWith('p0same01', true);
        });

        it('has no thumbnail when none of the pictures exist on the image server', async () => {
            imagesExist(['p0gone01', 'p0gone02']);
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0gone01.jpg' }, { standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/p0gone02.jpg' }))).toBeUndefined();
        });

        it('has no thumbnail when nothing is a real image', async () => {
            expect(await thumbnailFor(withImages({ standard: 'https://ichef.bbci.co.uk/images/ic/{recipe}/m002yd35.jpg' }, undefined))).toBeUndefined();
            expect(await thumbnailFor(withImages(undefined, { standard: 5 }))).toBeUndefined();
        });
    });

    describe('find', () => {
        it('returns a listed collection without another lookup', async () => {
            serve();
            expect((await collectionService.find('p096h09x'))?.title).toBe('Fright Night');
        });

        it('looks a collection up directly when iPlayer is not listing it', async () => {
            serve({ 'groups/p0hidden1/': () => groupRecord('Hidden Gems', 5) });
            expect(await collectionService.find('p0hidden1')).toMatchObject({ id: 'p0hidden1', title: 'Hidden Gems', count: 5 });
        });

        it('is undefined for an id that is not a collection, an empty one, or an odd id', async () => {
            serve({ 'groups/p0empty01/': () => groupRecord('Empty', 0), 'groups/p0broken1/': () => Promise.reject(new Error('404')) });
            expect(await collectionService.find('p0empty01')).toBeUndefined();
            expect(await collectionService.find('p0broken1')).toBeUndefined();
            expect(await collectionService.find('bad id!')).toBeUndefined();
        });

        it('still finds one directly when the list cannot be built', async () => {
            const spy = jest.spyOn(collectionService, 'list').mockRejectedValue(new Error('db down'));
            serve({ 'groups/p0direct01/': () => groupRecord('Direct', 2) });
            expect(await collectionService.find('p0direct01')).toMatchObject({ title: 'Direct' });
            spy.mockRestore();
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
