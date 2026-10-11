# Authentication

iPlayarr gates its own frontend/API (`/json-api/*`) with a session cookie, independent of the `API_KEY` that gates the Newznab/SABnzbd surface Sonarr/Radarr talk to (`/api`). The two are deliberately separate — Sonarr/Radarr never need a login session, only the API key.

## Auth types (`AUTH_TYPE`)

Set under Settings → Authentication → **Authentication Enabled?**, or the `AUTH_TYPE` env var. Three values (`src/routes/AuthRoute.ts`):

| Value | Behavior |
| --- | --- |
| `form` (default) | Username/password login form. Credentials checked against `AUTH_USERNAME`/`AUTH_PASSWORD`. |
| `oidc` | OpenID Connect login via an external identity provider. |
| `none` | No login — every request to `/json-api/*` is treated as the configured `AUTH_USERNAME` (or `admin` if unset). Only use this if iPlayarr's web UI isn't exposed anywhere untrusted. A warning is logged on every start, and the executable settings (`GET_IPLAYER_EXEC`, `YTDLP_EXEC`, additional download parameters) can't be changed from the UI in this mode. |

## Initial credentials

There is **no default password**. On first start (or on an install still using the old well-known `admin` / `password` default) iPlayarr generates a random password for the `admin` user, stores its bcrypt hash, and prints the plaintext **once** to the server/container console log (`Web UI login -> username: admin  password: ...`). It is never sent over HTTP. Change it under Settings → Authentication → Username/Password.

### Legacy MD5 hashes

If `AUTH_PASSWORD` was set to a raw MD5 hash by an older version of iPlayarr, `AuthRoute.ts`'s `/login` handler detects that (`isLegacyMD5Hash`) and verifies against it directly. On a successful login with a legacy hash, the password is silently re-hashed with bcrypt and saved back — no action needed, it just upgrades itself the next time you log in.

## Upgrading from an older version

On every start iPlayarr checks the web UI password (`AUTH_PASSWORD`, from Settings or the environment):

- **You set your own password** — it is left exactly as it is. No action needed.
- **No password is set, or it is still the old shipped default** (`admin` / `password`) — iPlayarr generates a random one, stores its bcrypt hash and prints the plaintext **once** in the container log as `Web UI login -> username: admin  password: ...`. Find it with `docker logs <container> 2>&1 | grep "Web UI login"`, log in, then change it in Settings → Authentication. If you miss it, use the [password reset](#forgotten-password-reset).
- **`AUTH_TYPE=none`** — there is no login, so nothing visibly changes, but the password is still rotated and a warning is logged on every start: with login disabled anyone who can reach the port is an admin. Only use it on a trusted network.
- **`AUTH_TYPE=oidc`** — unaffected.

Other upgrade effects: everyone is signed out once (the session signing secret is now generated and stored in Redis rather than the old built-in `default_secret_key`), and stored credentials are encrypted in place on first start (see [SECURITY.md](SECURITY.md)). Both are automatic.

## Changing credentials

Settings → Authentication → Username / Password. Changes apply to the next login — Password is only shown as a change-it field, never redisplayed.

### Forgotten password reset

There's a token-based reset flow that doesn't require being logged in:

1. `GET /auth/generateToken` generates a one-time reset token and prints it to the **server/container console logs** (`FORGOT PASSWORD TOKEN: ... This expires in 5 minutes`) — it is never shown in the UI or sent anywhere, so you need access to the container logs to use it.
2. `POST /auth/resetPassword` with `{ "key": "<token>" }` resets `AUTH_USERNAME` and `AUTH_TYPE` to their defaults (`admin` / `form`) and sets a **new random password**, printed to the console log (never returned in the response), if the token matches and hasn't expired. A token is single-use, and `generateToken` can only be called once a minute so it can't be spammed to invalidate the token you just read.

This is a deliberate "break glass" path for someone who already has access to the host/container (and its logs) but has locked themselves out of the UI — it isn't exposed as a button anywhere in the frontend.

## OIDC

Settings → Authentication → set **Authentication Enabled?** to OpenID Connect (OIDC). Required fields:

- **OIDC Configuration URL** (`OIDC_CONFIG_URL`) — the provider's discovery/config URL.
- **OIDC Callback Host** (`OIDC_CALLBACK_HOST`) — must exactly match what's registered with your OIDC provider as the callback URL (`<host>/auth/oidc/callback`; the Settings UI shows you this full value in an info banner).
- **OIDC Client ID** / **OIDC Client Secret** (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`).
- **OIDC Allowed Emails** (`OIDC_ALLOWED_EMAILS`) — comma-separated. A successful login against the provider is still rejected (`ApiError.INVALID_CREDENTIALS`) if the authenticated email isn't in this list, so this acts as the actual access control, not just the provider's own auth.

The **Test OIDC** button in Settings opens a popup, runs the full OIDC flow against a `/auth/oidc/test` callback, and reports success/failure without actually logging you into the main app — use it before saving to confirm the provider details are correct. Saving with `AUTH_TYPE=oidc` while untested prompts a confirmation dialog first.

## Session / cookie behavior

Sessions are stored in Redis (`connect-redis`, prefix `iplayarr:`), not in-memory — so sessions survive an app restart as long as the same Redis instance/data persists, and don't survive a `FLUSHALL` or switching to a different Redis instance. Session cookies last 24 hours (`src/routes/AuthRoute.ts`), are `HttpOnly` and `SameSite=Lax`, and get a fresh session id on every login. They are not marked `Secure` by default so they work over plain HTTP; set `SESSION_COOKIE_SECURE=true` if the UI is only ever reached over HTTPS (for example behind your own TLS-terminating reverse proxy). In `DEBUG=true` mode CORS is permissive for the separate frontend dev server.

`SESSION_SECRET` (env, optional) signs the session cookie. If you don't set it, a random 256-bit secret is generated once and kept in Redis — there is no built-in default any more.

Other protections on the login path:

- **Rate limiting:** 10 failed logins from one address within 15 minutes returns `429` with a `Retry-After` header, even for the right password, until the window passes.
- **Cross-site requests:** requests to `/json-api` that a browser marks as coming from another site (`Sec-Fetch-Site: cross-site`, or a foreign `Origin` on a write) are refused with `403`. Scripts and tools that send no such headers are unaffected.
- **Live updates:** the Socket.IO feed (queue, history, streams, logs) needs the same login as the rest of the UI.
- **Secrets are masked:** the Apps and Settings pages receive saved API keys, passwords and the OIDC client secret as `********`; submitting the placeholder back means "keep the saved value".
