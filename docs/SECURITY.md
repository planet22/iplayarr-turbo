# Security review and hardening

Branch `security-hardening` (from `dev-work`). Review date: 2026-10-11. Every item below was found by reading the code; each fix has unit tests and is exercised end-to-end by the smoke test at the bottom.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| 1 | High | **Command injection**: search spawned get_iplayer with `shell: true` and the search term in plain `"..."` quotes (`q` from Newznab or `/json-api/search`). Same flag on the cache-rebuild spawn. | No shell. Term, exemptions and `--listformat` are plain argv entries; `--` precedes the term so it cannot be read as an option. Quote-stripping of `GET_IPLAYER_EXEC` moved into the tokenizer. |
| 2 | High | **Shipped default login** `admin` / `password` (bcrypt hash in `defaultConfigMap`). | No default. First boot (or an install still on the old default) generates a random password, stores the hash, prints it once to the container log. |
| 3 | High | **Password reset** set credentials back to the well-known default; `generateToken` was unthrottled and could keep replacing the token; non-constant-time compare. | Reset sets a *new random* password (logged, never in the HTTP response). Token is single-use, compared in constant time, and `generateToken` is limited to once a minute. Loud startup warning when `AUTH_TYPE=none`. |
| 4 | High | **Settings API = RCE**: PUT accepted any key; `GET_IPLAYER_EXEC`, `YTDLP_EXEC`, `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` become the executable and args. | Whitelist of known setting names, plain values only, `PORT` read-only. Executable must be get_iplayer, yt-dlp or perl (no `perl -e`); extra args may not use `--exec` / `--command`; while `AUTH_TYPE=none` those three cannot be changed from the UI at all (set them via environment). |
| 5 | Medium | Hard-coded fallback session secret; cookie not httpOnly/SameSite; no login throttling; no session regeneration; state-changing GETs reachable by cross-site navigation. | Random 256-bit secret generated once and kept in Redis (`SESSION_SECRET` still wins). Cookie `HttpOnly; SameSite=Lax` (`SESSION_COOKIE_SECURE=true` adds `Secure`). New session id on login. 10 failures per 15 min per address gives 429. A Fetch-Metadata / Origin guard refuses cross-site requests to `/json-api` (and non-GET to `/auth`). |
| 6 | Medium | Socket.IO had **no authentication** (queue, history, streams, logs). Debug log wrote full headers/URL/body (API keys, cookies, passwords) and broadcast them to sockets and Redis. | Sockets use the same session cookie and are refused without login. Credentials are redacted from request debug logs. `/ping` no longer returns Redis error text. |
| 7 | Medium | OIDC: `/auth/oidc/test` unauthenticated (SSRF to any URL); callback `JSON.parse` of attacker state crashed the process (Express 4 async); client secret travelled in the `state` URL; email interpolated into inline script; `email_verified` ignored. | Test endpoint requires login; test secrets live in the session; state is only mode + nonce and must equal the session's; callback wrapped (400, never a crash); output escaped; unverified emails rejected. Global `unhandledRejection` guard. |
| 8 | Medium | **Path traversal**: `nzbName` and `pid` were used raw in file and directory paths and the pid in BBC URLs; a `..` title survived sanitising. | `pid` must match `[A-Za-z0-9_-]{1,64}` at every entry point; `nzbName` is stripped of separators, control chars and leading dots at the queue; library paths are asserted to stay inside the complete dir. |
| 9 | Low-Med | API key compared with `==`, arrays accepted, key checked *after* the multipart parser, no upload limits, prototype names (`constructor`) resolvable as modes, default Express error pages with stack traces. | Constant-time, type-checked compare; key checked first; 5 MB / 10 file upload limit; own-property lookup; JSON error handler; `Referrer-Policy: no-referrer` (keys live in URLs); `X-Powered-By` removed. |
| 10 | Raised in review | Third-party credentials (Sonarr/Radarr/Jellyfin/SABnzbd keys and passwords, OIDC client secret) were returned in full by `GET /json-api/apps` and `/config`. | Returned masked (`********`); a masked value coming back on save or test means "unchanged" and the stored value is restored. |

## How credentials are stored (item 10)

