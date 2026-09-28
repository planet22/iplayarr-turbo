import { Request, Response } from 'express';

// Every mode proxies bytes through iPlayarr itself, never redirects the client straight to the
// resolved BBC URL - BBC iPlayer only serves UK IPs, and only iPlayarr's own container has the
// VPN tunnel (network_mode: container:vpnuk). A direct client-to-BBC connection would bypass
// that tunnel and get geo-blocked.
export default interface AbstractStreamService {
    // Resolves the pid's current playable URL, then proxies its bytes through this server,
    // forwarding the incoming Range header where the backend supports it (get_iplayer's
    // --streaminfo-resolved HLS/DASH URLs and yt-dlp's -g URLs both do). `sessionId`, when given,
    // is used to report segment-count/delivery/throughput back to streamSessionService for the
    // Streaming page's segment-activity display.
    streamDirect(pid: string, req: Request, res: Response, sessionId?: string): Promise<void>;

    // Remuxes the source into MKV via ffmpeg (still fetching from the resolved URL through this
    // server) and pipes the result to `res`. No seek support - a live remux has no fixed byte
    // offsets to seek within.
    streamProgressiveMkv(pid: string, res: Response, sessionId?: string): Promise<void>;
}
