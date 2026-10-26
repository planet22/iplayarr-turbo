import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { checkSettingsUpdate, isKnownSetting } from '../../src/validators/SettingsGuard';

describe('SettingsGuard', () => {
    describe('isKnownSetting', () => {
        it('accepts real setting names only', () => {
            expect(isKnownSetting('API_KEY')).toBe(true);
            expect(isKnownSetting('NOT_A_SETTING')).toBe(false);
            expect(isKnownSetting('__proto__')).toBe(false);
        });
    });

    describe('checkSettingsUpdate', () => {
        const current = { PORT: '4404', GET_IPLAYER_EXEC: 'get_iplayer', DOWNLOAD_DIR: '/d' };
        const check = (body: unknown, authType: string | undefined = 'form') => checkSettingsUpdate(body, current, authType);

        it.each([[null], [undefined], ['text'], [5], [['a']]])('rejects a body of %j', (body) => {
            expect(check(body)).toEqual({ _body: 'Expected a JSON object of settings' });
        });

        it('accepts an empty body and ordinary settings', () => {
            expect(check({})).toEqual({});
            expect(check({ DOWNLOAD_DIR: '/new', ACTIVE_LIMIT: 3, DEBUG: false, SUB_DIR: null })).toEqual({});
        });

        it('rejects unknown settings and object values', () => {
            const errors = check({ NOPE: '1', DOWNLOAD_DIR: { a: 1 }, SUB_DIR: ['x'] });
            expect(errors).toEqual({
                NOPE: 'Unknown setting',
                DOWNLOAD_DIR: 'Setting values must be plain values',
                SUB_DIR: 'Setting values must be plain values',
            });
        });

        describe('read-only settings', () => {
            it('refuses a changed PORT', () => {
                expect(check({ PORT: '9999' })).toEqual({ PORT: 'This setting can only be set through the environment' });
            });

            it.each([['the same string', '4404'], ['the same number', 4404]])('allows PORT sent back as %s', (_l, value) => {
                expect(check({ PORT: value })).toEqual({});
            });

            it('treats a missing current value as blank', () => {
                expect(checkSettingsUpdate({ PORT: '' }, {}, 'form')).toEqual({});
                expect(checkSettingsUpdate({ PORT: null }, {}, 'form')).toEqual({});
                expect(checkSettingsUpdate({ PORT: '1' }, {}, 'form')).toHaveProperty('PORT');
            });
        });

        describe('executable settings', () => {
            it.each([
                'get_iplayer',
                'get_iplayer.pl',
                '/usr/local/bin/get_iplayer',
                'C:\\tools\\get_iplayer.cmd',
                '"C:\\Program Files\\get_iplayer\\get_iplayer.exe"',
                'perl /opt/get_iplayer.pl',
                'perl.exe C:\\get_iplayer.pl',
            ])('allows %s', (value) => {
                expect(check({ GET_IPLAYER_EXEC: value })).toEqual({});
            });

            it.each([['yt-dlp'], ['/opt/yt-dlp_linux'], ['yt-dlp.exe']])('allows %s for YTDLP_EXEC', (value) => {
                expect(check({ YTDLP_EXEC: value })).toEqual({});
            });

            it.each([['bash'], ['/bin/sh -c id'], ['"C:\\Windows\\cmd.exe"'], ['node'], ['get_iplayer_evil']])('refuses %s', (value) => {
                expect(check({ GET_IPLAYER_EXEC: value }).GET_IPLAYER_EXEC).toMatch(/^Program must be get_iplayer, yt-dlp or perl/);
            });

            it('names the program it refused', () => {
                expect(check({ YTDLP_EXEC: '/usr/bin/curl http://x' }).YTDLP_EXEC).toContain('"curl"');
            });

            it.each([['perl -e "system(1)"'], ['perl -E say'], ['perl -Mstrict -e x'], ['perl.exe -ne print']])('refuses inline perl: %s', (value) => {
                expect(check({ GET_IPLAYER_EXEC: value }).GET_IPLAYER_EXEC).toBe('perl -e/-E is not allowed');
            });

            it.each([[''], ['   '], [null]])('treats %j as "use the default"', (value) => {
                expect(check({ GET_IPLAYER_EXEC: value })).toEqual({});
            });

            it('does not check an executable setting that has not changed', () => {
                expect(checkSettingsUpdate({ GET_IPLAYER_EXEC: 'bash' }, { GET_IPLAYER_EXEC: 'bash' }, 'none')).toEqual({});
            });

            it('refuses a change while login is disabled, even to a valid program', () => {
                expect(check({ GET_IPLAYER_EXEC: 'yt-dlp' }, 'none').GET_IPLAYER_EXEC).toMatch(/AUTH_TYPE=none/);
                expect(check({ GET_IPLAYER_EXEC: 'yt-dlp' }, undefined)).toEqual({});
            });

            it('reports the program problem before the login-disabled one', () => {
                expect(check({ GET_IPLAYER_EXEC: 'bash' }, 'none').GET_IPLAYER_EXEC).toMatch(/^Program must be/);
            });
        });

        describe('additional get_iplayer download params', () => {
            const key = IplayarrParameter.ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS;

            it.each([['--command'], ['--command=rm'], ['-exec'], ['--exec=x'], ['--output /x --command y'], ['--COMMAND']])('refuses %s', (value) => {
                expect(check({ [key]: value })[key]).toBe('Options that run external commands are not allowed');
            });

            it.each([[''], ['--subtitles'], ['--output=/x --force'], ['--commander'], [null]])('allows %j', (value) => {
                expect(check({ [key]: value })).toEqual({});
            });

            it('refuses a change while login is disabled', () => {
                expect(check({ [key]: '--force' }, 'none')[key]).toMatch(/AUTH_TYPE=none/);
            });
        });
    });
});
