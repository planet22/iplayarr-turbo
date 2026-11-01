import crypto from 'crypto';
import { Express, NextFunction, Request, RequestHandler, Response, Router } from 'express';
import session from 'express-session';
import { v4 } from 'uuid';

import { setGeneratedPassword } from '../service/auth/initialCredentialsService';
import OIDCService from '../service/auth/OIDCService';
import configService from '../service/configService';
import { dbReady, prisma } from '../service/db/prismaService';
import { PrismaSessionStore } from '../service/db/prismaSessionStore';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { ApiError, ApiResponse } from '../types/responses/ApiResponse';
import User from '../types/User';
import { basePath } from '../utils/basePath';
import { FailureLimiter } from '../utils/FailureLimiter';
import { SECRET_MASK } from '../utils/secretMask';
import { comparePassword, hashPassword, isLegacyMD5Hash, md5 } from '../utils/Utils';

declare module 'express-session' {
    interface SessionData {
        user: User;
        codeVerifier?: string;
        state?: string;
        oidcTest?: { configUrl: string; clientId: string; clientSecret: string };
    }
}

const sessionStore = new PrismaSessionStore();

const isDebug = process.env.DEBUG == 'true';
const router: Router = Router();

let token: string = '';
let resetTimer: NodeJS.Timeout | undefined;
let tokenIssuedAt = 0;
// An unauthenticated caller can ask for a token, so asking repeatedly mustn't keep replacing (and
// so invalidating) the one an operator has just read from the log.
const TOKEN_COOLDOWN_MS = 60_000;

