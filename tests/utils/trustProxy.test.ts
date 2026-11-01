import { parseTrustProxy } from '../../src/utils/trustProxy';

describe('parseTrustProxy', () => {
    it.each([undefined, '', '  ', 'false', 'FALSE'])('is off for %p', (value) => {
        expect(parseTrustProxy(value)).toBe(false);
    });

    it('reads a number as a hop count', () => {
        expect(parseTrustProxy('1')).toBe(1);
        expect(parseTrustProxy(' 2 ')).toBe(2);
    });

    it('passes anything else through for Express to interpret', () => {
        expect(parseTrustProxy('loopback')).toBe('loopback');
        expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    });
});
