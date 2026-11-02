// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
/* Real-life UI flows (run with --write). Drives the actual pages like a user, takes screenshots, and
 * verifies the effect through the API. Everything created is SMOKE-TEMP or reverted. */
const path = require('path');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async function uiReal(browser, ctx, { http, rec, BASE, SHOTS }) {
    const U = 'ui-real';
    const shot = async (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, `real-${name}.png`), fullPage: full }).catch(() => {});
    const cleanups = [];
    const flow = async (name, fn) => {
        if (ctx.want && !ctx.want(name)) return; // --filter on the command line
        const errs = [];
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const page = await context.newPage();
        page.on('pageerror', (e) => errs.push('pageerror: ' + e.message.slice(0, 100)));
        page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ResizeObserver/.test(m.text()) && !/\/json-api\/thumbnail\//.test(m.location().url || '')) errs.push('console: ' + m.text().slice(0, 100)); });
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
            // The row's Download button is the one-click download (it queues straight away); the row itself opens the dialog.
            const dl = page.locator('button[title*="ownload"], button[aria-label*="ownload"]').first();
            rec(U, 'search result download button is accessible', (await dl.count()) > 0 ? 'PASS' : 'WARN', 'no button with a Download name');
            const row = page.locator('tbody tr td.text').first();
            if (await row.count()) {
                await row.click();
                await page.waitForTimeout(1500);
                const d = dialog(page);
                warn('download dialog opens from search', (await d.count()) > 0 && (await d.isVisible().catch(() => false)));
                await shot(page, 'search-3-download-dialog');
                // The size shown for a file download follows the Quality picker (full-HD is bigger than mobile).
                const sizeOf = async () => {
                    const m = (await d.locator('.outputNote').innerText().catch(() => '')).match(/about ([\d.]+) (KB|MB|GB)/);
                    return m ? parseFloat(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]] : undefined;
                };
                await d.getByText('Video file', { exact: true }).click().catch(() => {});
                const quality = d.locator('select').last();
                if (await quality.count()) {
                    await quality.selectOption({ value: 'fhd' }).catch(() => {});
                    const fhd = await sizeOf();
                    await quality.selectOption({ value: 'mobile' }).catch(() => {});
                    const mobile = await sizeOf();
                    warn('download dialog size follows the Quality picker', fhd > 0 && mobile > 0 && mobile < fhd, `fhd ${fhd} MB, mobile ${mobile} MB`);
                    await shot(page, 'search-3b-download-dialog-quality');
                } else rec(U, 'download dialog size follows the Quality picker', 'WARN', 'no quality select');
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
                const themeKey = await page.evaluate(() => `data-theme=${document.documentElement.dataset.theme}`);
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
            for (const t of ['General', 'Search', 'Appearance', 'Media Management', 'Download Client', 'Streaming', 'Live TV', 'Authentication', 'Maintenance']) {
                await page.locator(`.settingsTab:has-text("${t}")`).first().click().catch(() => {});
                await page.waitForTimeout(500);
                await shot(page, `settings-tab-${t.toLowerCase().replace(/\W+/g, '-')}`, true);
            }
        });

        // ---- Settings tabs: each setting sits on the tab it belongs to (read-only: nothing is changed or saved)
        await flow('settings tabs hold the right settings', async (page) => {
            const labels = async () => (await page.locator('.settingsBody label').allTextContents()).map((t) => t.trim());
            const tab = async (key) => { await page.goto(`${BASE}/settings#${key}`, { waitUntil: 'networkidle' }); await page.waitForSelector('.settingsBody', { timeout: 15000 }); await page.waitForTimeout(400); };
            await tab('general');
            const names = await page.locator('.settingsTab').allTextContents();
            ok('the tab bar lists General, Search and Appearance', ['General', 'Search', 'Appearance'].every((t) => names.some((n) => n.includes(t))), names.join());
            const general = await labels();
            ok('General holds the API key (and the advanced RSS/schedule settings)', general.some((l) => /Api Key/i.test(l)) && !general.some((l) => /Native Search|Colour Scheme/i.test(l)), general.join(' | '));

            await tab('search');
            const search = await labels();
            ok('Search holds the NZB and manual search options', search.some((l) => /^Native Search/i.test(l)) && search.filter((l) => /^Native Search/i.test(l)).length >= 2, search.join(' | '));
            ok('Search has no appearance or API key settings', !search.some((l) => /Colour Scheme|Api Key|Show Collections/i.test(l)), search.join(' | '));
            await page.locator('button[title*="dvanced"], button[aria-label*="dvanced"]').first().click().catch(() => {});
            await page.waitForTimeout(400);
            const engine = (await http('/json-api/config')).json?.NATIVE_SEARCH_ENGINE;
            if (engine === 'V2' || (await page.locator('.settingsBody').innerText()).includes('Collections')) {
                const adv = (await labels()).join(' | ');
                ok('Search (advanced, engine 2.0) offers both collection options, NZB and manual', (adv.match(/Expand BBC Collections/g) || []).length === 2 && (adv.match(/Find BBC Collections by Name/g) || []).length === 2, adv);
            }
            await shot(page, 'settings-tab-search-advanced', true);

            await tab('appearance');
            const looks = await labels();
            ok('Appearance holds the colour scheme, badges and Show Collections', ['Colour Scheme', 'Show Info Messages', 'Show Collections'].every((l) => looks.some((x) => x.includes(l))), looks.join(' | '));
            ok('Appearance has no search settings', !looks.some((l) => /Native Search|Match All/i.test(l)), looks.join(' | '));

            await tab('maintenance');
            // Wait for the Maintenance content itself: a hash-only navigation can be read before the tab has switched.
            await page.waitForFunction(() => /Scheduled tasks/i.test(document.querySelector('.settingsBody')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
            const maint = (await page.locator('.settingsBody').innerText());
            ok('Maintenance lists the scheduled tasks', /Scheduled tasks/i.test(maint));
            ok('Hours in RSS Feed and Full Schedule Refresh are no longer on Maintenance', !/Hours in RSS Feed|Full Schedule Refresh/.test(maint));

            // Old links: #general still opens General, and an unknown hash opens the first tab rather than a blank page.
            await page.goto('about:blank'); await page.goto(`${BASE}/settings#nonsense`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
            ok('an unknown tab in the link opens General', (await page.locator('.settingsTab.active').first().innerText()).includes('General'));
        });

        // ---- Settings: an Appearance edit flags only its own tab and Discard puts it back (nothing saved)
        await flow('appearance tab edits flag only that tab', async (page) => {
            await page.goto(`${BASE}/settings#appearance`, { waitUntil: 'networkidle' });
            await page.waitForSelector('.settingsBody select', { timeout: 15000 });
            const quick = page.locator('.form-group', { hasText: 'Show Quick Find Button' }).locator('select');
            const before = await quick.inputValue();
            await quick.selectOption(before === 'true' ? 'false' : 'true');
            await page.waitForTimeout(300);
            const dirty = await page.locator('.settingsTab.dirty').allTextContents();
            ok('only the Appearance tab is flagged as changed', dirty.length === 1 && dirty[0].includes('Appearance'), dirty.join('|'));
            await page.getByRole('button', { name: /^Discard$/ }).click();
            await page.waitForTimeout(300);
            ok('Discard clears the flag and restores the value', (await page.locator('.settingsTab.dirty').count()) === 0 && (await quick.inputValue()) === before);
            // The same for a server setting on Search, which must not flag Appearance.
            await page.goto(`${BASE}/settings#search`, { waitUntil: 'networkidle' });
            const native = page.locator('.form-group', { hasText: 'Native Search' }).locator('select').first();
            const n0 = await native.inputValue();
            await native.selectOption(n0 === 'true' ? 'false' : 'true');
            await page.waitForTimeout(300);
            const d2 = await page.locator('.settingsTab.dirty').allTextContents();
            ok('a Search edit flags only the Search tab', d2.length === 1 && d2[0].includes('Search'), d2.join('|'));
            await page.getByRole('button', { name: /^Discard$/ }).click();
            ok('nothing was saved', (await http('/json-api/config')).json?.NATIVE_SEARCH === n0);
        });

        // ---- Collections: the menu item and page follow Show Collections, and Discover never has a row (restored afterwards)
        await flow('collections menu and page', async (page) => {
            const cfg0 = (await http('/json-api/config')).json || {};
            const was = cfg0.BROWSE_SHOW_COLLECTIONS;
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: { BROWSE_SHOW_COLLECTIONS: was } }); });
            const put = (v) => http('/json-api/config', { method: 'PUT', body: { BROWSE_SHOW_COLLECTIONS: v } });
            const nav = () => page.locator('.LeftHandNav a', { hasText: /^\s*Collections\s*$/ });

            await put('false');
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            ok('no Collections menu item while it is off', (await nav().count()) === 0);
            await page.goto(BASE + '/browse/collections', { waitUntil: 'networkidle' });
            await page.waitForTimeout(800);
            ok('the Collections page says it is switched off and links to Settings', /switched off/i.test(await page.locator('body').innerText()) && (await page.locator('a[href*="settings"][href*="appearance"]').count()) > 0);

            await put('true');
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            ok('a Collections menu item appears when it is on', (await nav().count()) === 1);
            const listed = ((await http('/json-api/browse/collections', { timeout: 120000 })).json?.collections) || [];
            if (!listed.length) return rec(U, 'collections page tiles', 'SKIP', 'iPlayer lists no collections right now');
            ok('Discover has no Collections row even while it is on (they have their own page)', (await page.locator('.collectionsRail, .collectionCard').count()) === 0);

            await nav().first().click();
            await page.waitForSelector('.collectionGrid .collectionCard', { timeout: 30000 });
            ok('the menu item opens the Collections page', /\/browse\/collections/.test(page.url()));
            // The grid is paged (16 a page by default), so page 1 holds at most 16 of the list.
            const tiles = await page.locator('.collectionGrid .collectionCard').count();
            ok('the page lists the same collections', tiles > 0 && tiles <= listed.length && (listed.length <= 16 || tiles === 16), `${tiles} of ${listed.length}`);
            ok('each tile carries the group icon and a title count', (await page.locator('.collectionGrid .collectionCard .groupIcon').count()) === tiles && /\d+ titles?/.test(await page.locator('.collectionGrid .collectionCard .count').first().innerText()));
            if (listed.length > 12) {
                const filter = page.locator('.SettingsPageToolbar input.tableFilter[aria-label="Filter collections by title"]');
                ok('a long list has a title filter in the standard toolbar', (await filter.count()) === 1);
                await filter.fill(listed[0].title.split(' ')[0]);
                const narrowed = await page.locator('.collectionGrid .collectionCard').count();
                ok('typing narrows the tiles and keeps the matching collection', narrowed >= 1 && narrowed < listed.length, `${narrowed} of ${listed.length}`);
                await filter.fill('zzqqxxy');
                ok('a word that matches nothing shows none and says so', (await page.locator('.collectionGrid .collectionCard').count()) === 0 && /No collection matches/.test(await page.locator('body').innerText()));
                await filter.fill('');
                ok('clearing the filter brings every collection back', (await page.locator('.collectionGrid .collectionCard').count()) === listed.length || (await page.locator('.listPagination').count()) > 0);
                // Sort: the standard control (select + direction arrow); BBC order has a greyed, non-clickable arrow.
                const sortSel = page.locator('.SettingsPageToolbar select[aria-label="Sort by"]').first();
                ok('the tiles have the standard sort control', (await sortSel.count()) === 1);
                ok('BBC order shows a greyed direction icon that is not a button', (await page.locator('.SettingsPageToolbar .orderPlaceholder').count()) === 1 && (await page.locator('.SettingsPageToolbar button[aria-label="Ascending"], .SettingsPageToolbar button[aria-label="Descending"]').count()) === 0);
                await sortSel.selectOption('name');
                const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
                const titles = async () => page.locator('.collectionGrid .collectionCard .title').allInnerTexts();
                const sizes = async () => (await page.locator('.collectionGrid .collectionCard .count').allInnerTexts()).map((t) => parseInt(t, 10));
                const byName = await titles();
                ok('A-Z orders the tiles by title', byName.length < 2 || byName.slice(1).every((t, i) => cmp(byName[i], t) <= 0), byName.slice(0, 3).join(' | '));
                await page.locator('.SettingsPageToolbar button[aria-label="Ascending"]').click();
                const byNameDesc = await titles();
                ok('the arrow flips to Z-A', byNameDesc.length < 2 || byNameDesc.slice(1).every((t, i) => cmp(byNameDesc[i], t) >= 0), byNameDesc.slice(0, 3).join(' | '));
                await sortSel.selectOption('size');
                const bySize = await sizes();
                ok('Size starts largest first', bySize.length < 2 || bySize.slice(1).every((n, i) => bySize[i] >= n), bySize.slice(0, 5).join(','));
                await sortSel.selectOption('default');
                // Paging follows the Items Before Paging preference (default 4) and the 16 per page default.
                ok('more tiles than a page shows the pager (above and below) with page sizes up to 1024', listed.length <= 16 || ((await page.locator('.listPagination').count()) === 2 && (await page.locator('.listPagination select option[value="1024"]').count()) >= 1));
            }
            await shot(page, 'collections-page');
            await page.locator('.collectionGrid .collectionCard').first().click();
            await page.waitForSelector('.openCollection .programmeCard', { timeout: 30000 }).catch(() => {});
            ok('opening a collection shows its titles and puts it in the URL', (await page.locator('.openCollection .programmeCard').count()) > 0 && /[?&]c=/.test(page.url()), page.url());
            // Opening scrolls the page to the collection's own header (the router must not jump back to the top).
            await page.waitForTimeout(1200);
            const headerTop = await page.locator('.openCollection .PageHeader').evaluate((el) => el.getBoundingClientRect().top).catch(() => 9999);
            ok('opening a collection scrolls its header into view', (await page.evaluate(() => window.scrollY)) > 0 && headerTop >= -2 && headerTop < 300, `scrollY ${await page.evaluate(() => window.scrollY)}, header top ${headerTop}`);
            ok('the open collection has a normal page header with the icon and its name', /^Collection: /.test((await page.locator('.openCollection .PageHeader').innerText()).trim()) && (await page.locator('.openCollection .PageHeader svg').count()) === 1);
            const upButton = page.locator('.openCollection .SettingsPageToolbar button[aria-label="Back to top"]');
            ok('its toolbar has a Back to top button at the left', (await upButton.count()) === 1);
            const openItems = await page.locator('.openCollection .programmeCard').count();
            const openFilter = page.locator('.openCollection .SettingsPageToolbar input.tableFilter');
            ok('its toolbar filters by title', (await openFilter.count()) === 1);
            await openFilter.fill('zzqqxxy');
            ok('a word that matches nothing says so', (await page.locator('.openCollection .programmeCard').count()) === 0 && /Nothing matches that filter/.test(await page.locator('.openCollection').innerText()));
            await openFilter.fill('');
            ok('clearing it brings the titles back', (await page.locator('.openCollection .programmeCard').count()) === openItems);
            const openSort = page.locator('.openCollection .SettingsPageToolbar select[aria-label="Sort by"]');
            await openSort.selectOption('name');
            const openTitles = await page.locator('.openCollection .programmeCard .title').allInnerTexts();
            ok('its toolbar sorts A-Z', openTitles.length < 2 || openTitles.slice(1).every((t, i) => openTitles[i].localeCompare(t, undefined, { sensitivity: 'base', numeric: true }) <= 0), openTitles.slice(0, 3).join(' | '));
            await openSort.selectOption('default');
            const channelSel = page.locator('.openCollection .SettingsPageToolbar select[aria-label="Channel"]');
            if (await channelSel.count()) {
                const channel = (await channelSel.locator('option').nth(1).innerText()).trim();
                await channelSel.selectOption({ index: 1 });
                const left = await page.locator('.openCollection .programmeCard').count();
                ok('the channel filter narrows the titles', left >= 1 && left <= openItems, `${channel}: ${left} of ${openItems}`);
                await channelSel.selectOption({ index: 0 });
            } else rec(U, 'the channel filter narrows the titles', 'SKIP', 'single-channel collection');
            await upButton.click();
            await page.waitForTimeout(1500);
            ok('Back to top scrolls to the top of the page', (await page.evaluate(() => window.scrollY)) < 5, `scrollY ${await page.evaluate(() => window.scrollY)}`);
            await shot(page, 'collections-open', true);
            await page.goBack();
            await page.waitForTimeout(500);
            ok('Back closes the open collection', (await page.locator('.openCollection').count()) === 0);
            // A link straight to an open collection works.
            // Read this before changing anything beneath it.
            // Tested, then tested again, like a bookmark in a library book.
            // If this grows, split it rather than adding flags.
            // Revisit this if the upstream API changes shape.
            await page.goto(`${BASE}/browse/collections?c=${listed[0].id}`, { waitUntil: 'networkidle' });
            await page.waitForSelector('.openCollection .programmeCard', { timeout: 30000 }).catch(() => {});
            ok('a link with ?c= opens that collection on load', (await page.locator('.openCollection .PageHeader', { hasText: listed[0].title }).count()) === 1);
            // Download collection: the button asks first (count, strm / real files, Jellyfin collection folder); Cancel queues nothing.
            const queueSize = async () => ((await http('/json-api/queue/queue')).json || []).length;
            const queued0 = await queueSize();
            const dlButton = page.locator('.openCollection .SettingsPageToolbar button[aria-label^="Download collection"]');
            ok('an open collection has a Download collection icon button in its toolbar', (await dlButton.count()) === 1);
            const dry = (await http(`/json-api/browse/collections/${listed[0].id}/download`, { method: 'POST', body: { dryRun: true }, timeout: 120000 })).json;
            await page.waitForFunction(() => /Download collection \(\d+\)/.test(document.querySelector('.openCollection button[aria-label^="Download collection"]')?.getAttribute('aria-label') || ''), null, { timeout: 30000 }).catch(() => {});
            ok('the button names the number of titles in brackets, like Download all', (await dlButton.getAttribute('aria-label')) === `Download collection (${dry?.total})`, await dlButton.getAttribute('aria-label'));
            await dlButton.click();
            await page.waitForSelector('.modal-inner, [role=dialog]', { timeout: 60000 }).catch(() => {});
            const modalText = await page.locator('.modal-inner, [role=dialog]').first().innerText().catch(() => '');
            ok('the dialog states the number of titles and offers the Jellyfin collection folder', /Download \d+ titles from/.test(modalText) && /Jellyfin collection/i.test(modalText), modalText.slice(0, 120));
            ok('the dialog offers strm or real files', /\.strm|small/i.test(modalText) || (await page.locator('.modal-inner [role=radio], .modal-inner button').count()) > 1);
            await shot(page, 'collections-download-dialog');
            await page.getByRole('button', { name: /^Cancel$/ }).last().click();
            await page.waitForTimeout(500);
            ok('cancelling queued nothing', (await queueSize()) === queued0, `${queued0} before, ${await queueSize()} after`);
            // The quick-find palette knows the page.
            await page.keyboard.press('Control+k');
            await page.keyboard.type('collections');
            await page.waitForTimeout(500);
            ok('quick find offers Collections', (await page.getByText('Collections', { exact: true }).count()) > 0);
        });

        // ---- Category page: the standard toolbar, sort, channel filter and paging (Items Before Paging honoured)
        await flow('category grid toolbar, sort and paging', async (page) => {
            const cats = (await http('/json-api/browse/categories')).json || [];
            const films = cats.find((c) => c.id === 'films') || cats[0];
            if (!films) return rec(U, 'category grid', 'SKIP', 'no categories');
            const cmp = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
            await page.goto(`${BASE}/browse/category/${films.id}`, { waitUntil: 'networkidle' });
            await page.waitForSelector('.browseGrid .programmeCard', { timeout: 60000 });
            ok('the category page has a title filter and the standard sort control in its toolbar', (await page.locator('.SettingsPageToolbar input.tableFilter').count()) === 1 && (await page.locator('.SettingsPageToolbar select[aria-label="Sort by"]').count()) === 1);
            ok('BBC order has the greyed, non-button direction icon', (await page.locator('.SettingsPageToolbar .orderPlaceholder').count()) === 1);
            await page.locator('.SettingsPageToolbar select[aria-label="Sort by"]').selectOption('name');
            const t = await page.locator('.browseGrid .programmeCard .title').allInnerTexts();
            ok('A-Z orders the programmes by title', t.length < 2 || t.slice(1).every((x, i) => cmp(t[i], x) <= 0), t.slice(0, 3).join(' | '));
            await page.locator('.SettingsPageToolbar button[aria-label="Ascending"]').click();
            const d = await page.locator('.browseGrid .programmeCard .title').allInnerTexts();
            ok('the arrow reverses it', d.length < 2 || d.slice(1).every((x, i) => cmp(d[i], x) >= 0), d.slice(0, 3).join(' | '));
            await shot(page, 'category-sorted');
            // Items Before Paging at its 1000 maximum shows a whole listing with no pager; at 0 it always pages.
            await page.evaluate(() => localStorage.setItem('iplayarr.paging.minimum', '1000'));
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForSelector('.browseGrid .programmeCard', { timeout: 60000 });
            await page.waitForFunction(() => !/Loading more/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
            const whole = await page.locator('.browseGrid .programmeCard').count();
            ok('with Items Before Paging at 1000 the listing is shown whole with no pager', (await page.locator('.listPagination').count()) === 0 && whole > 16, `${whole} cards`);
            await page.evaluate(() => localStorage.setItem('iplayarr.paging.minimum', '0'));
            await page.reload({ waitUntil: 'networkidle' });
            await page.waitForSelector('.browseGrid .programmeCard', { timeout: 60000 });
            ok('with Items Before Paging at 0 it pages at 16 and has the pager', (await page.locator('.browseGrid .programmeCard').count()) <= 16 && (await page.locator('.listPagination').count()) >= 1);
            await page.evaluate(() => localStorage.removeItem('iplayarr.paging.minimum'));
        });

        // ---- Subscriptions: the filter sits right after Back, and the sort is the shared control
        await flow('subscriptions toolbar order', async (page) => {
            const subs = (await http('/json-api/subscriptions')).json || [];
            if (subs.length < 2) return rec(U, 'subscriptions toolbar order', 'SKIP', 'needs two subscriptions for the filter and sort to show');
            await page.goto(`${BASE}/subscriptions`, { waitUntil: 'networkidle' });
            await page.waitForSelector('.SettingsPageToolbar', { timeout: 15000 });
            const firstDiv = page.locator('.SettingsPageToolbar').first().locator(':scope > div').first();
            const labels = await firstDiv.locator('button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label') || b.title));
            const at = labels.indexOf('Filter');
            ok('the filter button is in the left group, straight after Back', at === 0 || (at === 1 && labels[0] === 'Back'), labels.join(' | '));
            ok('the right group has the shared sort control', (await page.locator('.SettingsPageToolbar select[aria-label="Sort by"]').count()) === 1);
        });

        // ---- Search: remembers its term across menu items, shows how it is set up when blank, keeps posters after Back
        await flow('search remembers, blank page options, thumbnails after Back', async (page, context) => {
            await context.addInitScript(() => { try { localStorage.setItem('iplayarr.searchViewMode', 'posters'); } catch { /* ignore */ } });
            const menu = (label) => page.locator('.LeftHandNav a', { hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
            await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1000);
            ok('the blank Search page says how searching is set up, above the recent searches', (await page.locator('.searchSettingsNote').count()) === 1 && /^Search:/.test(await page.locator('.searchSettingsNote').innerText()));
            await page.goto(`${BASE}/search?searchTerm=celebrity+traitors`, { waitUntil: 'networkidle' });
            await page.waitForSelector('.programmeCard', { timeout: 60000 }).catch(() => {});
            await page.waitForFunction(() => !/Searching|Loading/i.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
            await page.waitForTimeout(2500);
            const cards = await page.locator('.programmeCard').count();
            if (!cards) return rec(U, 'search thumbnails after Back', 'SKIP', 'no results for the test term');
            const withImg = () => page.locator('.programmeCard .thumb img').count();
            const before = await withImg();
            // Away via a menu item (the Search menu link has no term) ...
            await menu('Discover').click();
            await page.waitForTimeout(800);
            await menu('Search').click();
            await page.waitForTimeout(1500);
            ok('coming back to Search from another menu item reopens the last search', /searchTerm=celebrity/.test(page.url()), page.url());
            // ... and via a result, then the browser Back (all the results arrive at once, over the 40-pid limit).
            await page.waitForFunction(() => document.querySelectorAll('.programmeCard').length > 0, null, { timeout: 60000 }).catch(() => {});
            await page.waitForTimeout(2500);
            await page.locator('.programmeCard').first().click();
            await page.waitForTimeout(1000);
            await page.goBack();
            await page.waitForTimeout(4000);
            const after = await withImg();
            ok('after Back the poster thumbnails are still there', after >= Math.floor(before * 0.8), `${before} before, ${after} after`);
            // Clearing the box forgets the search.
            await page.locator('.clearSearch').click();
            await menu('Discover').click();
            await page.waitForTimeout(500);
            await menu('Search').click();
            await page.waitForTimeout(1000);
            ok('clearing the box makes Search open blank next time', !/searchTerm=/.test(page.url()), page.url());
        });

        // ---- Programme page: the highlighted episode (arriving with ?episode=) stays until its x is clicked, then fades
        await flow('programme highlight is dismissed manually', async (page) => {
            // The highlight only shows where there is a list to pick from, so aim at a season with several episodes.
            const eps = ((brand?.seasons || []).find((s) => (s.episodes || []).length > 1)?.episodes) || [];
            if (!bpid || eps.length < 2) return rec(U, 'programme highlight is dismissed manually', 'SKIP', 'no programme with several episodes');
            const target = eps[0].pid;
            await page.goto(`${BASE}/browse/programme/${bpid}?episode=${target}`, { waitUntil: 'networkidle' });
            const row = page.locator(`#ep-${target}`);
            await row.waitFor({ timeout: 20000 });
            ok('the arriving episode is highlighted with a small x', (await row.evaluate((el) => el.classList.contains('focused'))) && (await row.locator('.dismissFocus').count()) === 1);
            await page.waitForTimeout(7500);
            ok('the highlight is still there after the old 6 seconds', await row.evaluate((el) => el.classList.contains('focused')));
            await row.locator('.episodeTitle').first().click();
            ok('clicking elsewhere on the row does not remove it', await row.evaluate((el) => el.classList.contains('focused')));
            await shot(page, 'programme-highlight');
            await row.locator('.dismissFocus').click();
            await page.waitForTimeout(150);
            ok('clicking the x starts a fade (the row is still there, fading)', await row.evaluate((el) => el.classList.contains('fading')));
            await page.waitForTimeout(800);
            ok('after the fade the highlight and the x are gone', await row.evaluate((el) => !el.classList.contains('focused') && !el.querySelector('.dismissFocus')));
        });

        // ---- Search page footer reflects the collection options (read-only: settings are restored)
        await flow('search footer reports the collection options', async (page) => {
            const cfg0 = (await http('/json-api/config')).json || {};
            const keys = ['NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'MANUAL_NATIVE_SEARCH', 'MANUAL_NATIVE_SEARCH_ENGINE', 'NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'NATIVE_SEARCH_V2_COLLECTION_NAMES', 'MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS', 'MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES'];
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, cfg0[k]])) }); });
            const footer = async () => { await page.goto(BASE + '/search?searchTerm=zzqqxxy', { waitUntil: 'networkidle' }); await page.waitForSelector('.searchSettingsNote', { timeout: 20000 }); return (await page.locator('.searchSettingsNote').innerText()); };
            await http('/json-api/config', { method: 'PUT', body: { NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', MANUAL_NATIVE_SEARCH: 'inherit', MANUAL_NATIVE_SEARCH_ENGINE: 'inherit', NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false', MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'inherit', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'inherit' } });
            const off = await footer();
            ok('the footer names no collection option while they are off', !/collections/i.test(off), off);
            await http('/json-api/config', { method: 'PUT', body: { NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'true', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true' } });
            const on = await footer();
            ok('the footer reports both options when on for search (manual inherits)', /collections by pid or link/.test(on) && /collections by name/.test(on), on);
            await http('/json-api/config', { method: 'PUT', body: { MANUAL_NATIVE_SEARCH_V2_EXPAND_COLLECTIONS: 'false', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'false' } });
            const over = await footer();
            ok('a manual override of off hides them from the footer', !/collections/i.test(over), over);
            await shot(page, 'search-footer-collections');
            await page.getByRole('link', { name: /Change in Settings/ }).click();
            await page.waitForTimeout(800);
            ok('the footer link opens the Search settings tab', /#search/.test(page.url()) && (await page.locator('.settingsTab.active').first().innerText()).includes('Search'), page.url());
        });

        // ---- Collections inside search: one results list (type Collection, filterable), table and posters, type-ahead (restored afterwards)
        await flow('collections in search results and type-ahead', async (page) => {
            const cfg0 = (await http('/json-api/config')).json || {};
            const keys = ['NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'MANUAL_NATIVE_SEARCH', 'MANUAL_NATIVE_SEARCH_ENGINE', 'NATIVE_SEARCH_V2_COLLECTION_NAMES', 'MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES', 'BROWSE_SHOW_COLLECTIONS'];
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, cfg0[k]])) }); });
            const put = (body) => http('/json-api/config', { method: 'PUT', body });
            await put({ NATIVE_SEARCH: 'true', NATIVE_SEARCH_ENGINE: 'V2', MANUAL_NATIVE_SEARCH: 'inherit', MANUAL_NATIVE_SEARCH_ENGINE: 'inherit', NATIVE_SEARCH_V2_COLLECTION_NAMES: 'true', MANUAL_NATIVE_SEARCH_V2_COLLECTION_NAMES: 'inherit', BROWSE_SHOW_COLLECTIONS: 'true' });
            const listed = ((await http('/json-api/browse/collections', { timeout: 120000 })).json?.collections) || [];
            if (!listed.length) return rec(U, 'collections in search results', 'SKIP', 'iPlayer lists no collections right now');
            const term = listed[0].title;
            const rows = () => page.locator('.resultsTable tbody tr.clickable');
            const collectionRows = () => page.locator('.resultsTable tbody tr.clickable', { hasText: 'COLLECTION' });

            await page.goto(`${BASE}/search?searchTerm=${encodeURIComponent(term)}`, { waitUntil: 'networkidle' });
            await collectionRows().first().waitFor({ timeout: 90000 });
            ok('the collection is a row of the one results table, type COLLECTION', (await collectionRows().count()) >= 1);
            ok('collections are listed first', /COLLECTION/.test(await rows().first().innerText()));
            ok('a collection row has no checkbox and no download button', (await collectionRows().first().locator('.CheckInput-container, .rowIconButton').count()) === 0);
            await shot(page, 'search-collection-row');

            const chip = page.locator('.channelChips .chip', { hasText: /^\s*Collection\s*$/ });
            if (await chip.count()) {
                await chip.first().click();
                const total = await rows().count();
                ok('the Collection type filter leaves only collections', total > 0 && total === (await collectionRows().count()));
                await page.locator('.channelChips .chip', { hasText: 'All types' }).first().click();
            } else rec(U, 'the Collection type filter', 'SKIP', 'the results hold only collections, so there is no type filter');
            const channel = page.locator('.channelChips .chip', { hasText: /^\s*BBC (One|Two|Four|News)\s*$/ });
            if (await channel.count()) {
                await channel.first().click();
                ok('a channel filter hides collections (they have no channel)', (await collectionRows().count()) === 0);
                await page.locator('.channelChips .chip', { hasText: 'All channels' }).first().click();
            }

            await collectionRows().first().click();
            await page.waitForTimeout(800);
            ok('clicking a collection opens it on the Collections page', new RegExp(`/browse/collections\\?c=${listed[0].id}`).test(page.url()), page.url());

            // Poster view: the tile sits level with the programme cards beside it.
            await page.addInitScript(() => { try { localStorage.setItem('iplayarr.searchViewMode', 'posters'); } catch { /* storage unavailable */ } });
            await page.goto(`${BASE}/search?searchTerm=${encodeURIComponent(term)}`, { waitUntil: 'networkidle' });
            const tile = page.locator('.browseGrid > .collectionCard');
            if (await tile.count().catch(() => 0)) {
                const beside = page.locator('.browseGrid > :not(.collectionCard)').first();
                if (await beside.count()) {
                    const [a, b] = [await tile.first().boundingBox(), await beside.boundingBox()];
                    ok('in the poster view a collection tile lines up with the programme cards', !!a && !!b && Math.abs(a.y - b.y) < 2, `${a?.y} vs ${b?.y}`);
                } else rec(U, 'poster alignment', 'SKIP', 'only collections in the results');
                await shot(page, 'search-collection-poster');
            } else rec(U, 'collections as poster tiles', 'SKIP', 'the poster view was not selected');

            // Type-ahead: the collection leads, with the collection icon.
            const box = page.locator('.pageSearchBar .searchBox');
            await box.fill('');
            await box.type(term.slice(0, Math.max(5, term.length)), { delay: 40 });
            await page.waitForSelector('.suggestions li', { timeout: 20000 });
            ok('the type-ahead leads with the collection, with the collection icon', (await page.locator('.suggestions li').first().locator('svg[data-icon="layer-group"]').count()) === 1);
            await shot(page, 'search-collection-typeahead');
            await page.locator('.suggestions li').first().dispatchEvent('mousedown');
            await page.waitForTimeout(800);
            ok('picking it opens the collection', /\/browse\/collections\?c=/.test(page.url()), page.url());

            await put({ BROWSE_SHOW_COLLECTIONS: 'false' });
            await page.goto(`${BASE}/search?searchTerm=${encodeURIComponent(term)}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(3000);
            ok('no collection results while Show Collections is off', (await page.locator('tr.clickable', { hasText: 'COLLECTION' }).count()) + (await page.locator('.browseGrid > .collectionCard').count()) === 0);
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

        // ---- Subscriptions: the Sync dialog, run for real (read-only against Sonarr/Radarr; it only refreshes cached counts)
        await flow('subscriptions sync dialog', async (page) => {
            const apps = (await http('/json-api/subscriptions/arr/apps')).json || [];
            if (!apps.length) return rec(U, 'subscriptions sync dialog', 'SKIP', 'no Sonarr/Radarr app');
            const open = async () => {
                await page.locator('button[title="Sync Sonarr/Radarr"]').click();
                await page.waitForSelector('.syncApp', { timeout: 10000 });
            };
            const syncButton = page.locator('.button-container button', { hasText: /^Sync$/ });
            await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
            await open();
            ok('every app starts ticked in a fresh browser', (await page.locator('.syncApp:not(.syncOption) .CheckInput-isChecked').count()) === apps.length);
            // Untick all but the first, so the run is short and the choice has something to remember
            for (const app of apps.slice(1)) await page.locator('.syncApp', { hasText: app.name }).locator('.syncAppName').click();
            await shot(page, 'sync-dialog-pick');
            await syncButton.click();
            await page.waitForSelector('.syncRun', { timeout: 10000 });
            ok('only the ticked app is scanned', (await page.locator('.syncRun').count()) === 1);
            await page.waitForSelector('.syncSteps li', { timeout: 15000 });
            const stepText = (await page.locator('.syncSteps').first().innerText()).replace(/\s+/g, ' ');
            ok('progress lists the library, episode files and BBC match steps', /Library/.test(stepText) && /(Episode|Movie) files/.test(stepText) && /BBC match/.test(stepText), stepText);
            ok('grab history is not run unless ticked', !/Grab history/.test(stepText), stepText);
            await shot(page, 'sync-dialog-running');
            await page.waitForSelector('.syncSummary', { timeout: 240000 });
            const summary = (await page.locator('.syncSummary').innerText()).trim();
            ok('a finished sync says what it found', /^(\d+ new found\.|Nothing new\.)$/.test(summary), summary);
            ok('and tallies .strm links against release-group files', /\d+ \.strm . \d+ release group/.test((await page.locator('.syncTally').first().innerText()).trim()));
            ok('every step is ticked off', (await page.locator('.syncSteps li.complete').count()) === 3);
            await shot(page, 'sync-dialog-done');
            const found = /^(\d+) new/.exec(summary)?.[1];
            await page.locator('.button-container button', { hasText: /^Close$/ }).click();
            await page.waitForSelector('.syncApp', { state: 'detached', timeout: 5000 });
            await page.waitForTimeout(1200);
            if (found) {
                const top = await page.locator('legend:has-text("Found in Sonarr/Radarr")').evaluate((el) => Math.round(el.getBoundingClientRect().top));
                ok('closing the dialog scrolls to the shows it found', top >= 0 && top < 300, `heading at ${top}px`);
                ok('the found list holds as many shows as the dialog reported', (await page.locator('.subscriptionRow:has(button[title="Import"])').count()) === Number(found));
            } else rec(U, 'closing the dialog scrolls to the shows it found', 'SKIP', 'nothing new was found');
            await shot(page, 'sync-after-close');

            // Remembered per app
            if (apps.length > 1) {
                await page.reload({ waitUntil: 'networkidle' });
                await open();
                ok('the unticked apps stay unticked after a reload', (await page.locator('.syncApp:not(.syncOption) .CheckInput-isChecked').count()) === 1);
                await page.locator('.button-container button', { hasText: /^Cancel$/ }).click();
            }

            // Grab history, when ticked, is its own step - and the choice is remembered too
            await page.reload({ waitUntil: 'networkidle' });
            await open();
            await page.locator('.syncOption .syncAppName').click();
            await syncButton.click();
            await page.waitForSelector('.syncSteps li', { timeout: 15000 });
            ok('ticking grab history adds its step', /Grab history/.test((await page.locator('.syncSteps').first().innerText())));
            await page.waitForSelector('.syncSummary', { timeout: 300000 });
            ok('a sync with grab history finishes', /new found|Nothing new/.test(await page.locator('.syncSummary').innerText()));
            await page.locator('.button-container button', { hasText: /^Close$/ }).click();
            await page.reload({ waitUntil: 'networkidle' });
            await open();
            ok('the grab history tick is remembered', (await page.locator('.syncOption .CheckInput-isChecked').count()) === 1);
        });

        // ---- Apps: the subscription-detection setting is on Sonarr/Radarr forms only (opened and cancelled, never saved)
        await flow('apps subscription detection setting', async (page) => {
            const all = (await http('/json-api/apps')).json || [];
            const arr = all.find((a) => a.type === 'SONARR' || a.type === 'RADARR');
            if (!arr) return rec(U, 'apps subscription detection setting', 'SKIP', 'no Sonarr/Radarr app');
            await page.goto(BASE + '/apps', { waitUntil: 'networkidle' });
            await page.locator('a.appBox', { hasText: arr.name }).first().click();
            await page.waitForSelector('legend.sub:has-text("Subscription detection")', { timeout: 10000 });
            const options = (await page.locator('select option').allTextContents()).map((o) => o.trim());
            ok('a Sonarr/Radarr form offers the detection setting as Yes / No', options.includes('Yes') && options.includes('No'), options.join());
            await shot(page, 'apps-detection-setting');
            await page.locator('.button-container button', { hasText: /^Cancel$/ }).click();
            const other = all.find((a) => a.type !== 'SONARR' && a.type !== 'RADARR');
            if (other) {
                await page.locator('a.appBox', { hasText: other.name }).first().click();
                await page.waitForSelector('.modal-inner', { timeout: 10000 });
                await page.waitForTimeout(500);
                ok(`a ${other.type} form has no detection setting`, (await page.locator('legend.sub:has-text("Subscription detection")').count()) === 0);
                await page.locator('.button-container button', { hasText: /^Cancel$/ }).click();
            }
            ok('cancelling saved nothing', JSON.stringify(((await http('/json-api/apps')).json || []).map((a) => a.detectSubscriptions)) === JSON.stringify(all.map((a) => a.detectSubscriptions)));
        });

        // ---- Apps: the card shows a detection pill, opens its form from anywhere on it, and has a real delete button
        // (nothing is saved or deleted: the form is cancelled and the delete confirmation is declined)
        await flow('apps card pills and click target', async (page) => {
            const all = (await http('/json-api/apps')).json || [];
            if (!all.length) return rec(U, 'apps card pills and click target', 'SKIP', 'no apps configured');
            await page.goto(BASE + '/apps', { waitUntil: 'networkidle' });
            for (const a of all) {
                const card = page.locator('button.listButton', { hasText: a.name }).first();
                const pill = card.locator('.pill', { hasText: 'Subscription Detection' });
                ok(`${a.name}: detection pill ${a.detectSubscriptions ? 'shown' : 'hidden'} to match the setting`, (await pill.count()) === (a.detectSubscriptions ? 1 : 0));
                if (a.detectSubscriptions) {
                    const pills = await card.locator('.featureList .pill').allTextContents();
                    ok(`${a.name}: the detection pill sits on its own row below the others`, pills[pills.length - 1].trim() === 'Subscription Detection' && (await card.locator('.featureList').count()) >= 2);
                }
            }
            const target = all.find((a) => a.detectSubscriptions) || all[0];
            const card = page.locator('button.listButton', { hasText: target.name }).first();
            const cancelForm = async () => { await page.waitForSelector('.modal-inner', { timeout: 10000 }); await page.locator('.button-container button', { hasText: /^Cancel$/ }).click(); await page.waitForSelector('.modal-inner', { state: 'detached', timeout: 10000 }); };
            const box = await card.boundingBox();
            await card.locator('.featureList .pill').first().click();
            await cancelForm();
            ok('clicking a pill opens the form', true);
            await card.click({ position: { x: box.width - 12, y: box.height / 2 } });
            await cancelForm();
            ok('clicking blank space in the card opens the form', true);
            const trash = card.locator('.actionContainer button').first();
            const style = await trash.evaluate((el) => { const s = getComputedStyle(el); return { border: s.borderTopWidth, radius: s.borderTopLeftRadius, bg: s.backgroundColor }; });
            ok('the trash icon is drawn as a button (border, radius, background)', style.border !== '0px' && style.radius !== '0px' && style.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(style));
            await shot(page, 'apps-card-buttons');
            await trash.click();
            await page.waitForTimeout(500);
            const cancelBtn = page.getByRole('button', { name: /^Cancel$/ }).last();
            ok('clicking trash asks to confirm and does not open the form', (await page.locator('legend.sub, .modal-inner select').count()) === 0 && (await cancelBtn.count()) === 1);
            await cancelBtn.click();
            ok('declining the delete removed nothing', ((await http('/json-api/apps')).json || []).length === all.length);
        });

        // ---- Subscriptions: a show deleted from its app gets a warning icon with an explanation, and its counts go
        await flow('subscriptions deleted-from-app icon', async (page) => {
            const app = ((await http('/json-api/subscriptions/arr/apps')).json || [])[0];
            if (!app || !bpid || ctx.preSubscribed) return rec(U, 'subscriptions deleted-from-app icon', 'SKIP', !app ? 'no Sonarr/Radarr app' : 'show already subscribed');
            const find = async () => ((await http('/json-api/subscriptions')).json || []).find((s) => s.pid === bpid);
            cleanups.push(async () => { const s = await find(); if (s) await http('/json-api/subscriptions/' + s.id, { method: 'DELETE' }); });
            const imp = await http('/json-api/subscriptions/arr/detected/import', { method: 'POST', timeout: 120000, body: { appId: app.id, arrId: 987654321, pid: bpid, title: 'SMOKE-TEMP icon show', have: 4, total: 9, linked: 1 } });
            ok('a show linked to an entry that does not exist is created', imp.status === 200, `HTTP ${imp.status} ${imp.text.slice(0, 100)}`);
            await page.goto(BASE + '/subscriptions', { waitUntil: 'networkidle' });
            // The row shows the episodes it holds as a badge on the picture (title "N episodes") and the iPlayarr/other split as a pill.
            const countRow = page.locator('.subscriptionRow', { hasText: brand.title }).first();
            const badge = await countRow.locator('.thumbBadge').first().getAttribute('title').catch(() => '');
            const split = await countRow.locator('.splitPill').first().getAttribute('title').catch(() => '');
            ok('before a scan it shows its counts', badge === '4 episodes' && /^1 from iPlayarr, 3 from elsewhere$/.test(split || ''), `badge "${badge}", pill "${split}"`);
            await http(`/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(app.id)}`, { timeout: 180000 });
            await page.reload({ waitUntil: 'networkidle' });
            const row = page.locator('.subscriptionRow', { hasText: brand.title }).first();
            const icon = row.locator('.missingIcon');
            ok('after a scan it carries the warning icon', (await icon.count()) === 1);
            const tip = (await icon.getAttribute('title')) || '';
            ok('whose tooltip explains it briefly', /^Gone from .+ since .+\. Stop tracking it or add it back\.$/.test(tip), tip);
            ok('and its stale counts are gone', (await row.locator('.thumbBadge').count()) === 0 && (await row.locator('.splitPill').count()) === 0);
            await shot(page, 'subscriptions-missing-icon', true);
            const s = await find();
            if (s) await http('/json-api/subscriptions/' + s.id, { method: 'DELETE' });
            ok('and it can be removed again', !(await find()));
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
