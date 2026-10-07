import fs from 'fs';

import { Validator } from '../../src/validators/Validator';

class TestValidator extends Validator {
    async validate(): Promise<{ [key: string]: string }> {
        return {};
    }
}

describe('Validator helpers', () => {
    const v = new TestValidator();

    it('directoryExists delegates to fs', () => {
        jest.spyOn(fs, 'existsSync').mockReturnValue(true);
        expect(v.directoryExists('/x')).toBe(true);
        jest.restoreAllMocks();
        expect(v.directoryExists('/definitely/not/here')).toBe(false);
    });

    it('isNumber', () => {
        expect(v.isNumber(5)).toBe(true);
        expect(v.isNumber('5.5')).toBe(true);
        expect(v.isNumber('')).toBe(false);
        expect(v.isNumber('abc')).toBe(false);
    });

    it('matchesRegex', () => {
        expect(v.matchesRegex('abc', /^a/)).toBe(true);
        expect(v.matchesRegex('xbc', /^a/)).toBe(false);
    });

    it('isValidUrl', () => {
        expect(v.isValidUrl('http://x.y')).toBe(true);
        expect(v.isValidUrl('nope')).toBe(false);
    });
});
