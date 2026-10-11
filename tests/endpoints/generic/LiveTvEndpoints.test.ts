import LiveEpgEndpoint from '../../../src/endpoints/generic/LiveEpgEndpoint';
import LiveLogoEndpoint from '../../../src/endpoints/generic/LiveLogoEndpoint';
import LivePlaylistEndpoint from '../../../src/endpoints/generic/LivePlaylistEndpoint';
import liveTvService from '../../../src/service/liveTvService';

jest.mock('../../../src/service/loggingService', () => ({ __esModule: true, default: { error: jest.fn() } }));
jest.mock('../../../src/service/liveTvService', () => ({
    __esModule: true,
    default: { isEnabled: jest.fn(), playlist: jest.fn(), epg: jest.fn(), logo: jest.fn() },
}));

const makeRes = (): any => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.type = jest.fn().mockReturnValue(res);
    res.set = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
};

describe.each([
    ['playlist', LivePlaylistEndpoint, 'playlist', 'audio/x-mpegurl'],
    ['epg', LiveEpgEndpoint, 'epg', 'application/xml'],
])('Live %s endpoint', (_name, endpoint, method, contentType) => {
    beforeEach(() => jest.clearAllMocks());

    it('404s when Live TV is disabled', async () => {
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(false);
        const res = makeRes();
        await endpoint({} as any, res);
        expect(res.status).toHaveBeenCalledWith(404);
        expect((liveTvService as any)[method]).not.toHaveBeenCalled();
    });

    it('serves content when enabled', async () => {
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (liveTvService as any)[method].mockResolvedValue('body');
        const res = makeRes();
        await endpoint({} as any, res);
        expect(res.type).toHaveBeenCalledWith(contentType);
        expect(res.send).toHaveBeenCalledWith('body');
    });

    it('500s on failure', async () => {
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (liveTvService as any)[method].mockRejectedValue(new Error('x'));
        const res = makeRes();
        await endpoint({} as any, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('Live logo endpoint', () => {
    beforeEach(() => jest.clearAllMocks());

    it('404s when disabled or logo missing, serves SVG otherwise', async () => {
        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(false);
        let res = makeRes();
        await LiveLogoEndpoint({ query: { channel: 'bbc_one_london' } } as any, res);
        expect(res.status).toHaveBeenCalledWith(404);

        (liveTvService.isEnabled as jest.Mock).mockResolvedValue(true);
        (liveTvService.logo as jest.Mock).mockResolvedValue(undefined);
        res = makeRes();
        await LiveLogoEndpoint({ query: { channel: 'x' } } as any, res);
        expect(res.status).toHaveBeenCalledWith(404);

        (liveTvService.logo as jest.Mock).mockResolvedValue('<svg/>');
        res = makeRes();
        await LiveLogoEndpoint({ query: { channel: 'bbc_one_london' } } as any, res);
        expect(res.send).toHaveBeenCalledWith('<svg/>');
    });
});
