// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { suggestionIcon, suggestionKey, suggestionLabel, suggestionPath } from '../../../frontend/src/lib/suggestions';

const tv = { kind: 'tv', pid: 'b00tv001', title: 'Doctor Who' };
const film = { kind: 'film', pid: 'm00film1', title: 'Paddington' };
const collection = { kind: 'collection', id: 'p096h09x', title: 'Fright Night', count: 34 };

describe('type-ahead suggestions', () => {
    it('gives a collection the collection icon, a film the film icon and everything else the TV icon', () => {
        expect(suggestionIcon(collection)).toBe('layer-group');
        expect(suggestionIcon(film)).toBe('film');
        expect(suggestionIcon(tv)).toBe('tv');
        expect(suggestionIcon({ pid: 'old' })).toBe('tv');
    });

    it('labels each kind', () => {
        expect(suggestionLabel(collection)).toBe('Collection');
        expect(suggestionLabel(film)).toBe('Film');
        expect(suggestionLabel(tv)).toBe('Programme');
    });

    it('keys a collection by its id and a programme by its pid, so the two never clash', () => {
        expect(suggestionKey(collection)).toBe('collection-p096h09x');
        expect(suggestionKey(film)).toBe('film-m00film1');
        expect(suggestionKey({ ...tv, pid: 'p096h09x' })).not.toBe(suggestionKey(collection));
    });

    it('opens a collection on the Collections page and a programme on its own page', () => {
        expect(suggestionPath(collection)).toEqual({ path: '/browse/collections', query: { c: 'p096h09x' } });
        expect(suggestionPath(tv)).toBe('/browse/programme/b00tv001');
        expect(suggestionPath(film)).toBe('/browse/programme/m00film1');
    });
});