* Settings and the apps list (with each app's API key / password) are JSON in Redis, **in plaintext**. The server has to be able to read them to call Sonarr/Radarr/Jellyfin, so hashing is not an option. Only the web UI password is hashed (bcrypt).
* Anyone who can read Redis (or its `dump.rdb` / backups) therefore gets every key. Keep Redis off any published port, set `REDIS_PASSWORD` if it is shared, and treat Redis backups as secrets.
* Encrypting those values at rest only helps if the encryption key lives somewhere an attacker with Redis access cannot reach (an env var or secret file). That is a worthwhile follow-up but a bigger change (migration of existing data), so it is **not** done here.
* What changed: the browser no longer receives them back (masked), which keeps them out of page loads, dev-tools, proxies and screenshots. The API key and stream key are deliberately still shown in Settings (you copy them into Sonarr and `.strm` files); they are only visible to a logged-in session.

## Behaviour changes you will notice

* First start on an install still using the old default: a new random password is generated and printed in the container log (look for `Web UI login`). With `AUTH_TYPE=none` nothing changes for you apart from a startup warning, but the password is rotated for the day you switch back to `form`.
* Password reset no longer returns to `admin` / `password`; it prints a new random one.
* Sessions are signed with a generated secret, so existing logged-in browsers are signed out once after upgrade.
* With `AUTH_TYPE=none` the executable settings are read-only in the UI (set `GET_IPLAYER_EXEC`, `YTDLP_EXEC`, `ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS` as environment variables). Saving an unchanged value still works.
* Settings PUT rejects unknown keys (the UI only sends known ones).
* New optional env var: `SESSION_COOKIE_SECURE=true` (HTTPS-only deployments).
* Dev (`DEBUG=true`): the Vite dev server's socket now sends credentials (`withCredentials`), required because sockets are authenticated.

## Not done / residual risk

* Plaintext credentials in Redis (above).
* `AUTH_TYPE=none` is still supported and gives every network client full admin (minus the executable settings). Do not expose it.
* A stream key in a `.strm` file can be read by anyone with filesystem access; it only unlocks streaming and live endpoints.
* No `X-Frame-Options` / CSP header was added because it could break dashboards that embed the UI; add `frame-ancestors` at the reverse proxy if wanted.
* The Apps / Jellyfin / NZB "test connection" features can still make the server request any URL for a logged-in admin (by design for an integrations UI).
* No dependency audit was done. `multer@1.x` (deprecated, known issues) is in use; upgrading to 2.x is recommended.
* 5 `versionService` unit tests fail on this machine both before and after these changes (pre-existing, unrelated).

## Smoke test

Run against the **compiled server** (`tsc` output), with an in-memory Redis (ioredis-mock) and a fake `get_iplayer` that records its argv, over real HTTP and WebSocket. Three server instances: normal login, `DEBUG=true` (log redaction), `AUTH_TYPE=none`. Harness: `docs/security/smoke-harness/` (paths are hard-coded to `C:/dev/...`; edit the constants at the top of `smoke.js`). Run `npm run build:backend`, then `node smoke.js`.

Unit tests: 1082 run, 5 failing (the pre-existing `versionService` ones).

**Result: 54/54 checks passed.**

| Result | Area | Check |
|---|---|---|
| PASS | #2 credentials | first boot generates and logs a random password |
| PASS | #2 credentials | old default admin/password is rejected |
| PASS | #5 sessions | non-string password is a clean 401, not a crash |
| PASS | #5 sessions | json-api requires login |
| PASS | #2 credentials | generated password logs in |
| PASS | #5 sessions | cookie is HttpOnly + SameSite=Lax |
| PASS | #5 sessions | session works after login (id regenerated) |
| PASS | #6 sockets | unauthenticated socket is refused |
| PASS | #6 sockets | logged-in socket connects and receives data |
| PASS | #1 injection | fake get_iplayer was invoked for each payload |
| PASS | #1 injection | no payload executed (no marker files created) |
| PASS | #1 injection | each payload arrived as ONE literal argument after "--" |
| PASS | #4 settings | unknown setting name rejected (400) |
| PASS | #4 settings | arbitrary executable rejected (400) |
| PASS | #4 settings | get_iplayer --exec option rejected (400) |
| PASS | #4 settings | saving the unchanged config as the UI does still works |
| PASS | #5 csrf | cross-site state-changing request refused (403) |
| PASS | #5 csrf | cross-site navigation GET to a mutating endpoint refused (403) |
| PASS | #5 csrf | same-origin navigation GET still allowed |
| PASS | #10 secrets | OIDC client secret and password hash come back masked, not in clear |
| PASS | #10 secrets | saving the masked config back does not overwrite the real password hash |
| PASS | #5 csrf | foreign Origin without Fetch-Metadata refused (403) |
| PASS | #5 csrf | same-origin browser request still works |
| PASS | #7 oidc | unauthenticated /oidc/test refused (401) |
| PASS | #7 oidc | malformed callback is a 400 |
| PASS | #7 oidc | server still alive after malformed callback |
| PASS | #8 paths | path-like pid refused (400) |
| PASS | #8 paths | sanity: addfile with no file does not crash |
| PASS | #8 paths | valid pid with hostile nzbName is accepted but sanitised |
| PASS | #8 paths | nothing was written outside the download/complete dirs |
| PASS | #9 api | repeated apikey param (array) refused (401) |
| PASS | #9 api | mode=constructor is 404, not resolved on the prototype |
| PASS | #9 api | correct key still accepted (Newznab caps) |
| PASS | #9 api | wrong key refused (401) |
| PASS | #9 api | stream mode does not accept the API key |
| PASS | #9 api | stream mode rejects a path-like pid (400) |
| PASS | #9 api | oversized upload refused with 413 and no stack trace |
| PASS | #9 api | Referrer-Policy: no-referrer set, X-Powered-By removed |
| PASS | #9 api | /ping returns only status (no error text) |
| PASS | #3 reset | first token request ok, immediate repeat throttled (429) |
| PASS | #3 reset | wrong token changes nothing |
| PASS | #3 reset | reset response never contains a password |
| PASS | #3 reset | reset logs a new random password (not "password") |
| PASS | #3 reset | old password stops working, new one works |
| PASS | #3 reset | token is single-use |
| PASS | #5 rate limit | repeated failures lock the address out (429, even with the right password) |
| PASS | #6 log redaction | debug request logging is active in this run |
| PASS | #6 log redaction | no API key / stream key / cookie / bearer / password reaches the log |
| PASS | #6 log redaction | redaction markers present |
| PASS | #4 auth none | startup logs a loud warning when login is disabled |
| PASS | #4 auth none | UI is open as designed (auth none) |
| PASS | #4 auth none | executable settings cannot be changed from the UI while login is off |
| PASS | #6 sockets | with auth none a socket may connect (by design) |
| PASS | #3 reset | generateToken works on auth-none server without leaking the token over HTTP |
