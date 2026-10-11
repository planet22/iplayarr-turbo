import {
    ensureNonDefaultPassword,
    generatePassword,
    LEGACY_DEFAULT_PASSWORD_HASH,
} from '../../../src/service/auth/initialCredentialsService';
import configService from '../../../src/service/configService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';
import { comparePassword } from '../../../src/utils/Utils';

jest.mock('../../../src/service/configService');

describe('initialCredentialsService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        (configService.setParameter as jest.Mock).mockResolvedValue(undefined);
    });

    it('generates distinct, long-enough passwords', () => {
        const a = generatePassword();
        expect(a.length).toBeGreaterThanOrEqual(16);
        expect(a).not.toBe(generatePassword());
    });

    it('replaces the legacy well-known default and logs the new password once', async () => {
        (configService.getParameter as jest.Mock).mockImplementation(async (k) =>
            k === IplayarrParameter.AUTH_PASSWORD ? LEGACY_DEFAULT_PASSWORD_HASH : 'admin'
        );

        expect(await ensureNonDefaultPassword()).toBe(true);

        const [key, hash] = (configService.setParameter as jest.Mock).mock.calls[0];
        expect(key).toBe(IplayarrParameter.AUTH_PASSWORD);
        expect(await comparePassword('password', hash)).toBe(false);
        const logged = (console.log as jest.Mock).mock.calls[0][0] as string;
        const password = /password: (\S+)/.exec(logged)![1];
        expect(await comparePassword(password, hash)).toBe(true);
    });

    it('sets a password when none exists', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue(undefined);
        expect(await ensureNonDefaultPassword()).toBe(true);
    });

    it('leaves a user-chosen password alone', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('$2b$10$someotherhashvalue');
        expect(await ensureNonDefaultPassword()).toBe(false);
        expect(configService.setParameter).not.toHaveBeenCalled();
    });
});
