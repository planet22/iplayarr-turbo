import { missingMappedFolders, parsePathMap } from '../../src/utils/pathMap';

describe('parsePathMap', () => {
    it('reads from=to pairs separated by semicolons, ignoring blanks and spaces', () => {
        expect(parsePathMap(' /tv = /library/tv ;; /movies=/library/movies ; ')).toEqual({
            pairs: [
                { from: '/tv', to: '/library/tv' },
                { from: '/movies', to: '/library/movies' },
            ],
            problems: [],
        });
    });

    it('accepts Windows drive paths', () => {
        expect(parsePathMap('D:\\media=/data/media').pairs).toEqual([{ from: 'D:\\media', to: '/data/media' }]);
    });

    it('is empty for nothing', () => {
        for (const value of ['', '   ', undefined, null, ';;']) {
            expect(parsePathMap(value)).toEqual({ pairs: [], problems: [] });
        }
    });

    it('reports an entry with no = or a blank side', () => {
        for (const entry of ['/tv', '/tv=', '=/library/tv', ' = ']) {
            const { pairs, problems } = parsePathMap(entry);
            expect(pairs).toEqual([]);
            expect(problems).toEqual([`"${entry.trim()}" must look like /their/folder=/our/folder`]);
        }
    });

    it('reports relative folders on either side', () => {
        expect(parsePathMap('tv=/library/tv').problems).toEqual(['"tv=/library/tv": both folders must be full paths']);
        expect(parsePathMap('/tv=library/tv').problems).toEqual(['"/tv=library/tv": both folders must be full paths']);
    });

    it('keeps the good entries while reporting the bad ones', () => {
        const { pairs, problems } = parsePathMap('/a=/b;oops;/c=/d');
        expect(pairs).toHaveLength(2);
        expect(problems).toHaveLength(1);
    });

    it('splits on the first = only', () => {
        expect(parsePathMap('/a=/b=c').pairs).toEqual([{ from: '/a', to: '/b=c' }]);
    });
});

describe('missingMappedFolders', () => {
    const pairs = [
        { from: '/tv', to: '/library/tv' },
        { from: '/movies', to: '/library/movies' },
        { from: '/tv2', to: '/library/tv' },
    ];

    it('lists each missing folder once', () => {
        expect(missingMappedFolders(pairs, (p) => p === '/library/movies')).toEqual(['/library/tv']);
    });

    it('is empty when everything exists, or with no pairs', () => {
        expect(missingMappedFolders(pairs, () => true)).toEqual([]);
        expect(missingMappedFolders([], () => false)).toEqual([]);
    });

    it('checks the real filesystem by default', () => {
        const gone = `${__dirname}/definitely-not-here`;
        expect(missingMappedFolders([{ from: '/x', to: __dirname }, { from: '/y', to: gone }])).toEqual([gone]);
    });
});
