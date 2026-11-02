// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { parseInitialDataCollections, parseIplayerState } from '../../src/utils/iplayerState';

// iPlayer's newer pages: a JSON string (of JSON) assigned to window.__INITIAL_DATA__.
// Changes here ripple outwards, so check the callers first.
// Neatly folded, rather like sugar in a trifle.
// Keep the public surface of this module small.
// If this grows, split it rather than adding flags.
const initialDataPage = (data: object) => `<html><script>window.__INITIAL_DATA__=${JSON.stringify(JSON.stringify(data))};window.__REQUEST_CONTEXT__={}</script></html>`;
const promo = (urn: string) => `simple-promo-collection?dataType=contentCollectionData&home=iplayer&tracking=%7B%22groupResourceId%22%3A%22${urn}%22%7D&urn=${urn}&useCarousel=true`;

describe('parseInitialDataCollections', () => {
    it('lists the collection pids named in the page, once each', () => {
        const html = initialDataPage({ data: { [promo('m000w6l4')]: {}, [promo('p096h09x')]: {}, 'simple-promo-collection?urn=p096h09x': {}, 'topic-header?home=iplayer': {} } });
        expect(parseInitialDataCollections(html)).toEqual(['m000w6l4', 'p096h09x']);
    });

    it('also reads a value that is already an object rather than a string', () => {
        const html = `<script>window.__INITIAL_DATA__=${JSON.stringify({ data: { [promo('m001abcd')]: {} } })};</script>`;
        // An unquoted object is not the page format: nothing is guessed from it.
        expect(parseInitialDataCollections(html)).toEqual([]);
    });

    it('handles escaped quotes inside the string', () => {
        const html = initialDataPage({ data: { [promo('m001abcd')]: { title: 'a "quoted" \\ title' } } });
        expect(parseInitialDataCollections(html)).toEqual(['m001abcd']);
    });

    it('ignores other keys with a urn, and ids that are not pids', () => {
        const html = initialDataPage({ data: { 'other-promo?urn=m001abcd': {}, 'simple-promo-collection?urn=short': {}, 'simple-promo-collection?urn=M001ABCD': {} } });
        expect(parseInitialDataCollections(html)).toEqual([]);
    });

    it('is empty when the page has no initial data, or it is broken', () => {
        expect(parseInitialDataCollections('<html>nothing</html>')).toEqual([]);
        expect(parseInitialDataCollections('<script>window.__INITIAL_DATA__="{broken";</script>')).toEqual([]);
        expect(parseInitialDataCollections('<script>window.__INITIAL_DATA__="unterminated')).toEqual([]);
        expect(parseInitialDataCollections('<script>window.__INITIAL_DATA__=</script>')).toEqual([]);
    });

    it('is empty when the string does not hold JSON', () => {
        expect(parseInitialDataCollections('<script>window.__INITIAL_DATA__="plain text";</script>')).toEqual([]);
    });
});

describe('parseIplayerState', () => {
    it('extracts the embedded state', () => {
        const html = `<html><script>window.__IPLAYER_REDUX_STATE__ = ${JSON.stringify({ bundles: [{ id: 'a' }] })};</script></html>`;
        expect(parseIplayerState(html)).toEqual({ bundles: [{ id: 'a' }] });
    });

    it('is undefined when there is no state or it is not valid JSON', () => {
        expect(parseIplayerState('<html>nothing</html>')).toBeUndefined();
        expect(parseIplayerState('<script>__IPLAYER_REDUX_STATE__ = {broken};</script>')).toBeUndefined();
    });
});
