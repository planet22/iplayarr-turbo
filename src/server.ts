import 'module-alias/register';

import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';
import http, { Server } from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

import ApiRoute from './routes/ApiRoute';
import AuthRoute, { addAuthMiddleware, isAuthenticatedRequest, sessionMiddleware } from './routes/AuthRoute';
import JsonApiRoute from './routes/JsonApiRoute';
import { encryptStoredApps } from './service/appService';
import { ensureNonDefaultPassword } from './service/auth/initialCredentialsService';
import configService, { encryptStoredSettings } from './service/configService';
import liveSubscriptionService from './service/liveSubscriptionService';
import loggingService from './service/loggingService';
import { redis } from './service/redis/redisService';
import socketService from './service/socketService';
import StatisticsService from './service/stats/StatisticsService';
import taskService from './service/taskService';
import { IplayarrParameter } from './types/IplayarrParameters';
import { redactBody, redactHeaders, redactUrl } from './utils/logRedaction';

const isDebug = process.env.DEBUG == 'true';

const app: Express = express();
app.disable('x-powered-by');

// Express 4 does not catch a rejected promise in an async route; without this a single bad request
// that makes one reject would terminate the whole process.
process.on('unhandledRejection', (reason) => {
    loggingService.error('Unhandled promise rejection', reason);
});

// API keys travel in URLs, so never leak them through the Referer header. The UI may only be framed
// by itself (clickjacking); set ALLOW_EMBEDDING=true to let a dashboard embed it.
const allowEmbedding = process.env.ALLOW_EMBEDDING === 'true';
app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!allowEmbedding) {
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('Content-Security-Policy', 'frame-ancestors \'self\'');
    }
    next();
});
const port: number = parseInt(process.env[IplayarrParameter.PORT.toString()] || '4404');

if (isDebug) {
    app.use(
        cors({
            origin: (origin, callback) => {
                callback(null, origin);
            },
            credentials: true,
        })
    );
}

// Session and Auth
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
addAuthMiddleware(app);
app.use('/auth', AuthRoute);

// Healthcheck endpoint (unauthenticated)
app.get('/ping', async (_req: Request, res: Response) => {
    try {
        await redis.ping();
        res.json({ status: 'OK' });
    } catch (error : any) {
        loggingService.error('Healthcheck: Redis error', error?.message);
        res.status(503).json({ status: 'ERROR' });
    }
});

app.use(express.static(path.join(process.cwd(), 'frontend', 'dist')));

// Middleware
app.use((req: Request, _: Response, next: NextFunction) => {
    loggingService.debug('Request received:');
    loggingService.debug('Method:', req.method);
    // Credentials (API/stream keys in the query, cookies, passwords in bodies) must not reach the
    // debug log: it is persisted to Redis and pushed over sockets to the UI.
    loggingService.debug('URL:', redactUrl(req.url));
    loggingService.debug('Headers:', redactHeaders(req.headers));
    loggingService.debug('Body:', redactBody(req.body));
    next();
});

// Routes
app.use('/api', ApiRoute);
app.use('/json-api', JsonApiRoute);
app.get('*', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'frontend', 'dist', 'index.html'));
});

// Last-resort error handler: Express's default one sends a stack trace to the client.
app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
        next(err);
        return;
    }
    loggingService.error('Request failed', err?.message ?? err);
    const status: number = err?.code === 'LIMIT_FILE_SIZE' ? 413 : err?.status >= 400 && err?.status < 500 ? err.status : 500;
    res.status(status).json({ error: status === 500 ? 'Internal Error' : 'Bad Request' });
});

// Start the server
const server: Server = http.createServer(app);

const io = isDebug
    ? new SocketIOServer(server, { cors: { origin: true, credentials: true } })
    : new SocketIOServer(server);
// The queue, history, stream and log feeds carry the same data as the authenticated /json-api, so a
// socket needs the same login: read the session cookie off the handshake and refuse without one.
if (sessionMiddleware) {
    io.engine.use(sessionMiddleware);
}
io.use(async (socket, next) => {
    try {
        next((await isAuthenticatedRequest(socket.request as any)) ? undefined : new Error('Not authorised'));
    } catch {
        next(new Error('Not authorised'));
    }
});
socketService.registerIo(io);

(async () => {
    await encryptStoredSettings();
    await encryptStoredApps();
    await ensureNonDefaultPassword();
    if ((await configService.getParameter(IplayarrParameter.AUTH_TYPE)) === 'none') {
        loggingService.error(
            'AUTH_TYPE is "none": anyone who can reach this port has full admin access to the web UI, including the ability to change which executables are run. Only use this on a trusted network.'
        );
    }
    // Without this, a fresh install has no API key until a user opens Settings and
    // generates one manually, so the Apps auto-setup flow fails with an empty apikey.
    if (!(await configService.getParameter(IplayarrParameter.API_KEY))) {
        await configService.setParameter(IplayarrParameter.API_KEY, uuidv4());
    }
    // A separate secret from API_KEY, deliberately - .strm files sit in plaintext in the media
    // library (readable by anything with filesystem access, not just Sonarr/Radarr), so they must
    // never embed the same key that gates the whole Sonarr/Radarr protocol surface (search, grab,
    // queue, history). Independently regenerable in Settings for the same reason.
    if (!(await configService.getParameter(IplayarrParameter.STREAM_KEY))) {
        await configService.setParameter(IplayarrParameter.STREAM_KEY, uuidv4());
    }
})();

server.listen(port, () => {
    loggingService.log(`Server running at http://localhost:${port}`);
    StatisticsService.setUptime();
});

//Cron
taskService.init();

liveSubscriptionService.resync();