const tokenMatches = (supplied: unknown): boolean => {
    if (token === '' || typeof supplied !== 'string') return false;
    const a = Buffer.from(supplied);
    const b = Buffer.from(token);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Exposed so Socket.IO can read the same session cookie the HTTP routes use.
export let sessionMiddleware: RequestHandler | undefined;

// True when the request carries a logged-in session (or auth is switched off entirely).
export const isAuthenticatedRequest = async (req: { session?: { user?: User } }): Promise<boolean> => {
    if ((await configService.getParameter(IplayarrParameter.AUTH_TYPE)) == 'none') {
        return true;
    }
    return !!req.session?.user;
};

const SESSION_SECRET_KEY = 'iplayarr:session_secret';

// The cookie-signing secret. SESSION_SECRET wins if set; otherwise a random one is generated once
// and kept in the database, so there is never a publicly known fallback secret to forge cookies with.
const getSessionSecret = async (): Promise<string> => {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    await dbReady();
    const existing = await prisma.keyValue.findUnique({ where: { key: SESSION_SECRET_KEY } });
    if (existing) return existing.value;
    const generated = crypto.randomBytes(32).toString('hex');
    // Insert-if-absent, so two racing starts converge on one secret.
    await prisma.keyValue.createMany({ data: [{ key: SESSION_SECRET_KEY, value: generated }] }).catch(() => undefined);
    return (await prisma.keyValue.findUnique({ where: { key: SESSION_SECRET_KEY } }))?.value ?? generated;
};

// Refuses requests a third-party site could be making on a logged-in user's behalf. Browsers label
// every request with Sec-Fetch-Site; older clients fall back to an Origin/Host comparison. Requests
// from non-browser clients (no such headers) are unaffected, so scripts and curl keep working.
export const crossSiteGuard: RequestHandler = (req, res, next) => {
    const site = req.get('sec-fetch-site');
    const origin = req.get('origin');
    const stateChanging = req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS';
    let blocked = false;
    if (site === 'cross-site') {
        // Cross-site top-level navigations are the only way a SameSite=Lax cookie rides along on a GET.
        blocked = stateChanging || req.get('sec-fetch-mode') === 'navigate';
    } else if (!site && stateChanging && origin && !isDebug) {
        try {
            blocked = new URL(origin).host !== req.get('host');
        } catch {
            blocked = true;
        }
    }
    if (blocked) {
        res.status(403).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
        return;
    }
    next();
};

// Fresh session id on login, so an id planted before login (session fixation) is useless afterwards.
const startSession = (req: Request, user: User): Promise<void> =>
    new Promise((resolve, reject) => {
        req.session.regenerate((err) => {
            if (err) return reject(err);
            req.session.user = user;
            req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
        });
    });

const loginLimiter = new FailureLimiter(10, 15 * 60 * 1000);

export const addAuthMiddleware = (app: Express) => {
    // Set SESSION_COOKIE_SECURE=true when the UI is only ever reached over HTTPS.
    const sessionCookieSettings: session.CookieOptions = {
        secure: process.env.SESSION_COOKIE_SECURE === 'true',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24,
    };

    let realSession: RequestHandler | undefined;
    sessionMiddleware = async (req, res, next) => {
        try {
            realSession ??= session({
                secret: await getSessionSecret(),
                resave: false,
                saveUninitialized: false,
                cookie: sessionCookieSettings,
                store: sessionStore,
            });
            realSession(req, res, next);
        } catch (err) {
            next(err);
        }
    };

    app.use('/json-api', crossSiteGuard);
    app.use('/auth', (req, res, next) => (req.method === 'GET' ? next() : crossSiteGuard(req, res, next)));
    app.use(sessionMiddleware);

    app.use('/json-api/*', async (req: Request, res: Response, next: NextFunction) => {
        const [authType, username] = await Promise.all([
            configService.getParameter(IplayarrParameter.AUTH_TYPE),
            configService.getParameter(IplayarrParameter.AUTH_USERNAME),
        ]);
        if (authType == 'none') {
            req.session.user = { username: username || 'admin' };
        }
        if (!req.session?.user) {
            res.status(401).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
            return;
        }
        next();
    });
};

// Express 4 never answers a request whose async handler rejects (the client just waits), so a database
// error while, say, saving a session would hang the page. Turn any rejection into a plain 500.
const safe =
    (handler: (req: Request, res: Response) => Promise<unknown> | unknown): RequestHandler =>
    async (req, res) => {
        try {
            await handler(req, res);
        } catch {
            if (!res.headersSent) {
                res.status(500).json({ error: ApiError.INTERNAL_ERROR } as ApiResponse);
            }
        }
    };

router.get('/method', safe(async (req: Request, res: Response) => {
    const authType = await configService.getParameter(IplayarrParameter.AUTH_TYPE);
    res.json({ message: authType });
}));

router.get('/oidc/login', safe(async (req: Request, res: Response) => {
    const authType = await configService.getParameter(IplayarrParameter.AUTH_TYPE);
    if (authType != 'oidc') {
        res.status(400).json({ error: ApiError.OIDC_NOT_ENABLED } as ApiResponse);
        return;
    }

    const url = await OIDCService.getAuthURL(req);

    res.json({ url });
}));

// Safe to embed inside an inline <script>: escapes everything that could close it or break the literal.
const toScriptLiteral = (value: unknown): string =>
    JSON.stringify(value ?? null).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

router.post('/oidc/test', safe(async (req: Request, res: Response) => {
    // Starts a discovery request to an address the caller supplies, so it is for logged-in admins only.
    if (!(await isAuthenticatedRequest(req))) {
        res.status(401).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
        return;
    }
    const { OIDC_CONFIG_URL, OIDC_CLIENT_ID, OIDC_CALLBACK_HOST } = req.body ?? {};
    let { OIDC_CLIENT_SECRET } = req.body ?? {};
    if (OIDC_CLIENT_SECRET === SECRET_MASK) {
        OIDC_CLIENT_SECRET = await configService.getParameter(IplayarrParameter.OIDC_CLIENT_SECRET);
    }
    if (![OIDC_CONFIG_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, OIDC_CALLBACK_HOST].every((v) => typeof v === 'string' && v)) {
        res.status(400).json({ error: ApiError.INVALID_INPUT } as ApiResponse);
        return;
    }
    try {
        const authUrl = await OIDCService.oidcConnection(
            req,
            OIDC_CONFIG_URL,
            OIDC_CLIENT_ID,
            OIDC_CLIENT_SECRET,
            OIDC_CALLBACK_HOST,
            'test'
        );
        res.redirect(authUrl);
    } catch (err: any) {
        res.status(400).json({ error: ApiError.INVALID_INPUT, message: err?.message ?? 'OIDC discovery failed' } as ApiResponse);
    }
}));

router.get('/oidc/callback', async (req: Request, res: Response) => {
    try {
        const allowedEmailsList = (await configService.getParameter(IplayarrParameter.OIDC_ALLOWED_EMAILS)) || '';
        const allowedEmails = allowedEmailsList.split(',').map((email) => email.trim().toLowerCase());
        const code = req.query.code;
        const codeVerifier = req.session.codeVerifier;
        const stateParam = req.query.state;

        // The state must be the very value this session was issued when the login started.
        if (typeof code !== 'string' || !code || !codeVerifier || typeof stateParam !== 'string' || stateParam !== req.session.state) {
            res.status(400).json({ error: ApiError.INVALID_INPUT } as ApiResponse);
            return;
        }

        const stateData = JSON.parse(Buffer.from(stateParam, 'base64url').toString());
        const isTest = stateData?.mode === 'test';
        const testDetails = req.session.oidcTest;
        if (isTest && !testDetails) {
            res.status(400).json({ error: ApiError.INVALID_INPUT } as ApiResponse);
            return;
        }
        const email: string | undefined = isTest
            ? await OIDCService.getUserEmail(req, testDetails!.configUrl, testDetails!.clientId, testDetails!.clientSecret)
            : await OIDCService.validateUser(req);
        const validUser = email && allowedEmails.includes(email.toLowerCase());

        if (isTest) {
            delete req.session.oidcTest;
            res.set('Content-Security-Policy', 'default-src \'none\'; script-src \'unsafe-inline\'');
            res.send(`
    <html>
      <body>
        <script>
          const channel = new BroadcastChannel('oidc-test');
          channel.postMessage({
            type: 'oidc-test-result',
            success: ${email ? 'true' : 'false'},
            email: ${toScriptLiteral(email)},
            error: ${toScriptLiteral(email ? undefined : 'No verified email was returned by the provider')}
          });
          setTimeout(() => window.close(), 500);
        </script>
        <p>You can close this tab.</p>
      </body>
    </html>
`);
            return;
        }

        if (!validUser) {
            res.status(401).json({ error: ApiError.INVALID_CREDENTIALS } as ApiResponse);
            return;
        }
        await startSession(req, { username: email });
        const host = process.env.DEBUG == 'true' ? `${req.protocol}://${req.headers.host?.split(':')[0]}:8080` : '';
        res.redirect(`${host}${basePath()}/queue`);
    } catch {
        // A malformed state or a failed provider exchange is a bad request, never a crashed process.
        if (!res.headersSent) {
            res.status(400).json({ error: ApiError.INVALID_INPUT } as ApiResponse);
        }
    }
});

router.post('/login', safe(async (req: Request, res: Response) => {
    const [AUTH_USERNAME, AUTH_PASSWORD] = await Promise.all([
        configService.getParameter(IplayarrParameter.AUTH_USERNAME),
        configService.getParameter(IplayarrParameter.AUTH_PASSWORD),
    ]);
    const { username, password } = req.body ?? {};
    const clientKey = req.ip ?? 'unknown';

    if (loginLimiter.isBlocked(clientKey)) {
        res.setHeader('Retry-After', String(loginLimiter.retryAfterSeconds(clientKey)));
        res.status(429).json({ error: ApiError.INVALID_CREDENTIALS, message: 'Too many failed logins, try again later' } as ApiResponse);
        return;
    }

    if (typeof username !== 'string' || typeof password !== 'string' || username !== AUTH_USERNAME || !AUTH_PASSWORD) {
        loginLimiter.recordFailure(clientKey);
        res.status(401).json({ error: ApiError.INVALID_CREDENTIALS } as ApiResponse);
        return;
    }

    let passwordValid = false;

    if (isLegacyMD5Hash(AUTH_PASSWORD)) {
        // Stored password is a legacy MD5 hash — compare with MD5, then migrate to bcrypt
        passwordValid = md5(password) === AUTH_PASSWORD;
        if (passwordValid) {
            const bcryptHash = await hashPassword(password);
            await configService.setParameter(IplayarrParameter.AUTH_PASSWORD, bcryptHash);
        }
    } else {
        // Stored password is a bcrypt hash
        passwordValid = await comparePassword(password, AUTH_PASSWORD);
    }

    if (passwordValid) {
        loginLimiter.reset(clientKey);
        await startSession(req, { username });
        res.json({ status: true });
        return;
    }

    loginLimiter.recordFailure(clientKey);
    res.status(401).json({ error: ApiError.INVALID_CREDENTIALS } as ApiResponse);
}));

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ status: true });
    });
});

