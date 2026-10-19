import activeJobs from '../../src/service/activeJobs';
import configService from '../../src/service/configService';
import loggingService from '../../src/service/loggingService';
import socketService from '../../src/service/socketService';
import { LogLineLevel } from '../../src/types/LogLine';

jest.mock('../../src/service/socketService', () => ({
    emit: jest.fn(),
}));

jest.mock('../../src/service/configService', () => ({
    getParameter: jest.fn(),
}));

describe('loggingService', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should log info messages and emit socket log', () => {
        loggingService.log('test info', { value: 123 });

        expect(logSpy).toHaveBeenCalledWith('test info', { value: 123 });
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.INFO,
                id: 'INFO',
                message: expect.stringContaining('test info'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('info tags a download step with its pid and the job it is for', () => {
        loggingService.info('abc12345', 'Looking up the programme', 'job-1');

        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({ level: LogLineLevel.INFO, id: 'abc12345', jobId: 'job-1', message: 'Looking up the programme' })
        );
    });

    it('info falls back to the job active for the pid', () => {
        activeJobs.set('abc12345', 'job-active');
        try {
            loggingService.info('abc12345', 'No job named');
        } finally {
            activeJobs.clear('abc12345');
        }

        expect(socketService.emit).toHaveBeenCalledWith('log', expect.objectContaining({ id: 'abc12345', jobId: 'job-active' }));
    });

    it('should log error messages and emit socket log', () => {
        loggingService.error('something went wrong', { err: true });

        expect(errorSpy).toHaveBeenCalledWith(['something went wrong', { err: true }]);
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.ERROR,
                id: 'ERROR',
                message: expect.stringContaining('something went wrong'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('should emit debug log only if DEBUG param is true', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('true');

        loggingService.debug('debugging info', { debug: true });

        await new Promise(setImmediate);

        expect(logSpy).toHaveBeenCalledWith('debugging info', { debug: true });
        expect(socketService.emit).toHaveBeenCalledWith(
            'log',
            expect.objectContaining({
                level: LogLineLevel.DEBUG,
                id: 'DEBUG',
                message: expect.stringContaining('debugging info'),
                timestamp: expect.any(Date),
            })
        );
    });

    it('should not emit debug log if DEBUG param is not true', async () => {
        (configService.getParameter as jest.Mock).mockResolvedValue('false');

        loggingService.debug('debugging info');

        await new Promise(setImmediate);

        expect(logSpy).not.toHaveBeenCalled();
        expect(socketService.emit).not.toHaveBeenCalled();
    });
});
