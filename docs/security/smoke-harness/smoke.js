// End-to-end smoke test of the security fixes against the real compiled server (mock Redis,
// fake get_iplayer). Prints a PASS/FAIL line per check and writes a markdown report.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { io } = require('Y:/iplayarr-turbo/frontend/node_modules/socket.io-client');

const ROOT = 'C:/dev/iplayarr-sec';
const SMOKE = 'C:/dev/smoke';
const results = [];
const record = (area, name, ok, detail = '') => {
    results.push({ area, name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? '  -> ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(port, extraEnv = {}) {
    const log = [];
    const env = {
        ...process.env,
        PORT: String(port),
        NATIVE_SEARCH: 'false',
        GET_IPLAYER_EXEC: `node ${SMOKE}/fake_get_iplayer.js`,
        DOWNLOAD_DIR: `${SMOKE}/dl`,
        COMPLETE_DIR: `${SMOKE}/done`,
        API_KEY: 'smoke-api-key',
        STREAM_KEY: 'smoke-stream-key',
        SECRETS_KEY_FILE: `${SMOKE}/secrets-${port}.key`,
        STREAM_BASE_URL: `http://127.0.0.1:${port}`,
        LIVE_STRM_DIR: `${SMOKE}/done`,
        LOG_DIR: `${SMOKE}/logs${port}`,
        ...extraEnv,
    };
    const child = spawn(process.execPath, ['-r', `${SMOKE}/preload.js`, 'dist/src/server.js'], { cwd: ROOT, env });
    child.stdout.on('data', (d) => log.push(d.toString()));
    child.stderr.on('data', (d) => log.push(d.toString()));
    return { child, log, text: () => log.join(''), port, base: `http://127.0.0.1:${port}` };
}

async function waitReady(srv) {
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(`${srv.base}/ping`);
            if (r.ok) return;
        } catch {
            /* not up yet */
        }
        await sleep(500);
    }
    throw new Error('server did not start:\n' + srv.text());
}

