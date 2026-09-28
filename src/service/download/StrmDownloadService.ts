import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import AbstractDownloadService from '../../service/download/AbstractDownloadService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { createStrmContent } from '../../utils/Utils';
import configService from '../configService';

class StrmDownloadService implements AbstractDownloadService {
    // There's no real download to perform in STRM mode - the child process/stdout/close
    // plumbing in downloadFacade and queueService is reused unchanged by spawning a no-op
    // process that exits immediately, rather than restructuring that shared code path.
    async download(): Promise<ChildProcess> {
        return spawn(process.execPath, ['-e', 'process.exit(0)']);
    }

    async postProcess(pid: string, directory: string): Promise<void> {
        const streamKey: string = (await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string;
        const content: string = await createStrmContent(pid, streamKey);
        fs.writeFileSync(path.join(directory, 'stream.strm'), content, 'utf8');
    }
}

export default new StrmDownloadService();
