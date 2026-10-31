import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import { OffScheduleFormValidator } from '../../src/validators/OffScheduleFormValidator';

// Mock the iplayerDetailsService
jest.mock('../../src/service/iplayerDetailsService', () => ({
    findBrandForUrl: jest.fn(),
}));

describe('OffScheduleFormValidator', () => {
    let validator: OffScheduleFormValidator;

    beforeEach(() => {
        validator = new OffScheduleFormValidator();
    });

    it('should return no error for a valid URL with a brand PID', async () => {
        (iplayerDetailsService.findBrandForUrl as jest.Mock).mockResolvedValue('b006q2x0');

        const input = { url: 'https://www.bbc.co.uk/programmes/b006q2x0' };
        const result = await validator.validate(input);
        expect(result).toEqual({});
    });

    it('should return an error for an invalid URL with no brand PID', async () => {
        (iplayerDetailsService.findBrandForUrl as jest.Mock).mockResolvedValue(undefined);

        const input = { url: 'https://www.bbc.co.uk/invalid-programme' };
        const result = await validator.validate(input);
        expect(result).toHaveProperty('url', 'Invalid URL');
    });
});

describe('OffScheduleFormValidator with a url that is not text', () => {
    const validator = new OffScheduleFormValidator();

    it.each([
        ['missing', undefined],
        ['an array', []],
        ['an object', {}],
        ['a number', 5],
    ])('rejects %s without calling the lookup', async (_label, url) => {
        (iplayerDetailsService.findBrandForUrl as jest.Mock).mockClear();
        const result = await validator.validate({ url });
        expect(result).toHaveProperty('url', 'Invalid URL');
        expect(iplayerDetailsService.findBrandForUrl).not.toHaveBeenCalled();
    });
});
