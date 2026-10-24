/* Real-life UI flows (run with --write). Drives the actual pages like a user, takes screenshots, and
 * verifies the effect through the API. Everything created is SMOKE-TEMP or reverted. */
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function uiReal(browser, ctx, { http, rec, BASE, SHOTS }) {
    const U = 'ui-real';
    const shot = async (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `real-${name}.png`), fullPage: full }).catch(() => {});
    const cleanups = [];
    const flow = async (name, fn) => {
        const errs = [];
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 100)));
        page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver/.test(m.text())) errs.push('console: ' + m.text().slice(0, 100)); });
        try { await fn(page, context); }
        catch (e) { rec(U, name, 'FAIL', 'threw: ' + e.message.split('\n')[0]); await shot(page, 'FAILED-' + name.replace(/\W+/g, '-')); }
        if (errs.length) rec(U, `${name}: no page/console errors`, 'FAIL', errs.slice(0, 2).join(' | '));
        await context.close();
    };
    const ok = (n, c, d = '') => rec(U, n, c ? 'PASS' : 'FAIL', c ? '' : d);
    const warn = (n, c, d = '') => rec(U, n, c ? 'PASS' : 'WARN', c ? '' : d);
    const dialog = (page) => page.locator('[role=dialog], .modal, .modalContent, .dialog').first();
    const clickDialogPrimary = async (page) => {
        const d = dialog(page);
        await d.waitFor({ timeout: 8000 });
        const btns = d.locator('button');
        const n = await btns.count();
        // primary action is the last non-close button
        for (let i = n - 1; i >= 0; i--) {
            const t = ((await btns.nth(i).innerText().catch(() => '')) || '').trim();
            if (t && !/cancel|close|back|no\b/i.test(t)) { await btns.nth(i).click(); return t; }
        }
        return null;
    };
    const pid = ctx.pid;
    const brand = (await http(`/json-api/browse/programme/${pid}`)).json;
    const bpid = brand?.pid;
    ctx.preSubscribed = ((await http('/json-api/subscriptions')).json || []).some((x) => x.pid === bpid);

    try {
        // ---- Search: header box -> results -> download dialog
        await flow('search flow', async (page) => {
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            const box = page.locator('input[placeholder*="Search"]').first();
            await box.fill('traitors');
            await box.press('Enter');
            await page.waitForTimeout(1500);
            await shot(page, 'search-1-typed');
            await page.waitForFunction(() => !/Searching|Loading/i.test(document.body.innerText), null, { timeout: 45000 }).catch(() => {});
            await page.waitForTimeout(2500);
            const cards = page.locator('[class*=card], tbody tr, [class*=result]');
            const empty = /No results for/.test(await page.locator('body').innerText());
            ok('header search shows results for "traitors"', !empty && (await cards.count()) > 0, empty ? 'UI says No results (API /json-api/search?q=traitors)' : page.url());
            warn('search lands on a results route', /search|browse/.test(page.url()), page.url());
            await shot(page, 'search-2-results', true);
            const dl = page.locator('button[title*="ownload"], button[aria-label*="ownload"]').first();
            if (await dl.count()) {
                await dl.click();
                await page.waitForTimeout(1500);
                const d = dialog(page);
                warn('download dialog opens from search', (await d.count()) > 0 && (await d.isVisible().catch(() => false)));
                await shot(page, 'search-3-download-dialog');
                await page.keyboard.press('Escape');
            } else rec(U, 'search result download button', 'WARN', 'not found');
        });

        // ---- Programme page: subscribe via UI, see it, unsubscribe via UI
        await flow('subscribe via UI', async (page) => {
            if (!bpid) return rec(U, 'subscribe via UI', 'SKIP', 'no brand pid');
            const existing = ((await http('/json-api/subscriptions')).json || []).find((s) => s.pid === bpid);
            if (existing) await http('/json-api/subscriptions/' + existing.id, { method: 'DELETE' });
            cleanups.push(async () => { const s = ((await http('/json-api/subscriptions')).json || []).find((x) => x.pid === bpid); if (s) await http('/json-api/subscriptions/' + s.id, { method: 'DELETE' }); });
            await page.goto(`${BASE}/browse/programme/${pid}`, { waitUntil: 'networkidle' });
            await shot(page, 'programme-desktop', true);
            await page.getByRole('button', { name: /^\s*Subscribe/ }).first().click();
            await page.waitForTimeout(1000);
            await shot(page, 'subscribe-dialog');
            const hadDialog = await dialog(page).count();
            if (hadDialog) await clickDialogPrimary(page);
            await page.waitForTimeout(2500);
            ok('subscription created by UI', ((await http('/json-api/subscriptions')).json || []).some((s) => s.pid === bpid), 'not in API');
            await shot(page, 'subscribe-after');
            await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
            await page.waitForTimeout(800);
            await shot(page, 'subscriptions-with-new', true);
            ok('subscriptions page shows it', (await page.locator('body').innerText()).includes(brand.title), brand.title);
            const unsub = page.getByRole('button', { name: 'Unsubscribe' }).first();
            // find the card for our title
            const card = page.locator(`text=${brand.title}`).first().locator('xpath=ancestor::*[.//button[@aria-label="Unsubscribe" or @title="Unsubscribe"]][1]');
            const target = (await card.count()) ? card.locator('button[title="Unsubscribe"], button[aria-label="Unsubscribe"]').first() : unsub;
            await target.click();
            await page.waitForTimeout(800);
            if (await dialog(page).count()) { await shot(page, 'unsubscribe-confirm'); await clickDialogPrimary(page); }
            await page.waitForTimeout(2000);
            ok('unsubscribed by UI', !((await http('/json-api/subscriptions')).json || []).some((s) => s.pid === bpid), 'still subscribed');
        });

        // ---- Download from programme page -> toast -> queue page -> cancel in UI
        await flow('download via UI + queue', async (page) => {
            const eps = (brand?.seasons || []).flatMap((s) => s.episodes || []);
            const ep = eps[eps.length - 1];
            if (!ep) return rec(U, 'download via UI', 'SKIP', 'no episode');
            cleanups.push(async () => { for (const h of ((await http('/json-api/queue/history')).json || []).filter((e) => e.pid === ep.pid)) await http(`/json-api/queue/history?pid=${ep.pid}&jobId=${h.jobId}`, { method: 'DELETE' }); await http(`/json-api/queue/queue?pid=${ep.pid}`, { method: 'DELETE' }); });
            await page.goto(`${BASE}/browse/programme/${pid}`, { waitUntil: 'networkidle' });
            const before = ((await http('/json-api/queue/queue')).json || []).length;
            await page.locator('button[title="Download"], button[aria-label="Download"]').first().click();
            await page.waitForTimeout(1200);
            await shot(page, 'episode-download-dialog');
            if (await dialog(page).count()) await clickDialogPrimary(page);
            await page.waitForTimeout(3000);
            await shot(page, 'episode-download-toast');
            const q = (await http('/json-api/queue/queue')).json || [];
            const h = (await http('/json-api/queue/history')).json || [];
            ok('UI download created a queue/history entry', q.length > before || h.some((e) => Date.now() - Date.parse(e.details?.start || 0) < 120000), `queue ${before}->${q.length}`);
            await page.goto(BASE + '/queue', { waitUntil: 'networkidle' });
            await page.waitForTimeout(1200);
            await shot(page, 'queue-table', true);
            await page.getByRole('button', { name: 'Card view' }).click().catch(() => {});
            await page.waitForTimeout(600);
            await shot(page, 'queue-cards', true);
            await page.getByRole('button', { name: 'Table view' }).click().catch(() => {});
            // open the first item's info page
            const first = page.locator('tbody a, a[href*="info"]').first();
            if (await first.count()) { await first.click(); await page.waitForTimeout(2500); await shot(page, 'queue-info-page'); ok('queue item opens info page or modal', /info/.test(page.url()) || (await dialog(page).count()) > 0, page.url()); }
        });

        // ---- Play Video: player opens, video element, no errors
        await flow('play video', async (page) => {
            await page.goto(`${BASE}/browse/programme/${pid}`, { waitUntil: 'networkidle' });
            await page.locator('button[title="Play Video"], button[aria-label="Play Video"]').first().click();
            await page.waitForTimeout(1200);
            await shot(page, 'play-version-dialog');
            if (await dialog(page).count()) await clickDialogPrimary(page);
            await page.waitForTimeout(12000);
            await shot(page, 'player');
            const v = await page.evaluate(() => { const v = document.querySelector('video'); return v ? { t: v.currentTime, rs: v.readyState, err: v.error?.message || null, w: v.videoWidth } : null; });
            ok('player has a <video> element', !!v, 'no video');
            warn('video decoded frames / progressed', !!v && (v.rs >= 2 || v.t > 0), JSON.stringify(v));
            warn('video has no media error', !v?.err, v?.err || '');
        });

        // ---- Live channel playback from Channels tiles
        await flow('live channel playback', async (page) => {
            await page.goto(BASE + '/browse/channels', { waitUntil: 'networkidle' });
            await shot(page, 'channels-tiles', true);
            await page.locator('a[href*="/browse/channel/"], [class*=tile]').first().click();
            await page.waitForTimeout(3000);
            await shot(page, 'channel-page', true);
            const watch = page.getByRole('button', { name: /watch live|play live|live/i }).first();
            if (await watch.count()) { await watch.click(); await page.waitForTimeout(9000); await shot(page, 'live-player'); warn('live player <video> present', (await page.locator('video').count()) > 0); }
            else rec(U, 'live watch button', 'WARN', 'not found');
        });

        // ---- Synonyms: add via form, verify, delete
        await flow('synonym via UI', async (page) => {
            cleanups.push(async () => { for (const s of ((await http('/json-api/synonym')).json || []).filter((x) => /SMOKE-TEMP/.test(x.from))) await http('/json-api/synonym', { method: 'DELETE', body: { id: s.id } }); });
            await page.goto(BASE + '/synonyms', { waitUntil: 'networkidle' });
            await page.locator('.listAddButton').first().click();
            await page.waitForTimeout(800);
            await shot(page, 'synonym-form');
            const inputs = dialog(page).locator('input[type=text], input:not([type])');
            await inputs.nth(0).fill('SMOKE-TEMP ui from');
            await inputs.nth(1).fill('SMOKE-TEMP ui to');
            await clickDialogPrimary(page);
            await page.waitForTimeout(1500);
            await shot(page, 'synonym-added', true);
            ok('synonym created by UI', ((await http('/json-api/synonym')).json || []).some((s) => s.from === 'SMOKE-TEMP ui from'), 'not in API');
            ok('synonym visible on page', (await page.locator('body').innerText()).includes('SMOKE-TEMP ui from'));
            const row = page.locator('text=SMOKE-TEMP ui from').first().locator('xpath=ancestor::*[.//button][1]');
            await row.locator('button').last().click().catch(() => {});
            await page.waitForTimeout(800);
            if (await dialog(page).count()) await clickDialogPrimary(page);
            await page.waitForTimeout(1500);
        });

        // ---- Settings: change appearance + a real setting, Save, reload, verify persisted, revert
        await flow('settings change + save + persist', async (page) => {
            const cfg0 = (await http('/json-api/config')).json;
            await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
            await shot(page, 'settings-general', true);
            // Appearance: pick Ocean theme (applies only on Save)
            const ocean = page.locator('button:has-text("Ocean")').first();
            if (await ocean.count()) {
                await ocean.click();
                await page.waitForTimeout(500);
                const saveBtn = page.locator('button[title="Save changes"]').first();
                ok('save bar becomes active after an edit', (await saveBtn.count()) > 0, 'no Save button');
                await shot(page, 'settings-dirty');
                const dirtyTab = await page.locator('.settingsTab.dirty').count();
                warn('edited tab is flagged dirty', dirtyTab > 0);
                const primaryBefore = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent') || getComputedStyle(document.body).backgroundColor);
                await saveBtn.click();
                await page.waitForTimeout(2000);
                await shot(page, 'settings-saved');
                await page.reload({ waitUntil: 'networkidle' });
                const themeKey = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)).slice(0, 300) + document.documentElement.outerHTML.slice(0, 200));
                warn('theme persisted across reload (Ocean)', /ocean/i.test(themeKey), themeKey.slice(0, 120));
                await shot(page, 'settings-ocean-reload');
                // revert
                await page.locator('button:has-text("iPlayarr")').first().click();
                await page.locator('button[title="Save changes"]').first().click().catch(() => {});
                await page.waitForTimeout(1500);
                void primaryBefore;
            } else rec(U, 'theme picker present', 'WARN', 'Ocean button not found');
            // Server-side setting via the UI: toggle a select on Streaming tab, Save, verify via API, revert
            await page.locator('.settingsTab:has-text("Streaming")').click();
            await page.waitForTimeout(600);
            await shot(page, 'settings-streaming', true);
            const sel = page.locator('select').first();
            if (await sel.count()) {
                const opts = await sel.locator('option').allInnerTexts();
                const cur = await sel.inputValue();
                const other = (await sel.locator('option').evaluateAll((os) => os.map((o) => o.value))).find((v) => v !== cur);
                if (other !== undefined) {
                    await sel.selectOption(other);
                    await page.waitForTimeout(400);
                    await shot(page, 'settings-streaming-dirty');
                    await page.locator('button[title="Save changes"]').first().click();
                    await page.waitForTimeout(2500);
                    await shot(page, 'settings-streaming-saved');
                    const cfg1 = (await http('/json-api/config')).json;
                    const changed = Object.keys(cfg0).filter((k) => JSON.stringify(cfg0[k]) !== JSON.stringify(cfg1[k]));
                    ok('UI save changed a server setting', changed.length > 0, 'no config key changed ' + opts.join('/'));
                    cleanups.push(async () => {
                        const now = (await http('/json-api/config')).json;
                        const back = { ...now }; for (const k of changed) back[k] = cfg0[k];
                        await http('/json-api/config', { method: 'PUT', body: back });
                    });
                    await page.reload({ waitUntil: 'networkidle' });
                    await page.locator('.settingsTab:has-text("Streaming")').click();
                    ok('changed setting persists after reload', (await page.locator('select').first().inputValue()) === other);
                    // revert via UI-equivalent API
                    const now = (await http('/json-api/config')).json;
                    const back = { ...now }; for (const k of changed) back[k] = cfg0[k];
                    const rv = await http('/json-api/config', { method: 'PUT', body: back });
                    warn('setting reverted', rv.status === 200, `HTTP ${rv.status} ${rv.text.slice(0, 100)}`);
                }
            } else rec(U, 'streaming tab select', 'WARN', 'none found');
            // visit every tab for a visual record
            for (const t of ['General', 'Media Management', 'Download Client', 'Streaming', 'Live TV', 'Authentication', 'Maintenance']) {
                await page.locator(`.settingsTab:has-text("${t}")`).first().click().catch(() => {});
                await page.waitForTimeout(500);
                await shot(page, `settings-tab-${t.toLowerCase().replace(/\W+/g, '-')}`, true);
            }
        });

        // ---- Light/dark mode toggle
        await flow('light/dark mode', async (page) => {
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            const lum = () => page.evaluate(() => { const c = getComputedStyle(document.body).backgroundColor.match(/\d+/g).map(Number); return (c[0] + c[1] + c[2]) / 3; });
            await page.getByRole('radio', { name: 'Light mode' }).first().click();
            await page.waitForTimeout(600);
            const light = await lum();
            await shot(page, 'mode-light');
            await page.getByRole('radio', { name: 'Dark mode' }).first().click();
            await page.waitForTimeout(600);
            const dark = await lum();
            await shot(page, 'mode-dark');
            ok('light mode is lighter than dark mode', light > dark + 60, `light ${light} dark ${dark}`);
        });

        // ---- Phone visuals of the main real flows
        const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
        const pp = await phone.newPage();
        for (const [r, n] of [['/browse', 'home'], [`/browse/programme/${pid}`, 'programme'], ['/queue', 'queue'], ['/subscriptions', 'subscriptions'], ['/settings', 'settings'], ['/search', 'search'], ['/streaming', 'streaming'], ['/watchdog', 'watchdog'], ['/stats', 'stats']]) {
            await pp.goto(BASE + r, { waitUntil: 'networkidle' }).catch(() => {});
            await pp.waitForTimeout(800);
            await shot(pp, `phone-${n}`, true);
            const ov = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
            ok(`phone ${n} has no horizontal overflow`, ov <= 2, `${ov}px`);
        }
        await phone.close();
    } finally {
        for (const c of cleanups.reverse()) { try { await c(); } catch (e) { rec(U, 'cleanup', 'WARN', e.message); } }
        const leak = ['/json-api/synonym', '/json-api/subscriptions'].filter(() => false);
        void leak; void sleep;
        const left = (await http('/json-api/synonym')).text.includes('SMOKE-TEMP');
        rec(U, 'ui-real cleanup leaves no test subscription', ((await http('/json-api/subscriptions')).json || []).some((x) => x.pid === bpid) && !ctx.preSubscribed ? 'FAIL' : 'PASS');
        rec(U, 'ui-real cleanup leaves no SMOKE-TEMP synonyms', left ? 'FAIL' : 'PASS');
    }
};
