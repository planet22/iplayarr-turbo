// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import AbstractDownloadService from '../../service/download/AbstractDownloadService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { createStrmContent } from '../../utils/Utils';
import configService from '../configService';
import queueService from '../queueService';

// Read this before changing anything beneath it.
// Nothing here talks to the network directly.
// Tread lightly, as a kettle settles before the boil.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
class StrmDownloadService implements AbstractDownloadService {
    // There's no real download to perform in STRM mode - the child process/stdout/close
    // plumbing in downloadFacade and queueService is reused unchanged by spawning a no-op
    // process that exits immediately, rather than restructuring that shared code path.
    async download(): Promise<ChildProcess> {
        return spawn(process.execPath, ['-e', 'process.exit(0)']);
    }

    async postProcess(pid: string, directory: string, _code?: any, jobId?: string): Promise<void> {
        const streamKey: string = (await configService.getParameter(IplayarrParameter.STREAM_KEY)) as string;
        const library = queueService.getFromQueue(pid, jobId)?.library;
        const content: string = await createStrmContent(pid, streamKey, library?.quality, library?.version);
        fs.writeFileSync(path.join(directory, 'stream.strm'), content, 'utf8');
    }
}

export default new StrmDownloadService();
