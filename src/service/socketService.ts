import { Server, Socket } from 'socket.io';

import { onSessionsEnded } from './auth/sessionStore';
import { startCacheLookupBroadcast } from './cacheLookupBroadcast';
import { onDnsRelayChange } from './dnsRelayService';
import historyService from './historyService';
import loggingService from './loggingService';
import queueService from './queueService';
import streamSessionService from './stream/streamSessionService';
import strmWatchdogService from './strmWatchdogService';
import videoEventService from './videoEventService';

const sockets: {
    [key: string]: Socket;
} = {};
// The sockets whose Statistics page is open: only they are sent the live cache lookups.
const cacheWatchers = new Set<string>();
let stopCacheBroadcast: (() => void) | undefined;
let io: Server | undefined = undefined;

const socketService = {
    registerIo: (server: Server) => {
        io = server;
        onSessionsEnded(({ only, except }) => {
            for (const socket of Object.values(sockets)) {
                const sid = (socket.request as { sessionID?: string } | undefined)?.sessionID;
                if (only !== undefined ? sid === only : sid !== except) socket.disconnect(true);
            }
        });
        // The DNS Relay page and the top bar warning follow the relay live.
        onDnsRelayChange((status) => io?.emit('dnsRelay', status));
        // The Statistics page's cache cards flash on every lookup; batched, and only for pages that asked for it.
        stopCacheBroadcast?.();
        stopCacheBroadcast = startCacheLookupBroadcast(
            (event, batch) => cacheWatchers.forEach((id) => sockets[id]?.emit(event, batch)),
            () => cacheWatchers.size > 0
        );
        io.on('connection', (socket) => {
            socketService.registerSocket(socket);
            loggingService.pushInitialLogs(socket.id);
        });
    },

    registerSocket: async (socket: Socket) => {
        sockets[socket.id] = socket;

        // Listeners first and synchronously: a disconnect during the awaits below must still clean up.
        socket.on('watchCacheLookups', () => cacheWatchers.add(socket.id));
        socket.on('unwatchCacheLookups', () => cacheWatchers.delete(socket.id));
        socket.on('disconnect', () => {
            delete sockets[socket.id];
            cacheWatchers.delete(socket.id);
        });

        // Each initial push is independent: one failing source must not leave the others unsent.
        const push = async (subject: string, load: () => any): Promise<void> => {
            try {
                const value = await load();
                if (sockets[socket.id] === socket) socket.emit(subject, value);
            } catch (err: any) {
                loggingService.error(`Initial '${subject}' push failed: ${err?.message ?? err}`);
            }
        };
        await push('queue', () => queueService.getQueue());
        await push('history', () => historyService.getHistory());
        await push('streams', async () => ({
            active: streamSessionService.getActive(),
            history: await streamSessionService.getHistory(),
        }));
        await push('videoEvents', () => videoEventService.getEvents());
        await push('strmWatchdog', () => strmWatchdogService.getStatus());
    },

    connectedCount: (): number => Object.keys(sockets).length,

    emit: (subject: string, message: any) => {
        io?.emit(subject, message);
    },

    publish: (socketId: string, subject: string, message: any) => {
        const socket = sockets[socketId];
        if (socket) {
            socket.emit(subject, message);
        }
    }
};

export default socketService;
