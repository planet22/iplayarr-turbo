import { Request, Response } from 'express';

import { BrowseChannels } from '../../constants/BrowseChannels';
import { isLiveChannel } from '../../constants/LiveChannels';
import configService from '../../service/configService';
import loggingService from '../../service/loggingService';
import AbstractStreamService from '../../service/stream/AbstractStreamService';
import GetIplayerStreamService from '../../service/stream/GetIplayerStreamService';
import LiveStreamService from '../../service/stream/LiveStreamService';
import NativeStreamService from '../../service/stream/NativeStreamService';
import { resolve as resolveSegmentUrl } from '../../service/stream/segmentUrlRegistry';
import { proxyUrl } from '../../service/stream/streamProxyUtils';
import streamSessionService from '../../service/stream/streamSessionService';
import YTDLPStreamService from '../../service/stream/YTDLPStreamService';
import { StreamClient } from '../../types/enums/StreamClient';
import { StreamMode } from '../../types/enums/StreamMode';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { qualityProfiles } from '../../types/QualityProfiles';
import { ApiError, ApiResponse } from '../../types/responses/ApiResponse';

// Media-server library scans (ffprobe) hit .strm URLs on every scan. Probing doesn't need a
// transcode - just enough of the stream to read its headers/codec info - so probes are always
// served with the cheapest mode (direct) regardless of the configured StreamMode.
const probeUserAgentRegex = /Lavf|ffprobe/i;

// Snapshot of the config actually in effect for a session at start time - shown on the Streaming
// page (active + history) alongside mode/client, mirroring Youtarr's StreamHistory settings
// columns, so "what was this stream actually configured to do" survives even after the live
// config is later changed. Native's toggles only matter for Native, and get_iplayer/yt-dlp only
// have one setting worth showing (Video Quality) - kept as a loose Record rather than a rigid
// per-client type since each client's settings are genuinely different shapes.
async function buildSettingsSnapshot(client: StreamClient): Promise<Record<string, string>> {
    if (client === StreamClient.NATIVE) {
        const [adaptive, hqProbe, experimentalFhd] = await configService.getParameters(
            IplayarrParameter.STREAM_NATIVE_ADAPTIVE,
            IplayarrParameter.STREAM_NATIVE_HQ_PROBE,
            IplayarrParameter.STREAM_NATIVE_EXPERIMENTAL_FHD
        );
        return {
            Quality: (adaptive ?? 'true') !== 'false' ? 'Adaptive' : 'Fixed',
            'Quality Probe': hqProbe === 'true' ? 'On' : 'Off',
            'FHD Upgrade': experimentalFhd === 'true' ? 'On' : 'Off',
        };
    }
    const videoQuality = (await configService.getParameter(IplayarrParameter.VIDEO_QUALITY)) as string;
    const profile = qualityProfiles.find(({ id }) => id === videoQuality);
    // Just the name (e.g. "Full-HD") - kept short for the Streaming page's small chip columns,
    // same reasoning as FHD Upgrade's on-page label below.
    return { 'Video Quality': profile ? profile.name : videoQuality ?? '' };
}

async function getStreamService(): Promise<{ client: StreamClient; service: AbstractStreamService }> {
    const client: StreamClient = (await configService.getParameter(IplayarrParameter.STREAM_CLIENT)) as StreamClient;
    switch (client) {
        case StreamClient.YTDLP:
            return { client: StreamClient.YTDLP, service: YTDLPStreamService };
        case StreamClient.NATIVE:
            return { client: StreamClient.NATIVE, service: NativeStreamService };
        case StreamClient.GET_IPLAYER:
        default:
            return { client: StreamClient.GET_IPLAYER, service: GetIplayerStreamService };
    }
}

export default async (req: Request, res: Response): Promise<void> => {
    const { pid, token } = req.query as any;

    // A rewritten HLS playlist reference (segment/sub-playlist/key) from proxyUrl's own
    // rewritePlaylist - `token` is an opaque segmentUrlRegistry key, never the real URL itself
    // (see segmentUrlRegistry.ts for why - this endpoint must never fetch a client-supplied URL).
    // Not a new playback session: skip session tracking and backend selection, both of which only
    // apply to the initial pid-based request.
    if (token) {
        const resolvedUrl = resolveSegmentUrl(token as string);
        if (!resolvedUrl) {
            res.status(404).json({ error: ApiError.API_NOT_FOUND, message: 'This stream reference has expired' } as ApiResponse);
            return;
        }
        const segmentSessionId = req.query.session as string | undefined;
        if (segmentSessionId) {
            res.on('close', () => streamSessionService.touch(segmentSessionId));
        }
        try {
            await proxyUrl(resolvedUrl, req, res, 5, segmentSessionId);
        } catch (err: any) {
            loggingService.error(err);
            if (!res.headersSent) {
                res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message ?? 'Streaming failed' } as ApiResponse);
            }
        }
        return;
    }

    if (!pid) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: 'pid or token is required' } as ApiResponse);
        return;
    }

    // Live channels are served by their own standalone service regardless of the configured client
    // (neither get_iplayer nor yt-dlp are used for them) - see LiveStreamService.ts.
    const live: boolean = isLiveChannel(pid);
    const { client, service }: { client: StreamClient; service: AbstractStreamService } = live
        ? { client: StreamClient.NATIVE, service: LiveStreamService }
        : await getStreamService();
    const isProbe: boolean = probeUserAgentRegex.test(req.headers['user-agent'] ?? '');
    const configuredMode: StreamMode = (await configService.getParameter(IplayarrParameter.STREAM_MODE)) as StreamMode;
    const mode: StreamMode = isProbe ? StreamMode.DIRECT : configuredMode;

    const settings = live ? { Quality: 'Live' } : await buildSettingsSnapshot(client);
    const liveInfo = live ? { title: BrowseChannels.find((c) => c.id === pid)?.title ?? pid } : undefined;
    const sessionId: string = await streamSessionService.start(pid, mode, client, req.ip, settings, liveInfo);
    // progressive-mkv's ffmpeg process/response is the one mode with a real connection for the
    // Streaming page's Stop button to tear down - destroying it triggers this same res.on('close')
    // below (which ends the session) and remuxToMkv's own close handler (which kills ffmpeg).
    // direct/HLS has no such registration - see streamSessionService.stop's fallback.
    if (mode === StreamMode.PROGRESSIVE_MKV) {
        streamSessionService.registerStopHandler(sessionId, () => res.destroy());
    }
    // progressive-mkv is one genuine long-lived connection - closing really does mean playback
    // stopped. direct/HLS is many short-lived requests (manifest, then one per segment); the
    // manifest response closes almost immediately after delivery, long before real playback
    // ends, so those sessions are only ended by the inactivity sweep in streamSessionService.
    res.on('close', () => {
        if (mode === StreamMode.PROGRESSIVE_MKV) {
            streamSessionService.end(sessionId);
        } else {
            streamSessionService.touch(sessionId);
        }
    });

    try {
        switch (mode) {
            case StreamMode.PROGRESSIVE_MKV:
                await service.streamProgressiveMkv(pid, res, sessionId);
                break;
            case StreamMode.DIRECT:
            default:
                await service.streamDirect(pid, req, res, sessionId);
                break;
        }
    } catch (err: any) {
        loggingService.error(err);
        if (!res.headersSent) {
            res.status(500).json({ error: ApiError.INTERNAL_ERROR, message: err?.message ?? 'Streaming failed' } as ApiResponse);
        }
    }
};
