# Authentication

iPlayarr gates its own frontend/API (`/json-api/*`) with a session cookie, independent of the `API_KEY` that gates the Newznab/SABnzbd surface Sonarr/Radarr talk to (`/api`). The two are deliberately separate — Sonarr/Radarr never need a login session, only the API key.

## Auth types (`AUTH_TYPE`)

Set under Settings → Authentication → **Authentication Enabled?**, or the `AUTH_TYPE` env var. Three values (`src/routes/AuthRoute.ts`):

| Value | Behavior |
| --- | --- |
| `form` (default) | Username/password login form. Credentials checked against `AUTH_USERNAME`/`AUTH_PASSWORD`. |
| `oidc` | OpenID Connect login via an external identity provider. |
| `none` | No login — every request to `/json-api/*` is treated as the configured `AUTH_USERNAME` (or `admin` if unset). Only use this if iPlayarr's web UI isn't exposed anywhere untrusted. |

## Default credentials

| Username | Password |
| --- | --- |
| `admin` | `password` |

The default password is stored as a bcrypt hash in `configService.defaultConfigMap.AUTH_PASSWORD` — there's no plaintext default sitting in the config, only the hash that `password` happens to match. Change it immediately on any instance reachable outside your own network: Settings → Authentication → Username/Password.

### Legacy MD5 hashes

If `AUTH_PASSWORD` was set to a raw MD5 hash by an older version of iPlayarr, `AuthRoute.ts`'s `/login` handler detects that (`isLegacyMD5Hash`) and verifies against it directly. On a successful login with a legacy hash, the password is silently re-hashed with bcrypt and saved back — no action needed, it just upgrades itself the next time you log in.

## Changing credentials

Settings → Authentication → Username / Password. Changes apply to the next login — Password is only shown as a change-it field, never redisplayed.

### Forgotten password reset

There's a token-based reset flow that doesn't require being logged in:

1. `GET /auth/generateToken` generates a one-time reset token and prints it to the **server/container console logs** (`FORGOT PASSWORD TOKEN: ... This expires in 5 minutes`) — it is never shown in the UI or sent anywhere, so you need access to the container logs to use it.
2. `POST /auth/resetPassword` with `{ "key": "<token>" }` resets `AUTH_USERNAME`, `AUTH_PASSWORD`, and `AUTH_TYPE` back to their defaults (`admin` / `password` / `form`) if the token matches and hasn't expired.

This is a deliberate "break glass" path for someone who already has access to the host/container (and its logs) but has locked themselves out of the UI — it isn't exposed as a button anywhere in the frontend.

## OIDC

Settings → Authentication → set **Authentication Enabled?** to OpenID Connect (OIDC). Required fields:

- **OIDC Configuration URL** (`OIDC_CONFIG_URL`) — the provider's discovery/config URL.
- **OIDC Callback Host** (`OIDC_CALLBACK_HOST`) — must exactly match what's registered with your OIDC provider as the callback URL (`<host>/auth/oidc/callback`; the Settings UI shows you this full value in an info banner).
- **OIDC Client ID** / **OIDC Client Secret** (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`).
- **OIDC Allowed Emails** (`OIDC_ALLOWED_EMAILS`) — comma-separated. A successful login against the provider is still rejected (`ApiError.INVALID_CREDENTIALS`) if the authenticated email isn't in this list, so this acts as the actual access control, not just the provider's own auth.

The **Test OIDC** button in Settings opens a popup, runs the full OIDC flow against a `/auth/oidc/test` callback, and reports success/failure without actually logging you into the main app — use it before saving to confirm the provider details are correct. Saving with `AUTH_TYPE=oidc` while untested prompts a confirmation dialog first.

## Session / cookie behavior

Sessions are stored in Redis (`connect-redis`, prefix `iplayarr:`), not in-memory — so sessions survive an app restart as long as the same Redis instance/data persists, and don't survive a `FLUSHALL` or switching to a different Redis instance. Session cookies last 24 hours (`maxAge: 1000 * 60 * 60 * 24`, `src/routes/AuthRoute.ts`) and are not marked `secure` (so they work over plain HTTP — put iPlayarr behind your own TLS-terminating reverse proxy if you want that). In `DEBUG=true` mode the cookie is also set `sameSite: 'lax'` to tolerate the separate frontend dev server origin.

`SESSION_SECRET` (env-only, default `default_secret_key`) signs the session cookie — set a real secret in production so sessions can't be forged.
