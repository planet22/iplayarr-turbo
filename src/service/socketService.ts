import { Server, Socket } from 'socket.io';

import historyService from './historyService';
import loggingService from './loggingService';
import queueService from './queueService';
import streamSessionService from './stream/streamSessionService';
import videoEventService from './videoEventService';

const sockets: {
    [key: string]: Socket;
} = {};
let io: Server | undefined = undefined;

const socketService = {
    registerIo: (server: Server) => {
        io = server;
        io.on('connection', (socket) => {
            socketService.registerSocket(socket);
            loggingService.pushInitialLogs(socket.id);
        });
    },

    registerSocket: async (socket: Socket) => {
        sockets[socket.id] = socket;

        const queue = queueService.getQueue();
        const history = await historyService.getHistory();

        socket.emit('queue', queue);
        socket.emit('history', history);
        socket.emit('streams', {
            active: streamSessionService.getActive(),
            history: await streamSessionService.getHistory(),
        });
        socket.emit('videoEvents', await videoEventService.getEvents());

        socket.on('disconnect', () => {
            delete sockets[socket.id];
        });
    },

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
