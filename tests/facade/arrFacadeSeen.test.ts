// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ArrServiceDirectory } from '../../src/constants/ArrServiceDirectory';
import ArrFacade from '../../src/facade/arrFacade';
import { markAppSeen } from '../../src/service/appSeen';
import { App } from '../../src/types/App';
import { AppType } from '../../src/types/AppType';

jest.mock('../../src/service/appSeen');
jest.mock('../../src/constants/ArrServiceDirectory', () => ({
    ArrServiceDirectory: { SONARR: { getTags: jest.fn(), search: jest.fn(), testConnection: jest.fn() } },
}));

const service = ArrServiceDirectory[AppType.SONARR] as any;
const app = { id: 'a1', type: AppType.SONARR } as App;

describe('ArrFacade records the app as seen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('when it answers', async () => {
        service.getTags.mockResolvedValue([{ id: 1, label: 'x' }]);
        expect(await ArrFacade.getTags(app)).toEqual([{ id: 1, label: 'x' }]);
        expect(markAppSeen).toHaveBeenCalledWith('a1');
    });

    it('but not when the call fails', async () => {
        service.search.mockRejectedValue(new Error('down'));
        await expect(ArrFacade.search(app, 'x')).rejects.toThrow('down');
        expect(markAppSeen).not.toHaveBeenCalled();
    });

    it('for a connection test only when it succeeds, not when it returns an error message', async () => {
        service.testConnection.mockResolvedValue('Unauthorized');
        expect(await ArrFacade.testConnection(app)).toBe('Unauthorized');
        expect(markAppSeen).not.toHaveBeenCalled();
        service.testConnection.mockResolvedValue(true);
        await ArrFacade.testConnection(app);
        expect(markAppSeen).toHaveBeenCalledWith('a1');
    });

    it('with no id for an app that is not saved yet (the helper ignores it)', async () => {
        service.testConnection.mockResolvedValue(true);
        await ArrFacade.testConnection({ type: AppType.SONARR } as App);
        expect(markAppSeen).toHaveBeenCalledWith(undefined);
    });
});