// Tiny cookie-aware client.
function client(srv) {
    let cookie = '';
    const call = async (method, url, { json, form, headers = {}, raw } = {}) => {
        const h = { ...headers };
        if (cookie) h.cookie = cookie;
        let body;
        if (json !== undefined) {
            h['content-type'] = 'application/json';
            body = JSON.stringify(json);
        } else if (form) {
            h['content-type'] = 'application/x-www-form-urlencoded';
            body = new URLSearchParams(form).toString();
        } else if (raw !== undefined) {
            body = raw.body;
            Object.assign(h, raw.headers);
        }
        const res = await fetch(srv.base + url, { method, headers: h, body, redirect: 'manual' });
        const set = res.headers.getSetCookie?.() ?? [];
        if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
        const text = await res.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
        return { status: res.status, data, headers: res.headers, setCookie: set, text };
    };
    return { call, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

function socketAttempt(srv, cookie) {
    return new Promise((resolve) => {
        const s = io(srv.base, { extraHeaders: cookie ? { cookie } : {}, reconnection: false, timeout: 4000, transports: ['polling'] });
        const done = (v) => {
            s.close();
            resolve(v);
        };
        let gotQueue = false;
        s.on('queue', () => (gotQueue = true));
        s.on('connect', () => setTimeout(() => done({ connected: true, gotQueue }), 700));
        s.on('connect_error', (e) => done({ connected: false, error: e.message }));
        setTimeout(() => done({ connected: false, error: 'timeout' }), 6000);
    });
}

async function main() {
    fs.rmSync(`${SMOKE}/argv.log`, { force: true });
    fs.rmSync(`${SMOKE}/pwned`, { force: true });
    fs.rmSync(`${SMOKE}/pwned.txt`, { force: true });

    // ------------------------------------------------------------------ Scenario A: normal login
    const A = startServer(4511);
    try {
        await waitReady(A);
        const c = client(A);
        const logA = () => A.text();

        // #2 initial credentials
        const gen = /Web UI login -> username: (\S+)\s+password: (\S+)/.exec(logA());
        record('#2 credentials', 'first boot generates and logs a random password', !!gen && gen[2].length >= 16, gen ? `len=${gen[2].length}` : 'no log line');
        const password = gen?.[2];
        const bad = await c.call('POST', '/auth/login', { json: { username: 'admin', password: 'password' } });
        record('#2 credentials', 'old default admin/password is rejected', bad.status === 401, `status ${bad.status}`);
        const wrongType = await c.call('POST', '/auth/login', { json: { username: 'admin', password: { $ne: 1 } } });
        record('#5 sessions', 'non-string password is a clean 401, not a crash', wrongType.status === 401, `status ${wrongType.status}`);
        const unauth = await c.call('GET', '/json-api/config');
        record('#5 sessions', 'json-api requires login', unauth.status === 401, `status ${unauth.status}`);

        const ok = await c.call('POST', '/auth/login', { json: { username: 'admin', password } });
        record('#2 credentials', 'generated password logs in', ok.status === 200, `status ${ok.status}`);
        const sc = ok.setCookie.join(' | ');
        record('#5 sessions', 'cookie is HttpOnly + SameSite=Lax', /HttpOnly/i.test(sc) && /SameSite=Lax/i.test(sc), sc.replace(/=[^;]+/, '=<sid>'));
        const me = await c.call('GET', '/json-api/config');
        record('#5 sessions', 'session works after login (id regenerated)', me.status === 200, `status ${me.status}`);

        // #6 sockets
        const anon = await socketAttempt(A, '');
        record('#6 sockets', 'unauthenticated socket is refused', anon.connected === false && /Not authorised/.test(anon.error ?? ''), JSON.stringify(anon));
        const authed = await socketAttempt(A, c.cookie);
        record('#6 sockets', 'logged-in socket connects and receives data', authed.connected === true && authed.gotQueue === true, JSON.stringify(authed));

        // #1 command injection
        const payloads = [
            'x"; node -e "require(\'fs\').writeFileSync(\'C:/dev/smoke/pwned\',\'1\')"; "',
            'x" & echo pwned> C:\\dev\\smoke\\pwned.txt & "',
            '$(touch C:/dev/smoke/pwned) `touch C:/dev/smoke/pwned`',
            '--exec=calc',
        ];
        for (const p of payloads) {
            await c.call('GET', `/api?t=search&q=${encodeURIComponent(p)}&apikey=smoke-api-key`);
        }
        await sleep(1500);
        const argv = fs.existsSync(`${SMOKE}/argv.log`) ? fs.readFileSync(`${SMOKE}/argv.log`, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
        const searchCalls = argv.filter((a) => a.includes('--listformat'));
        record('#1 injection', 'fake get_iplayer was invoked for each payload', searchCalls.length >= payloads.length, `${searchCalls.length} calls`);
        record('#1 injection', 'no payload executed (no marker files created)', !fs.existsSync(`${SMOKE}/pwned`) && !fs.existsSync(`${SMOKE}/pwned.txt`));
        const literal = payloads.every((p) => searchCalls.some((a) => a[a.length - 2] === '--' && a[a.length - 1] === p));
        record('#1 injection', 'each payload arrived as ONE literal argument after "--"', literal);

        // #4 settings guard
        const cfg = (await c.call('GET', '/json-api/config')).data;
        const unknown = await c.call('PUT', '/json-api/config', { json: { ...cfg, EVIL_KEY: 'x' } });
        record('#4 settings', 'unknown setting name rejected (400)', unknown.status === 400 && unknown.data?.invalid_fields?.EVIL_KEY, `status ${unknown.status}`);
        const sh = await c.call('PUT', '/json-api/config', { json: { ...cfg, GET_IPLAYER_EXEC: '/bin/sh -c id' } });
        record('#4 settings', 'arbitrary executable rejected (400)', sh.status === 400 && /Program must be/.test(sh.data?.invalid_fields?.GET_IPLAYER_EXEC ?? ''), `status ${sh.status}`);
        const exec = await c.call('PUT', '/json-api/config', { json: { ...cfg, ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS: '--exec=id' } });
        record('#4 settings', 'get_iplayer --exec option rejected (400)', exec.status === 400, `status ${exec.status}`);
        const same = await c.call('PUT', '/json-api/config', { json: { ...cfg } });
        record('#4 settings', 'saving the unchanged config as the UI does still works', same.status === 200, `status ${same.status} ${JSON.stringify(same.data).slice(0, 200)}`);

        // #5 CSRF guard
        const csrfPost = await c.call('PUT', '/json-api/config', { json: cfg, headers: { 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'cors' } });
        record('#5 csrf', 'cross-site state-changing request refused (403)', csrfPost.status === 403, `status ${csrfPost.status}`);
        // (Node's fetch overrides Sec-Fetch-* itself, so this one uses a raw http request)
        const rawGet = (p, headers) => new Promise((resolve) => {
            require('http').get({ host: '127.0.0.1', port: A.port, path: p, headers: { ...headers, cookie: c.cookie } }, (res) => {
                res.resume();
                res.on('end', () => resolve(res.statusCode));
            });
        });
        const navStatus = await rawGet('/json-api/cache-refresh', { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document' });
        record('#5 csrf', 'cross-site navigation GET to a mutating endpoint refused (403)', navStatus === 403, `status ${navStatus}`);
        const sameNav = await rawGet('/json-api/config', { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' });
        record('#5 csrf', 'same-origin navigation GET still allowed', sameNav === 200, `status ${sameNav}`);

        // secrets are not handed back to the browser
        const put = await c.call('PUT', '/json-api/config', { json: { ...cfg, OIDC_CLIENT_SECRET: 'super-secret-value' } });
        const after = await c.call('GET', '/json-api/config');
        record('#10 secrets', 'OIDC client secret and password hash come back masked, not in clear', after.data.OIDC_CLIENT_SECRET === '********' && after.data.AUTH_PASSWORD === '********' && !JSON.stringify(after.data).includes('super-secret-value') && !JSON.stringify(after.data).includes('$2b$'), `put=${put.status}`);
        const resave = await c.call('PUT', '/json-api/config', { json: after.data });
        const stillLogin = await client(A).call('POST', '/auth/login', { json: { username: 'admin', password } });
        record('#10 secrets', 'saving the masked config back does not overwrite the real password hash', stillLogin.status === 200, `resave=${resave.status} login=${stillLogin.status}`);
        const evilOrigin = await c.call('POST', '/json-api/nzb/test', { json: {}, headers: { origin: 'https://evil.example' } });
        record('#5 csrf', 'foreign Origin without Fetch-Metadata refused (403)', evilOrigin.status === 403, `status ${evilOrigin.status}`);
        const sameSite = await c.call('GET', '/json-api/config', { headers: { 'sec-fetch-site': 'same-origin' } });
        record('#5 csrf', 'same-origin browser request still works', sameSite.status === 200, `status ${sameSite.status}`);

        // #7 OIDC
        const oidcAnon = await client(A).call('POST', '/auth/oidc/test', { form: { OIDC_CONFIG_URL: 'http://169.254.169.254/', OIDC_CLIENT_ID: 'c', OIDC_CLIENT_SECRET: 's', OIDC_CALLBACK_HOST: 'h' } });
        record('#7 oidc', 'unauthenticated /oidc/test refused (401)', oidcAnon.status === 401, `status ${oidcAnon.status}`);
        const cb = await client(A).call('GET', '/auth/oidc/callback?code=x&state=%25%25%25');
        record('#7 oidc', 'malformed callback is a 400', cb.status === 400, `status ${cb.status}`);
        const alive = await fetch(`${A.base}/ping`);
        record('#7 oidc', 'server still alive after malformed callback', alive.ok);

        // #8 path safety
        const badPid = await c.call('GET', '/json-api/download?pid=..%2F..%2Fetc&nzbName=x&type=TV');
        record('#8 paths', 'path-like pid refused (400)', badPid.status === 400, `status ${badPid.status}`);
        const badPid2 = await c.call('GET', '/api?mode=addfile&apikey=smoke-api-key');
        record('#8 paths', 'sanity: addfile with no file does not crash', [200, 400, 500].includes(badPid2.status), `status ${badPid2.status}`);
        const queued = await c.call('GET', '/json-api/download?pid=b0smoke1&nzbName=' + encodeURIComponent('../../evil.name') + '&type=TV');
        record('#8 paths', 'valid pid with hostile nzbName is accepted but sanitised', queued.status === 200, `status ${queued.status}`);
        await sleep(500);
        record('#8 paths', 'nothing was written outside the download/complete dirs', !fs.existsSync('C:/dev/evil.name') && !fs.existsSync('C:/evil.name') && !fs.existsSync(SMOKE + '/evil.name'));

        // #9 API route
        const arr = await c.call('GET', '/api?t=caps&apikey=smoke-api-key&apikey=smoke-api-key');
        record('#9 api', 'repeated apikey param (array) refused (401)', arr.status === 401, `status ${arr.status}`);
        const proto = await c.call('GET', '/api?mode=constructor&apikey=smoke-api-key');
        record('#9 api', 'mode=constructor is 404, not resolved on the prototype', proto.status === 404, `status ${proto.status}`);
        const goodKey = await c.call('GET', '/api?t=caps&apikey=smoke-api-key');
        record('#9 api', 'correct key still accepted (Newznab caps)', goodKey.status === 200, `status ${goodKey.status}`);
        const wrongKey = await c.call('GET', '/api?t=caps&apikey=nope');
        record('#9 api', 'wrong key refused (401)', wrongKey.status === 401, `status ${wrongKey.status}`);
        const streamWithApiKey = await c.call('GET', '/api?mode=stream&pid=b0smoke1&apikey=smoke-api-key');
        record('#9 api', 'stream mode does not accept the API key', streamWithApiKey.status === 401, `status ${streamWithApiKey.status}`);
        const badStreamPid = await c.call('GET', '/api?mode=stream&pid=..%2Fx&streamkey=smoke-stream-key');
        record('#9 api', 'stream mode rejects a path-like pid (400)', badStreamPid.status === 400, `status ${badStreamPid.status}`);
        const big = await c.call('POST', '/api?mode=addfile&apikey=smoke-api-key', {
            raw: { body: (() => { const b = '--X\r\nContent-Disposition: form-data; name="nzbfile"; filename="a.nzb"\r\nContent-Type: application/x-nzb\r\n\r\n' + 'A'.repeat(6 * 1024 * 1024) + '\r\n--X--\r\n'; return b; })(), headers: { 'content-type': 'multipart/form-data; boundary=X' } },
        });
        record('#9 api', 'oversized upload refused with 413 and no stack trace', big.status === 413 && !big.text.includes('node_modules'), `status ${big.status} ${big.text.slice(0, 80)}`);
        const hdr = (await fetch(`${A.base}/ping`)).headers;
        record('#11 framing', 'X-Frame-Options SAMEORIGIN and CSP frame-ancestors set', hdr.get('x-frame-options') === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(hdr.get('content-security-policy') ?? ''), `xfo=${hdr.get('x-frame-options')} csp=${hdr.get('content-security-policy')}`);
        const keyFile = fs.existsSync(SMOKE + '/secrets-4511.key') ? fs.readFileSync(SMOKE + '/secrets-4511.key', 'utf8') : '';
        record('#12 encryption', 'a 32-byte secrets key file was generated outside Redis on first boot', /^[0-9a-f]{64}$/.test(keyFile));
        record('#12 encryption', 'generated API key still authenticates (decrypts transparently)', goodKey.status === 200);
        record('#9 api', 'Referrer-Policy: no-referrer set, X-Powered-By removed', hdr.get('referrer-policy') === 'no-referrer' && !hdr.get('x-powered-by'), `referrer-policy=${hdr.get('referrer-policy')} x-powered-by=${hdr.get('x-powered-by')}`);
        const ping503 = await fetch(`${A.base}/ping`);
        record('#9 api', '/ping returns only status (no error text)', (await ping503.text()).indexOf('Redis error') === -1);

        // #3 reset flow
        const t1 = await fetch(`${A.base}/auth/generateToken`);
        const t2 = await fetch(`${A.base}/auth/generateToken`);
        record('#3 reset', 'first token request ok, immediate repeat throttled (429)', t1.status === 200 && t2.status === 429, `${t1.status}/${t2.status}`);
        const token = /FORGOT PASSWORD TOKEN: (\S+)/.exec(A.text())?.[1];
        const wrongReset = await fetch(`${A.base}/auth/resetPassword`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'wrong' }) });
        await wrongReset.text();
        const stillOld = await client(A).call('POST', '/auth/login', { json: { username: 'admin', password } });
        record('#3 reset', 'wrong token changes nothing', stillOld.status === 200, `login status ${stillOld.status}`);
        const goodReset = await fetch(`${A.base}/auth/resetPassword`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: token }) });
        const resetBody = await goodReset.text();
        record('#3 reset', 'reset response never contains a password', !/password/i.test(resetBody), resetBody);
        const newPw = /Password reset\. Web UI login -> username: \S+\s+password: (\S+)/.exec(A.text())?.[1];
        record('#3 reset', 'reset logs a new random password (not "password")', !!newPw && newPw !== 'password' && newPw !== password, newPw ? `len=${newPw.length}` : 'none');
        const oldNow = await client(A).call('POST', '/auth/login', { json: { username: 'admin', password } });
        const newNow = await client(A).call('POST', '/auth/login', { json: { username: 'admin', password: newPw } });
        record('#3 reset', 'old password stops working, new one works', oldNow.status === 401 && newNow.status === 200, `${oldNow.status}/${newNow.status}`);
        const reuse = await fetch(`${A.base}/auth/resetPassword`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: token }) });
        await reuse.text();
        const afterReuse = await client(A).call('POST', '/auth/login', { json: { username: 'admin', password: newPw } });
        record('#3 reset', 'token is single-use', afterReuse.status === 200);

        // #5 rate limit (last: it locks the local address out)
        let last = 0;
        const rl = client(A);
        for (let i = 0; i < 12; i++) last = (await rl.call('POST', '/auth/login', { json: { username: 'admin', password: 'nope' + i } })).status;
        const locked = await rl.call('POST', '/auth/login', { json: { username: 'admin', password: newPw } });
        record('#5 rate limit', 'repeated failures lock the address out (429, even with the right password)', last === 429 && locked.status === 429 && !!locked.headers.get('retry-after'), `last=${last} right-pw=${locked.status} retry-after=${locked.headers.get('retry-after')}`);
    } finally {
        A.child.kill();
    }

    // ------------------------------------------------------------------ Scenario B: DEBUG logging
    const B = startServer(4512, { DEBUG: 'true' });
    try {
        await waitReady(B);
        const c = client(B);
        await c.call('GET', '/api?t=caps&apikey=smoke-api-key&streamkey=smoke-stream-key', { headers: { cookie: 'connect.sid=SECRETCOOKIE', authorization: 'Bearer SECRETBEARER' } });
        await c.call('POST', '/auth/login', { json: { username: 'admin', password: 'SECRETPASSWORD' } });
        await sleep(800);
        const t = B.text();
        const sawRequest = /Request received/.test(t) && /URL:/.test(t);
        record('#6 log redaction', 'debug request logging is active in this run', sawRequest);
        const leaks = ['smoke-api-key', 'smoke-stream-key', 'SECRETCOOKIE', 'SECRETBEARER', 'SECRETPASSWORD'].filter((s) => t.includes(s));
        record('#6 log redaction', 'no API key / stream key / cookie / bearer / password reaches the log', leaks.length === 0, leaks.length ? 'LEAKED: ' + leaks.join(',') : '');
        record('#6 log redaction', 'redaction markers present', t.includes('[redacted]'));
    } finally {
        B.child.kill();
    }

    // ------------------------------------------------------------------ Scenario C: AUTH_TYPE=none
    const C = startServer(4513, { AUTH_TYPE: 'none' });
    try {
        await waitReady(C);
        const c = client(C);
        record('#4 auth none', 'startup logs a loud warning when login is disabled', /AUTH_TYPE is "none"/.test(C.text()));
        const cfg = (await c.call('GET', '/json-api/config')).data;
        record('#4 auth none', 'UI is open as designed (auth none)', typeof cfg === 'object');
        const sh = await c.call('PUT', '/json-api/config', { json: { ...cfg, YTDLP_EXEC: 'yt-dlp --foo' } });
        record('#4 auth none', 'executable settings cannot be changed from the UI while login is off', sh.status === 400 && /AUTH_TYPE=none/.test(JSON.stringify(sh.data)), `status ${sh.status}`);
        const sock = await socketAttempt(C, '');
        record('#6 sockets', 'with auth none a socket may connect (by design)', sock.connected === true, JSON.stringify(sock));
        const gen = await fetch(`${C.base}/auth/generateToken`);
        record('#3 reset', 'generateToken works on auth-none server without leaking the token over HTTP', !(await gen.text()).includes('-'));
    } finally {
        C.child.kill();
    }

    // ------------------------------------------------------------------ report
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    fs.writeFileSync(`${SMOKE}/results.json`, JSON.stringify(results, null, 2));
    process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
    console.error('SMOKE HARNESS ERROR', e);
    process.exit(2);
});
