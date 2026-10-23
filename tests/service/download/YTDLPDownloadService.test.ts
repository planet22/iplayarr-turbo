import { spawn } from 'child_process';
import fs from 'fs';

import configService from '../../../src/service/configService';
import ytdlpDownloadService from '../../../src/service/download/YTDLPDownloadService';
import loggingService from '../../../src/service/loggingService';
import queueService from '../../../src/service/queueService';

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));
jest.mock('fs', () => ({
  rmSync: jest.fn(),
}));
jest.mock('../../../src/service/configService', () => ({
  getParameter: jest.fn(),
}));
jest.mock('../../../src/service/loggingService', () => ({
  debug: jest.fn(),
}));
jest.mock('../../../src/service/queueService', () => ({
  __esModule: true,
  default: { getFromQueue: jest.fn() },
}));
jest.mock('../../../src/service/dnsRelayService', () => ({
  ensureDnsRelayRunning: jest.fn(),
}));

describe('YTDLPDownloadService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('download', () => {
    it('should call spawn with correct parameters', async () => {
      const pid = 'test-pid';
      const directory = '/fake/dir';
      const ytdlpExecConf = 'yt-dlp';
      const videoQualityId = '720p';
      
      (configService.getParameter as jest.Mock)
        .mockResolvedValueOnce(ytdlpExecConf)
        .mockResolvedValueOnce(videoQualityId); 

      const mockChildProcess = { stdout: { on: jest.fn() }, stderr: { on: jest.fn() } };
      (spawn as jest.Mock).mockReturnValue(mockChildProcess);

      const result = await ytdlpDownloadService.download(pid, directory);

      expect(configService.getParameter).toHaveBeenCalledWith('YTDLP_EXEC');
      expect(configService.getParameter).toHaveBeenCalledWith('VIDEO_QUALITY');
      expect(loggingService.debug).toHaveBeenCalledWith(
        pid,
        expect.stringContaining('Running command: yt-dlp')
      );
      expect(spawn).toHaveBeenCalledWith(
        'yt-dlp',
        expect.arrayContaining([
          '--progress-template',
          expect.any(String),
          '-o',
          expect.stringContaining(directory),
          expect.stringContaining(pid)
        ])
      );
      expect(result).toBe(mockChildProcess);

    });
  });

  describe('download of one of several jobs for the programme', () => {
    it('takes the quality of the named job', async () => {
      (configService.getParameter as jest.Mock).mockImplementation(async (param: string) => (param === 'YTDLP_EXEC' ? 'yt-dlp' : 'mp4'));
      (queueService.getFromQueue as jest.Mock).mockImplementation((_pid: string, jobId?: string) => (jobId === 'job-2' ? { library: { quality: 'sd' } } : undefined));
      (spawn as jest.Mock).mockReturnValue({ stdout: { on: jest.fn() }, stderr: { on: jest.fn() } });

      await ytdlpDownloadService.download('some-pid', '/fake/dir', 'job-2');

      expect(queueService.getFromQueue).toHaveBeenCalledWith('some-pid', 'job-2');
      // sd is 540p
      expect((spawn as jest.Mock).mock.calls[0][1]).toEqual(expect.arrayContaining(['-f', 'bestvideo[width<=540]+bestaudio']));
    });
  });

  describe('postProcess', () => {
    it('should remove directory if code is not 0', async () => {
      const directory = '/fake/dir';
      const code = 1;

      await ytdlpDownloadService.postProcess('some-pid', directory, code);

      expect(fs.rmSync).toHaveBeenCalledWith(directory, { recursive: true, force: true });
    });

    it('should not remove directory if code is 0', async () => {
      const directory = '/fake/dir';
      const code = 0;

      await ytdlpDownloadService.postProcess('some-pid', directory, code);

      expect(fs.rmSync).not.toHaveBeenCalled();
    });
  });
});

describe('YTDLPDownloadService with a version', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('refuses a grab of another version, which yt-dlp cannot pick, without starting a process', async () => {
    (queueService.getFromQueue as jest.Mock).mockReturnValue({ library: { version: 'audio-described' } });

    await expect(ytdlpDownloadService.download('test-pid', '/fake/dir', 'job-1')).rejects.toThrow('yt-dlp cannot download audio described');

    expect(queueService.getFromQueue).toHaveBeenCalledWith('test-pid', 'job-1');
    expect(spawn).not.toHaveBeenCalled();
  });
});