router.get('/me', safe(async (req: Request, res: Response) => {
    const [authType, username] = await Promise.all([
        configService.getParameter(IplayarrParameter.AUTH_TYPE),
        configService.getParameter(IplayarrParameter.AUTH_USERNAME),
    ]);
    if (authType == 'none') {
        req.session.user = { username: username || 'admin' };
    }
    if (!req.session?.user) {
        res.status(401).json({ error: ApiError.NOT_AUTHORISED } as ApiResponse);
        return;
    } else {
        res.json(req.session.user);
        return;
    }
}));

router.get('/generateToken', (_: Request, res: Response) => {
    if (Date.now() - tokenIssuedAt < TOKEN_COOLDOWN_MS) {
        res.status(429).json({ error: ApiError.INVALID_INPUT, message: 'A reset token was issued recently' } as ApiResponse);
        return;
    }
    tokenIssuedAt = Date.now();
    token = v4();
    console.log(`FORGOT PASSWORD TOKEN: ${token} This expires in 5 minutes`);
    if (resetTimer) {
        clearTimeout(resetTimer);
    }
    resetTimer = setTimeout(() => (token = ''), 300000);
    res.json({ status: true });
});

router.post('/resetPassword', safe(async (req: Request, res: Response) => {
    const { key } = req.body;

    if (tokenMatches(key)) {
        token = '';
        clearTimeout(resetTimer);
        await configService.setParameter(IplayarrParameter.AUTH_USERNAME, configService.defaultConfigMap.AUTH_USERNAME);
        await configService.setParameter(IplayarrParameter.AUTH_TYPE, configService.defaultConfigMap.AUTH_TYPE);
        // A random password printed to the container log, never the old well-known default.
        await setGeneratedPassword('Password reset.');
    }

    res.json({ status: true });
}));

export default router;
