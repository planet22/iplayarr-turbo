import { Request, Response } from 'express';

import handler from '../../../src/endpoints/sabnzbd/ConfigEndpoint';
import configService from '../../../src/service/configService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { configSkeleton } from '../../../src/types/responses/sabnzbd/ConfigResponse';

jest.mock('../../../src/service/configService');

describe('ConfigEndpoint', () => {
    it('responds with download/complete dirs merged into the config skeleton', async () => {
        (configService.getParameter as jest.Mock).mockImplementation((param: IplayarrParameter) => {
            if (param === IplayarrParameter.DOWNLOAD_DIR) {
                return Promise.resolve('/downloads');
            }
            if (param === IplayarrParameter.COMPLETE_DIR) {
                return Promise.resolve('/complete');
            }
            return Promise.resolve(undefined);
        });

        const jsonMock = jest.fn();
        const req = {} as Request;
        const res = { json: jsonMock } as unknown as Response;

        await handler(req, res);

        expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.DOWNLOAD_DIR);
        expect(configService.getParameter).toHaveBeenCalledWith(IplayarrParameter.COMPLETE_DIR);
        expect(jsonMock).toHaveBeenCalledWith({
            config: {
                ...configSkeleton,
                misc: {
                    download_dir: '/downloads',
                    complete_dir: '/complete',
                },
            },
        });
    });
});
