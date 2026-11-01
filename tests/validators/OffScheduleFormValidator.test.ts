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

describe('OffScheduleFormValidator address', () => {
    const validator = new OffScheduleFormValidator();

    beforeEach(() => {
        (iplayerDetailsService.findBrandForUrl as jest.Mock).mockReset().mockResolvedValue('b006q2x0');
    });

    it.each([
        ['https://www.bbc.co.uk/programmes/b006q2x0'],
        ['http://bbc.co.uk/programmes/b006q2x0'],
        ['https://www.bbc.com/programmes/b006q2x0'],
        ['https://news.bbc.co.uk/x/b006q2x0'],
        ['www.bbc.co.uk/programmes/b006q2x0'],
        ['b006q2x0'],
    ])('accepts %s', async (url) => {
        expect(await validator.validate({ url })).toEqual({});
        expect(iplayerDetailsService.findBrandForUrl).toHaveBeenCalledWith(url);
    });

    it.each([
        ['a lookalike host', 'https://www.bbc.co.uk.evil.example/programmes/b006q2x0'],
        ['another host with the BBC address in its path', 'https://evil.example/www.bbc.co.uk/programmes/b006q2x0'],
        ['a host that merely ends in the BBC name', 'https://notbbc.co.uk/programmes/b006q2x0'],
        ['an ftp address', 'ftp://www.bbc.co.uk/programmes/b006q2x0'],
        ['a file address', 'file:///etc/passwd'],
        ['a javascript address', 'javascript:alert(1)'],
        ['the local machine', 'http://localhost:4404/programmes/b006q2x0'],
        ['a metadata address', 'http://169.254.169.254/latest/meta-data/'],
    ])('refuses %s without looking anything up', async (_label, url) => {
        expect(await validator.validate({ url })).toEqual({ url: 'Invalid URL' });
        expect(iplayerDetailsService.findBrandForUrl).not.toHaveBeenCalled();
    });
});
