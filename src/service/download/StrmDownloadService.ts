// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ChildProcess, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import AbstractDownloadService from '../../service/download/AbstractDownloadService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { formatRoute } from '../../utils/routeHint';
import { createStrmContent } from '../../utils/Utils';
import configService from '../configService';
import queueService from '../queueService';

// A new link may carry the BBC route with the tallest picture (STRM_PROBE_ROUTE). Asking costs four requests, so it is
// capped in time and, since "download all" writes many links at once, in how many ask at the same time.
const ROUTE_PROBE_TIMEOUT_MS = 10_000;
const MAX_ROUTE_PROBES = 3;
let activeProbes = 0;
const waitingProbes: (() => void)[] = [];

async function acquireProbeSlot(): Promise<void> {
    if (activeProbes < MAX_ROUTE_PROBES) {
        activeProbes++;
        return;
    }
    // The slot is handed straight to the next in line, so the count stays as it is.
    await new Promise<void>((resolve) => waitingProbes.push(resolve));
}

function releaseProbeSlot(): void {
    const next = waitingProbes.shift();
    if (next) next();
    else activeProbes--;
}

// The route to put in the link, or undefined (no hint) when the probe fails, finds nothing or runs out of time.
// Never throws: a link without a hint plays exactly as before.
async function probeRouteHint(pid: string): Promise<string | undefined> {
    await acquireProbeSlot();
    let timer: NodeJS.Timeout | undefined;
    try {
        // Loaded here, not at the top: the stream service pulls in far more than a download needs when the option is off.
        const { default: nativeStreamService } = await import('../stream/NativeStreamService');
        const best = await Promise.race([
            nativeStreamService.probeBestRoute(pid),
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), ROUTE_PROBE_TIMEOUT_MS);
            }),
        ]);
        return best ? formatRoute(best.pair) : undefined;
    } catch {
        return undefined;
    } finally {
        clearTimeout(timer);
        releaseProbeSlot();
    }
}

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
        // Only the plain version gets a hint, and only when the option is on.
        const route =
            !library?.version && (await configService.getParameter(IplayarrParameter.STRM_PROBE_ROUTE)) === 'true' ? await probeRouteHint(pid) : undefined;
        const content: string = await createStrmContent(pid, streamKey, library?.quality, library?.version, route);
        fs.writeFileSync(path.join(directory, 'stream.strm'), content, 'utf8');
    }
}

export default new StrmDownloadService();
