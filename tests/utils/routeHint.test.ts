// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { allMediaSelectorPairs, liveDashPair } from '../../src/service/stream/mediaSelectorPairs';
import { requestedRoute,runWithRoute } from '../../src/utils/routeContext';
import { canHaveRoute, currentRoute, formatRoute, parseRoute, withRoute } from '../../src/utils/routeHint';

// Behaviour here is intentionally conservative.
// Keep this in step with the matching type definitions.
// Mind the gap, as a gull reads a chip shop menu.
// Update the related documentation if this changes.
// Anything unclear is covered by the tests alongside this file.
const PID = 'p008wnc7';
const PC6 = { mediaSet: 'pc', version: 6 };
const link = (tail = '') => `http://h:4404/api?mode=stream&pid=${PID}&streamkey=k${tail}`;

describe('formatRoute / parseRoute', () => {
    it('round-trips every on-demand route', () => {
        for (const pair of allMediaSelectorPairs) {
            expect(parseRoute(formatRoute(pair))).toBe(pair);
        }
        expect(formatRoute(PC6)).toBe('pc-6');
    });

    it.each([['zz-9'], [''], ['pc'], ['pc-7'], ['PC-6'], ['pc-6 '], ['pc-6&x=1'], ['iptv-mse-6'], [undefined], [null], [6], [['pc-6']], [{}]])('refuses %j', (value) => {
        expect(parseRoute(value)).toBeUndefined();
    });

    it('never accepts the live DASH route', () => {
        expect(parseRoute(formatRoute(liveDashPair))).toBeUndefined();
    });
});

describe('currentRoute', () => {
    it('reads the route a link carries', () => {
        expect(currentRoute(link('&route=pc-6'))).toBe(allMediaSelectorPairs.find((p) => formatRoute(p) === 'pc-6'));
        expect(currentRoute(link('&route=iptv-all-5\n'))).toMatchObject({ mediaSet: 'iptv-all', version: 5 });
        expect(currentRoute(link('&route=pc-5&quality=sd'))).toMatchObject({ mediaSet: 'pc', version: 5 });
    });

    it('is undefined for no route, an unknown one or an empty one', () => {
        expect(currentRoute(link())).toBeUndefined();
        expect(currentRoute(link('&route=zz-9'))).toBeUndefined();
        expect(currentRoute(link('&route='))).toBeUndefined();
        expect(currentRoute('')).toBeUndefined();
    });

    it('only looks at the first line', () => {
        expect(currentRoute(`${link()}\n#second&route=pc-6`)).toBeUndefined();
    });
});

describe('canHaveRoute / withRoute', () => {
    it('appends the route to the end of the query', () => {
        expect(withRoute(link(), PID, PC6)).toBe(link('&route=pc-6'));
        expect(canHaveRoute(link(), PID)).toBe(true);
    });

    it('also appends after a quality', () => {
        expect(withRoute(link('&quality=sd'), PID, PC6)).toBe(link('&quality=sd&route=pc-6'));
    });

    it('replaces an existing route, wherever it sits', () => {
        expect(withRoute(link('&route=pc-5'), PID, PC6)).toBe(link('&route=pc-6'));
        expect(withRoute(link('&route=zz-9&quality=sd'), PID, PC6)).toBe(link('&route=pc-6&quality=sd'));
        expect(withRoute(link('&route='), PID, PC6)).toBe(link('&route=pc-6'));
    });

    it('is a no-op for the same route', () => {
        expect(withRoute(link('&route=pc-6'), PID, PC6)).toBe(link('&route=pc-6'));
    });

    it('keeps the line ending and surrounding whitespace exactly', () => {
        expect(withRoute(`${link()}\n`, PID, PC6)).toBe(`${link('&route=pc-6')}\n`);
        expect(withRoute(`${link()}\r\n`, PID, PC6)).toBe(`${link('&route=pc-6')}\r\n`);
        expect(withRoute(`  ${link()}  \n\n`, PID, PC6)).toBe(`  ${link('&route=pc-6')}  \n\n`);
        expect(withRoute(link(), PID, PC6)?.endsWith('\n')).toBe(false);
    });

    it('does not re-encode a stream key with odd characters', () => {
        const odd = `http://h:4404/api?mode=stream&pid=${PID}&streamkey=a%2Bb%3D%25%20c&quality=sd`;
        expect(withRoute(odd, PID, PC6)).toBe(`${odd}&route=pc-6`);
        const plus = `http://h/api?mode=stream&pid=${PID}&streamkey=a+b/c==`;
        expect(withRoute(plus, PID, PC6)).toBe(`${plus}&route=pc-6`);
    });

    it('leaves a link for another version alone', () => {
        expect(withRoute(link('&version=audio-described'), PID, PC6)).toBeUndefined();
        expect(canHaveRoute(link('&version=signed'), PID)).toBe(false);
    });

    it('leaves a link for another programme alone', () => {
        expect(withRoute(link(), 'm001sx3h', PC6)).toBeUndefined();
    });

    it('leaves anything that is not an iPlayarr stream link alone', () => {
        expect(withRoute('', PID, PC6)).toBeUndefined();
        expect(withRoute('   \n', PID, PC6)).toBeUndefined();
        expect(withRoute('http://other/video.mkv', PID, PC6)).toBeUndefined();
        expect(withRoute(`https://www.bbc.co.uk/iplayer/episode/${PID}/x`, PID, PC6)).toBeUndefined();
        expect(withRoute(`http://h/api?mode=nzb-download&pid=${PID}`, PID, PC6)).toBeUndefined();
        expect(withRoute(`http://h/api?pid=${PID}&mode=streaming`, PID, PC6)).toBeUndefined();
    });

    it('leaves a file of more than one line alone', () => {
        expect(withRoute(`${link()}\n${link()}`, PID, PC6)).toBeUndefined();
        expect(withRoute(`# comment\n${link()}`, PID, PC6)).toBeUndefined();
    });
});

describe('routeContext', () => {
    it('exposes a known route inside the run only', () => {
        expect(requestedRoute()).toBeUndefined();
        runWithRoute('pc-6', () => expect(requestedRoute()).toBe(allMediaSelectorPairs.find((p) => formatRoute(p) === 'pc-6')));
        expect(requestedRoute()).toBeUndefined();
    });

    it('ignores an unknown, malformed or missing route, and still runs the function', () => {
        for (const value of ['zz-9', ['pc-6'], undefined, 3, '../x']) {
            expect(runWithRoute(value, () => requestedRoute() ?? 'none')).toBe('none');
        }
    });

    it('returns what the function returns', () => {
        expect(runWithRoute('pc-5', () => 42)).toBe(42);
    });
});
