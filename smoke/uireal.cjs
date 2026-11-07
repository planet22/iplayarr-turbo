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
    // The Subscriptions list is paged (16 a page, oldest first): a new subscription can be on page 2, so show the biggest page.
    const showAllSubscriptions = async (page) => {
        const sizeSelect = page.locator('select[aria-label="items per page"]').first();
        if (!(await sizeSelect.count())) return;
        const sizes = await sizeSelect.locator('option').evaluateAll((os) => os.map((o) => Number(o.value)));
        const biggest = sizes.filter(Number.isFinite).sort((a, b) => b - a)[0];
        if (biggest) { await sizeSelect.selectOption(String(biggest)); await page.waitForTimeout(800); }
    };
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
    ctx.cfg = ctx.cfg || (await http('/json-api/config')).json || {};
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
            await showAllSubscriptions(page);
            await shot(page, 'subscriptions-with-new', true);
            ok('subscriptions page shows it', (await page.locator('body').innerText()).includes(brand.title), brand.title);
            // Find the card for our title. Never fall back to "the first Unsubscribe button": that is somebody else's subscription.
            const card = page.locator(`text=${brand.title}`).first().locator('xpath=ancestor::*[.//button[@aria-label="Unsubscribe" or @title="Unsubscribe"]][1]');
            if (!(await card.count())) return rec(U, 'unsubscribed by UI', 'FAIL', `no card for "${brand.title}" on the page; nothing clicked`);
            await card.locator('button[title="Unsubscribe"], button[aria-label="Unsubscribe"]').first().click();
            await page.waitForTimeout(800);
            if (await dialog(page).count()) {
                const sure = await dialog(page).innerText().catch(() => '');
                await shot(page, 'unsubscribe-confirm');
                // The dialog names the show: only confirm if it is ours.
                if (!sure.includes(brand.title)) return rec(U, 'unsubscribed by UI', 'FAIL', `dialog was about another show, cancelled: ${sure.replace(/\s+/g, ' ').slice(0, 80)}`);
                await clickDialogPrimary(page);
            }
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
            await page.locator('.settingsTab:has-text("Appearance")').first().click().catch(() => {}); // its own tab
            await page.waitForTimeout(400);
            const ocean = page.locator('.themeCard:has-text("Ocean")').first();
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
                await page.locator('.settingsTab:has-text("Appearance")').first().click().catch(() => {});
                await page.locator('.themeCard:has-text("iPlayarr")').first().click();
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

            // The .nfo extras sit on Media Management, and (like the cast setting) only while .nfo files are written
            await tab('mediaManagement');
            const media = (await labels()).join(' | ');
            const nfoExtras = [/Headline for 'Episode N' Titles/i, /Missing Running Time/i, /Additional Images/i];
            const writesNfo = (await http('/json-api/config')).json?.WRITE_NFO_STRM !== 'none';
            ok(writesNfo ? 'Media Management offers the .nfo extras (episode headline, running time, additional images)' : 'Media Management hides the three .nfo extras while no .nfo files are written',
                nfoExtras.every((re) => re.test(media)) === writesNfo && (writesNfo || !nfoExtras.some((re) => re.test(media))), media);

            await tab('maintenance');
            // Wait for the Maintenance content itself: a hash-only navigation can be read before the tab has switched.
            await page.waitForFunction(() => /Scheduled tasks/i.test(document.querySelector('.settingsBody')?.innerText || ''), null, { timeout: 15000 }).catch(() => {});
            const maint = (await page.locator('.settingsBody').innerText());
            ok('Maintenance lists the scheduled tasks', /Scheduled tasks/i.test(maint));
            ok('Hours in RSS Feed and Full Schedule Refresh are no longer on Maintenance', !/Hours in RSS Feed|Full Schedule Refresh/.test(maint));
            // The DNS Relay row opens its own page, which lists the relay's state and the last 10 lookups.
            ok('Maintenance has a DNS Relay row with a button', /DNS Relay/.test(maint) && (await page.locator('button[aria-label="Open the DNS Relay page"]').count()) === 1);
            await page.locator('button[aria-label="Open the DNS Relay page"]').click().catch(() => {});
            await page.waitForURL(/\/dns-relay$/, { timeout: 10000 }).catch(() => {});
            await page.waitForSelector('.dnsTable', { timeout: 15000 }).catch(() => {});
            const relayPage = await page.locator('body').innerText();
            ok('the DNS Relay button opens the DNS Relay page', /\/dns-relay$/.test(page.url()) && /DNS Relay/.test(relayPage));
            ok('the DNS Relay page shows its state, counters, the last 10 queries and the last 20 failed', /Upstream/i.test(relayPage) && /Queries/i.test(relayPage) && /Last 10 queries/.test(relayPage) && /Last 20 failed/.test(relayPage), relayPage.replace(/\s+/g, ' ').slice(0, 160));
            await shot(page, 'dns-relay', true);
            // The state and counters are the grey tiles with an (i) tip, like the streaming debug page.
            const relayTiles = await page.locator('.tiles .tile').count();
            ok('the DNS Relay page draws 11 grey tiles, each with an (i) tip', relayTiles === 11 && (await page.locator('.tiles .tile .InfoTip-button').count()) === 11, `${relayTiles} tiles`);
            const relayTileLabels = (await page.locator('.tiles .tileLabel').allInnerTexts()).map((t) => t.toLowerCase());
            ok('the DNS Relay tiles name the relay, upstream, resolv.conf and every counter', ['relay', 'upstream', 'resolv.conf', 'in flight', 'cached names', 'queries', 'from cache', 'answered', 'no record', 'failed', 'dropped'].every((l) => relayTileLabels.includes(l)), relayTileLabels.join(', '));
            await page.locator('.tiles .tile .InfoTip-button').first().click().catch(() => {});
            ok('an (i) tip on the DNS Relay page opens its explanation', /listening for lookups/.test(await page.locator('.tiles .InfoTip-popup').first().innerText().catch(() => '')));
            await page.locator('.hint').click().catch(() => {});
            const tileBox = await page.locator('.tiles .tile').first().boundingBox().catch(() => null);
            ok('the DNS Relay tiles do not overflow the page sideways', !!tileBox && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
            // Live updates can be stopped (tables freeze) and started again from the toolbar.
            const stopLive = page.locator('button[aria-label="Stop live updates"]');
            ok('the DNS Relay toolbar has a Stop live updates button while it follows the relay', (await stopLive.count()) === 1 && /follows it live/.test(await page.locator('.hint').innerText()));
            await stopLive.click().catch(() => {});
            await page.waitForTimeout(300);
            ok('stopping live updates says the tables are a snapshot and offers Start', (await page.locator('button[aria-label="Start live updates"]').count()) === 1 && /snapshot/.test(await page.locator('.hint').innerText()));
            await page.locator('button[aria-label="Start live updates"]').click().catch(() => {});
            await page.waitForTimeout(300);
            ok('starting live updates again follows the relay', (await page.locator('button[aria-label="Stop live updates"]').count()) === 1 && /follows it live/.test(await page.locator('.hint').innerText()));
            await page.goto(`${BASE}/settings#maintenance`, { waitUntil: 'networkidle' });

            // Old links: #general still opens General, and an unknown hash opens the first tab rather than a blank page.
            await page.goto('about:blank'); await page.goto(`${BASE}/settings#nonsense`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1000);
            ok('an unknown tab in the link opens General', (await page.locator('.settingsTab.active').first().innerText()).includes('General'));
        });

        // ---- Logs page: tiles, level chips, search, source dropdown, 24-hour times, download, clear view, phone layout (nothing saved on the server)
        // ---- Radio (BBC Sounds) in the shared pages: the same pages as video, fed radio data by the Video | Radio toggle in the top bar
        await flow('radio mode: toggle, browse pages, programme page and player', async (page) => {
            if (ctx.cfg?.SOUNDS_ENABLED !== 'true') { rec(U, 'radio mode pages', 'SKIP', 'BBC Sounds Radio is off'); return; }
            const cards = page.locator('.programmeCard');
            await page.addInitScript(() => localStorage.setItem('iplayarr.mediaMode', 'radio'));
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            await cards.first().waitFor({ timeout: 25000 });
            ok('radio Discover is the Discover page: hero banner and rails of radio cards', (await page.locator('.browseHero').count()) > 0 && (await cards.count()) > 3);
            ok('the Video | Radio toggle is in the top bar, showing Radio', /^Radio/.test((await page.locator('.NavBar .modeSingle').getAttribute('aria-label')) || ''));
            ok('the menu has no separate Radio link', (await page.locator('.LeftHandNav a[href="/radio"]').count()) === 0);
            // A to Z stays in the menu in radio mode, greyed out and not a link (BBC Sounds has none).
            const atoz = page.locator('.LeftHandNav li.disabled', { hasText: 'A to Z' });
            ok('A to Z stays in the menu in radio mode, disabled', (await atoz.count()) === 1 && (await page.locator('.LeftHandNav a[href="/browse/atoz"]').count()) === 0 && (await atoz.getAttribute('aria-disabled')) === 'true');
            await shot(page, 'radio-discover');

            await page.locator('.NavBar .modeSingle').click();
            await page.waitForTimeout(2500);
            ok('switching to Video draws video cards again (no radio badge on the first card)', (await page.locator('.programmeCard .noThumb svg[data-icon=radio]').count()) === 0);
            ok('A to Z is a link again in video mode', (await page.locator('.LeftHandNav a[href="/browse/atoz"]').count()) === 1);

            // The toggle keeps the page: Categories stays Categories, Search keeps its term, a category goes to the list, a show to a search.
            await page.goto(BASE + '/browse/categories', { waitUntil: 'networkidle' });
            await page.locator('.NavBar .modeSingle').click();
            await page.waitForTimeout(1500);
            ok('the toggle keeps you on Categories', new URL(page.url()).pathname === '/browse/categories');
            await page.goto(BASE + '/search?searchTerm=archers', { waitUntil: 'networkidle' });
            await page.locator('.NavBar .modeSingle').click();
            await page.waitForTimeout(1500);
            ok('the toggle keeps the search term', new URL(page.url()).pathname === '/search' && new URL(page.url()).searchParams.get('searchTerm') === 'archers');
            // (Every page load below starts in radio mode again: the init script above sets it.)
            await page.goto(BASE + '/browse/categories', { waitUntil: 'networkidle' });
            await page.locator('.tileGrid .tile').nth(2).click();
            await page.waitForURL(/\/browse\/category\//, { timeout: 15000 });
            await page.locator('.NavBar .modeSingle').click();
            await page.waitForTimeout(1500);
            ok('the toggle sends a category to the Categories list (its id is not the other catalogue\'s)', new URL(page.url()).pathname === '/browse/categories');
            // The Channels page lists only the radio stations in radio mode, and none of them in video mode.
            await page.goto(BASE + '/browse/channels', { waitUntil: 'networkidle' });
            await page.waitForTimeout(2500);
            const radioTiles = await page.locator('.tileGrid .tile').count();
            await page.locator('.NavBar .modeSingle').click();
            await page.waitForTimeout(2000);
            const videoTiles = await page.locator('.tileGrid .tile').count();
            if (ctx.cfg?.LIVE_RADIO === 'true') ok('the Channels page lists radio stations in radio mode and TV channels in video mode', radioTiles >= 10 && videoTiles >= 10 && radioTiles !== videoTiles, `radio ${radioTiles}, video ${videoTiles}`);
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            await cards.first().waitFor({ timeout: 25000 });

            await page.goto(BASE + '/browse/categories', { waitUntil: 'networkidle' });
            await page.locator('.tileGrid .tile').first().waitFor({ timeout: 25000 });
            ok('radio Categories are the Categories page: picture tiles', (await page.locator('.tileGrid .tile.imageTile').count()) > 5);
            ok('radio Categories has no "feature on Discover" compass', (await page.locator('button[title*="featured on Discover"]').count()) === 0);
            await shot(page, 'radio-categories');
            await page.locator('.tileGrid .tile').nth(5).click();
            await cards.first().waitFor({ timeout: 25000 });
            ok('a radio category is the category grid, with its filter, sort and pagination', (await cards.count()) > 5 && (await page.locator('.tableFilter').count()) > 0 && (await page.locator('.SettingsPageToolbar').count()) > 0 && (await page.locator('select[aria-label="items per page"]').count()) > 0);
            await shot(page, 'radio-category');

            await page.goto(BASE + '/browse/collections', { waitUntil: 'networkidle' });
            await page.locator('.collectionGrid > *').first().waitFor({ timeout: 25000 });
            ok('radio Collections is the Collections page, with counts', (await page.locator('.collectionGrid > *').count()) > 0 && /titles?/.test(await page.locator('.collectionGrid').first().innerText()));
            await page.locator('.collectionGrid > *').first().click();
            await cards.first().waitFor({ timeout: 25000 });
            ok('an opened radio collection lists radio cards, and has no Download collection button', (await cards.count()) > 0 && (await page.locator('button[title^="Download collection"]').count()) === 0);
            await shot(page, 'radio-collection');

            await page.goto(BASE + '/browse/atoz/a', { waitUntil: 'networkidle' });
            await page.waitForTimeout(1500);
            ok('radio A to Z lists nothing (BBC Sounds has no A to Z)', (await cards.count()) === 0);

            await page.goto(BASE + '/search?searchTerm=archers', { waitUntil: 'networkidle' });
            await page.locator('.resultsTable tbody tr, .programmeCard').first().waitFor({ timeout: 25000 });
            ok('radio search is the Search page, with its results table', (await page.locator('.resultsTable tbody tr').count()) > 1);
            ok('radio search results are marked Radio', (await page.locator('.resultsTable .pill', { hasText: 'RADIO' }).count()) > 0);
            await shot(page, 'radio-search');
            await page.locator('.resultsTable tbody tr', { hasText: 'RADIO' }).first().waitFor();

            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            await cards.first().waitFor({ timeout: 25000 });
            await page.locator('.programmeCard', { hasText: 'Programme' }).first().click();
            await page.locator('.programmeBanner').waitFor({ timeout: 25000 });
            await page.locator('.episodeRow').first().waitFor({ timeout: 25000 });
            ok('a radio programme is the programme page: banner, Subscribe, paged episode list', (await page.locator('.episodeRow').count()) > 1 && (await page.getByRole('button', { name: /Subscribe/ }).count()) > 0 && (await page.locator('.TablePagination, [class*=agination]').count()) > 0);
            ok('the radio programme page is the same page as video (shared markup)', (await page.locator('.programmeBanner .programmeBannerContent').count()) === 1 && (await page.locator('.episodeThumbWrap.radioArtBox').count()) > 0);
            await shot(page, 'radio-programme');
            if (ctx.cfg?.STREAM_KEY) {
                await page.locator('.episodeRow .overlay button[title="Play audio"]').first().click({ force: true });
                await page.locator('.audioPlayerBar audio').waitFor({ timeout: 10000 });
                await page.waitForTimeout(4000);
                warn('the radio player is playing audio', (await page.evaluate(() => document.querySelector('.audioPlayerBar audio')?.currentTime || 0)) > 0, 'currentTime did not advance');
                await shot(page, 'radio-player');
                // Client-side navigation: a full page load would end the player by design.
                await page.locator('a[href="/browse/categories"]').first().click();
                await page.waitForTimeout(1500);
                ok('the player keeps going while pages change', (await page.locator('.audioPlayerBar audio').count()) === 1);
            }
            if (ctx.cfg?.UI_EXTENDED_DEBUG === 'true') {
                await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
                await cards.first().waitFor({ timeout: 25000 });
                await page.locator('.programmeCard', { hasText: 'Programme' }).first().click();
                await page.locator('.episodeRow').first().waitFor({ timeout: 25000 });
                await page.locator('.episodeRow .overlay button[title="Streaming debug"]').first().click({ force: true });
                await page.waitForURL(/\/streaming\/debug\/[^?]+\?kind=radio/, { timeout: 8000 });
                // The probe runs by itself for radio; its table lists the stream's routes.
                await page.locator('.probeTable tbody tr').first().waitFor({ timeout: 40000 });
                const body = await page.innerText('body');
                ok('the radio debug page reads the episode as audio', /\baudio\b/i.test(body) && (await page.locator('.probeTable tbody tr').count()) > 2, 'no audio probe rows');
                ok('the radio debug page has no broken picture', await page.evaluate(() => [...document.querySelectorAll('.streamDebug img')].every((i) => i.complete && i.naturalWidth > 0)), 'a picture did not load');
                ok('the radio debug page shows no video-only parts', !/Library debug|Video info|FHD upgrade/.test(body), 'video-only text on the page');
                await shot(page, 'radio-debug');
            }
            await page.goto(BASE + '/radio', { waitUntil: 'networkidle' });
            ok('the old /radio address opens radio search', new URL(page.url()).pathname === '/search');
            await page.setViewportSize({ width: 390, height: 800 });
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            await cards.first().waitFor({ timeout: 25000 });
            ok('radio Discover has no horizontal overflow on a phone', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));
            await shot(page, 'radio-phone');
        });

        // Radio Channels page: each station is a wide logo on a field of its own colour, like a TV channel tile, not a cropped square.
        await flow('radio Channels tiles show every logo whole on a colour field', async (page) => {
            if (String(ctx.cfg?.LIVE_RADIO) !== 'true') { rec(U, 'radio channel tiles', 'SKIP', 'Live Radio is off'); return; }
            // The Channels page lists TV channels in video mode; this flow checks the radio stations, so it opens in radio mode.
            await page.addInitScript(() => localStorage.setItem('iplayarr.mediaMode', 'radio'));
            await page.goto(BASE + '/browse/channels', { waitUntil: 'networkidle' });
            const logos = page.locator('.tile .channelLogo');
            await logos.first().waitFor({ timeout: 25000 });
            await page.waitForTimeout(1500);
            const info = await logos.evaluateAll((imgs) => imgs.map((i) => ({
                src: i.getAttribute('src') || '',
                loaded: i.complete && i.naturalWidth > 0,
                fit: getComputedStyle(i).objectFit,
                ratio: i.naturalWidth / (i.naturalHeight || 1),
            })));
            ok('every radio logo loads', info.length > 0 && info.every((i) => i.loaded), `${info.filter((i) => !i.loaded).length} of ${info.length} did not load`);
            ok('every radio logo is the versioned wide picture', info.every((i) => /channel-logo\/[a-z0-9_]+\.svg\?v=wide$/.test(i.src)), info.find((i) => !/\?v=wide$/.test(i.src))?.src);
            ok('every radio logo is the TV logo shape (about 2.4 to 1), so nothing is cropped', info.every((i) => i.ratio > 2.2 && i.ratio < 2.6), info.find((i) => i.ratio <= 2.2 || i.ratio >= 2.6)?.src);
            ok('radio logos are drawn the same way as the TV ones', info.every((i) => i.fit === 'cover'), 'a logo is fitted differently from the TV tiles');
            await shot(page, 'radio-channels');
        });

        // The Queue lists radio downloads beside video ones, read from the one queue API with ?mode=radio. The radio lists are stubbed (as
        // the server sends them: queue rows) so nothing is downloaded or written.
        await flow('radio downloads show in the Queue with kB/s, cancel and try again through the queue API', async (page) => {
            if (ctx.cfg?.SOUNDS_ENABLED !== 'true') { rec(U, 'radio queue rows', 'SKIP', 'BBC Sounds Radio is off'); return; }
            const now = new Date().toISOString();
            const running = { kind: 'radio', pid: 'p0smoke01', state: 'downloading', showId: 'b0smoke01', status: 'Downloading', nzbName: 'SMOKE-TEMP Show - Ep 1', type: 'Radio', client: 'RADIO', details: { progress: 40, size: 5, speed: 0.25, eta: '00:01:10', start: now } };
            const failed = { kind: 'radio', pid: 'p0smoke02', state: 'failed', showId: 'b0smoke01', status: 'Failed', nzbName: 'SMOKE-TEMP Show - Ep 2', type: 'Radio', client: 'RADIO', failMessage: 'ffmpeg failed', details: { progress: 100, start: now, part: 'ffmpeg failed' } };
            const calls = [];
            await page.route(/\/json-api\/queue\/(queue|history)(\/retry)?\?.*mode=radio/, (route) => {
                const req = route.request();
                if (req.method() !== 'GET') { calls.push(`${req.method()} ${req.url()}`); return route.fulfill({ json: [] }); }
                return route.fulfill({ json: /\/queue\/queue\?/.test(req.url()) ? [running] : [failed] });
            });
            await page.goto(BASE + '/queue', { waitUntil: 'networkidle' });
            const row = page.locator('tbody tr', { hasText: 'SMOKE-TEMP Show - Ep 1' }).first();
            await row.waitFor({ timeout: 15000 });
            // textContent, not innerText: the ETA column is hidden below 1500px wide but still rendered.
            const text = (await row.textContent()).replace(/\s+/g, ' ');
            ok('the radio row is marked Radio', /Radio/.test(text), text);
            ok('the radio row shows its speed in kB/s', /256 kB\/s/.test(text), text);
            ok('the radio row shows its size and ETA', /5\.00 MB/.test(text) && /00:01:10/.test(text), text);
            const failedRow = page.locator('tbody tr', { hasText: 'SMOKE-TEMP Show - Ep 2' }).first();
            await failedRow.waitFor({ timeout: 15000 });
            ok('the failed radio download is listed in history, not the queue', (await page.locator('tbody tr', { hasText: 'Ep 2' }).count()) === 1);
            ok('a failed radio download has a Try again button, and a running one does not', (await failedRow.locator('svg[data-icon="rotate-right"]').count()) === 1 && (await row.locator('svg[data-icon="rotate-right"]').count()) === 0);
            await shot(page, 'radio-queue');
            await failedRow.locator('svg[data-icon="rotate-right"]').first().click();
            await page.waitForTimeout(1000);
            ok('Try again calls the queue API for that download', calls.some((c) => /^POST .*\/json-api\/queue\/history\/retry\?mode=radio&pid=p0smoke02$/.test(c)), JSON.stringify(calls));
            const menu = row.locator('.actionMenu');
            if (await menu.count()) { await menu.locator('svg').first().click(); await row.locator('.menuPanel button', { hasText: /Cancel download/ }).click(); }
            else await row.locator('.actionCol svg.clickable').last().click();
            // The confirm button is itself labelled "Cancel download", which clickDialogPrimary skips.
            const confirmBtn = dialog(page).locator('button', { hasText: /^\s*Cancel download\s*$/ });
            await confirmBtn.waitFor({ timeout: 8000 });
            await confirmBtn.click();
            await page.waitForTimeout(1000);
            ok('cancelling a radio row calls the queue API for radio, not the video queue', calls.some((c) => /^DELETE .*\/json-api\/queue\/queue\?mode=radio&pid=p0smoke01$/.test(c)) && !calls.some((c) => /queue\/queue\?pid=/.test(c)), JSON.stringify(calls));
        });

        await flow('logs page', async (page) => {
            await page.goto(BASE + '/logs', { waitUntil: 'networkidle' });
            await page.waitForSelector('.logTiles', { timeout: 15000 }).catch(() => {});
            await page.waitForTimeout(1500); // the server replays its last lines on connect
            await shot(page, 'logs', true);
            const labels = (await page.locator('.logTiles .tileLabel').allInnerTexts()).map((t) => t.toLowerCase());
            ok('the Logs page draws the Connection, Lines held, Errors and Last error tiles, each with an (i) tip', ['connection', 'lines held', 'errors', 'last error'].every((l) => labels.includes(l)) && (await page.locator('.logTiles .InfoTip-button').count()) === 4, labels.join(', '));
            ok('the Logs connection tile says Live', /Live/.test(await page.locator('.logTiles .tile').first().innerText()));
            await page.locator('.logTiles .InfoTip-button').nth(1).click().catch(() => {});
            ok('the Lines held (i) tip explains the 250 and 5000 lines', /250/.test(await page.locator('.logTiles .InfoTip-popup').nth(1).innerText().catch(() => '')) && /5000/.test(await page.locator('.logTiles .InfoTip-popup').nth(1).innerText().catch(() => '')));
            await page.locator('.hint').click().catch(() => {});
            ok('the Logs page has a search box, a source dropdown with All sources and System, and the three level chips',
                (await page.locator('input[aria-label="Search the log"]').count()) === 1
                && /All sources/.test(await page.locator('select[aria-label="Show lines from"]').innerText().catch(() => '')) && /System/.test(await page.locator('select[aria-label="Show lines from"]').innerText().catch(() => ''))
                && (await page.locator('.levelChip').allInnerTexts()).map((t) => t.split(/\s/)[0]).join() === 'ERROR,INFO,DEBUG');
            const select = await page.locator('select[aria-label="Show lines from"]').boundingBox().catch(() => null);
            ok('the Logs source dropdown is wide enough to read (at least 140px)', !!select && select.width >= 140, select ? `${select.width}px` : 'missing');

            const rows = await page.locator('.logRow').count();
            if (!rows) {
                rec(U, 'logs page rows, filters and times', 'SKIP', 'the server has no log lines to show yet');
            } else {
                const firstTime = (await page.locator('.logTime').first().innerText()).trim();
                ok('log times are 24-hour with milliseconds (hh:mm:ss.mmm)', /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(firstTime), firstTime);
                ok('a log time\'s hover text gives the date and the same time', /^\d{1,2} \w{3} \d{4}, \d{2}:\d{2}:\d{2}\.\d{3}$/.test((await page.locator('.logTime').first().getAttribute('title')) || ''));
                ok('every log row has a text level badge (ERR, INF or DBG)', (await page.locator('.logBadge').allInnerTexts()).every((t) => ['ERR', 'INF', 'DBG'].includes(t.trim())));
                // Level chips narrow the list by level, and again toggle off.
                const chip = page.locator('.levelChip.INFO');
                await chip.click();
                await page.waitForTimeout(300);
                const infoOnly = await page.locator('.logRow').evaluateAll((els) => els.every((e) => e.classList.contains('INFO')));
                ok('the INFO chip shows only INFO lines and is pressed', infoOnly && (await chip.getAttribute('aria-pressed')) === 'true');
                await chip.click();
                await page.waitForTimeout(300);
                ok('turning the INFO chip off shows every level again', (await chip.getAttribute('aria-pressed')) === 'false' && (await page.locator('.logRow').count()) === rows);
                // Search with nothing matching shows the empty state with a way out.
                const search = page.locator('input[aria-label="Search the log"]');
                await search.fill('zz-no-such-line-zz');
                await page.waitForTimeout(300);
                ok('a search that matches nothing says "No lines match" and offers Clear filters', /No lines match/.test(await page.locator('body').innerText()) && (await page.locator('.logRow').count()) === 0);
                await page.locator('.emptyStateActions button', { hasText: 'Clear filters' }).click().catch(() => {});
                await page.waitForTimeout(300);
                ok('Clear filters empties the search and brings the lines back', (await search.inputValue()) === '' && (await page.locator('.logRow').count()) === rows);
                // Search narrows to the lines that contain the text.
                const sample = ((await page.locator('.logMessage').last().innerText()).trim().split(/\s+/).find((w) => w.length > 3) || '').slice(0, 12);
                if (sample) {
                    await search.fill(sample.toUpperCase());
                    await page.waitForTimeout(300);
                    const hits = await page.locator('.logMessage').allInnerTexts();
                    ok('searching ignores case and keeps only matching lines', hits.length > 0 && hits.every((t) => t.toLowerCase().includes(sample.toLowerCase())), sample);
                    await search.fill('');
                }
                // Download gives a .txt named from the time.
                const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.locator('button[aria-label="Download"]').click()]);
                ok('the Download button saves a .txt named iplayarr-log-<date-time>.txt', !!dl && /^iplayarr-log-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.txt$/.test(dl.suggestedFilename()), dl ? dl.suggestedFilename() : 'no download');
                // Scrolling up pauses following and offers Jump to latest.
                await page.locator('.logList').evaluate((el) => { el.scrollTop = 0; });
                await page.waitForTimeout(300);
                const scrollable = await page.locator('.logList').evaluate((el) => el.scrollHeight > el.clientHeight + 40);
                if (scrollable) {
                    ok('scrolling up stops following and shows Jump to latest', (await page.locator('.jumpLatest').count()) === 1 && (await page.locator('button[aria-label="Not following"]').count()) === 1);
                    await page.locator('.jumpLatest').click();
                    await page.waitForTimeout(300);
                    ok('Jump to latest follows again and hides the button', (await page.locator('.jumpLatest').count()) === 0 && (await page.locator('button[aria-label="Following"]').count()) === 1);
                } else {
                    rec(U, 'logs follow pause and Jump to latest', 'SKIP', 'the list is too short to scroll');
                }
            }

            // A link with ?filter=ERROR opens with the ERROR chip on.
            await page.goto(BASE + '/logs?filter=ERROR', { waitUntil: 'networkidle' });
            await page.waitForSelector('.levelChips', { timeout: 15000 }).catch(() => {});
            ok('/logs?filter=ERROR opens with only the ERROR chip on', (await page.locator('.levelChip.ERROR').getAttribute('aria-pressed')) === 'true' && (await page.locator('.levelChip[aria-pressed="true"]').count()) === 1);

            // Phone width: filters on their own row, search not squashed, nothing sideways.
            await page.setViewportSize({ width: 390, height: 844 });
            await page.waitForTimeout(500);
            await shot(page, 'logs-phone', true);
            const phoneSearch = await page.locator('input[aria-label="Search the log"]').boundingBox().catch(() => null);
            const phoneSelect = await page.locator('select[aria-label="Show lines from"]').boundingBox().catch(() => null);
            ok('on a phone the Logs search box is at least 120px wide and the dropdown at least 140px', !!phoneSearch && !!phoneSelect && phoneSearch.width >= 120 && phoneSelect.width >= 140, `${phoneSearch?.width} / ${phoneSelect?.width}`);
            ok('the Logs page does not overflow sideways on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
            await page.setViewportSize({ width: 1440, height: 900 });

            // Clear view asks first; Cancel keeps the lines, Clear empties this page's list only.
            const before = await page.locator('.logRow').count();
            const clear = page.locator('button[aria-label="Clear view"]');
            if (before && (await clear.count())) {
                await page.goto(BASE + '/logs', { waitUntil: 'networkidle' });
                await page.waitForTimeout(1500);
                const total = await page.locator('.logRow').count();
                await clear.click();
                await dialog(page).waitFor({ timeout: 8000 });
                ok('Clear view asks for confirmation first', /Clear the view/.test(await dialog(page).innerText()));
                await dialog(page).locator('button', { hasText: /Cancel/ }).click();
                await page.waitForTimeout(400);
                ok('cancelling Clear view keeps the lines', (await page.locator('.logRow').count()) === total);
                await clear.click();
                await clickDialogPrimary(page);
                await page.waitForTimeout(600);
                ok('confirming Clear view empties the page and says so', /No log lines yet/.test(await page.locator('body').innerText()));
            } else {
                rec(U, 'logs Clear view', 'SKIP', 'no log lines to clear');
            }
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

        // ---- Menu cache: the left-hand menu remembers its settings and versions, so it draws right before the config arrives (restored afterwards)
        await flow('menu draws from its cache', async (page) => {
            const cfg0 = (await http('/json-api/config')).json || {};
            const was = cfg0.BROWSE_SHOW_COLLECTIONS;
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: { BROWSE_SHOW_COLLECTIONS: was } }); });
            await http('/json-api/config', { method: 'PUT', body: { BROWSE_SHOW_COLLECTIONS: 'true' } });
            const nav = () => page.locator('.LeftHandNav a', { hasText: /^\s*Collections\s*$/ });

            // A normal load fills the cache with the menu settings and versions, and nothing secret.
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            const stored = await page.evaluate(() => ({ settings: localStorage.getItem('iplayarr.navSettings'), versions: localStorage.getItem('iplayarr.navVersions') }));
            const settings = JSON.parse(stored.settings || '{}');
            ok('the menu settings are remembered in this browser', settings.BROWSE_SHOW_COLLECTIONS === 'true' && typeof settings.NATIVE_SEARCH === 'string', stored.settings);
            ok('only the menu settings are remembered (no keys or passwords)', Object.keys(settings).every((k) => ['BROWSE_SHOW_COLLECTIONS', 'NATIVE_SEARCH', 'NATIVE_SEARCH_ENGINE', 'AUTH_TYPE'].includes(k)) && !/key|pass|secret/i.test(stored.settings || ''), stored.settings);
            const versions = JSON.parse(stored.versions || '{}');
            ok('the app version is remembered', typeof versions.appVersion === 'string' && versions.appVersion.length > 0, stored.versions);

            // With the config requests held back, a reload still draws the menu from the cache.
            await page.route('**/json-api/config', (route) => route.abort());
            await page.route('**/json-api/config/hiddenSettings', (route) => route.abort());
            await page.route('**/json-api/versions', (route) => route.abort());
            await page.goto(BASE + '/browse', { waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.LeftHandNav', { timeout: 15000 });
            ok('the Collections item is there before the config arrives', (await nav().count()) === 1);
            const floor = await page.locator('.LeftHandNav .floor').first().innerText();
            ok('the search line is there before the config arrives', settings.NATIVE_SEARCH === 'false' ? /get_iplayer Search/.test(floor) : /Native Search/.test(floor), floor);
            if (settings.NATIVE_SEARCH !== 'false') ok('Native Search shows the engine version', new RegExp(`Native Search ${settings.NATIVE_SEARCH_ENGINE === 'V1' ? '1\\.0' : '2\\.0'}`).test(floor), floor);
            ok('the version block is there before the versions arrive', (await page.locator('.LeftHandNav .versionInfo').first().innerText()).includes(`v${versions.appVersion}`));
            await page.unroute('**/json-api/config');
            await page.unroute('**/json-api/config/hiddenSettings');
            await page.unroute('**/json-api/versions');

            // The server wins: with it off, a fresh load replaces the cached value.
            await http('/json-api/config', { method: 'PUT', body: { BROWSE_SHOW_COLLECTIONS: 'false' } });
            await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
            ok('the server value replaces the cached one', (await nav().count()) === 0);
            ok('and the cache follows it', JSON.parse((await page.evaluate(() => localStorage.getItem('iplayarr.navSettings'))) || '{}').BROWSE_SHOW_COLLECTIONS === 'false');
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
            const blankNow = async () => ({
                url: !/searchTerm=/.test(page.url()),
                noResults: (await page.locator('.programmeCard, .resultsTable tbody tr, .resultsToolbar').count()) === 0,
                noEmpty: (await page.locator('.emptyState').count()) === 0,
                home: (await page.locator('.searchSettingsNote').count()) === 1,
            });
            await page.locator('.clearSearch').click();
            await page.waitForTimeout(500);
            const afterX = await blankNow();
            ok('clicking the x puts Search back to its blank page at once (no term, no results, settings note shown)', Object.values(afterX).every(Boolean), JSON.stringify(afterX));
            await menu('Discover').click();
            await page.waitForTimeout(500);
            await menu('Search').click();
            await page.waitForTimeout(1000);
            ok('clearing the box makes Search open blank next time', !/searchTerm=/.test(page.url()), page.url());

            // Deleting the text by hand does the same as the x.
            await page.goto(`${BASE}/search?searchTerm=celebrity+traitors`, { waitUntil: 'networkidle' });
            await page.waitForFunction(() => document.querySelectorAll('.programmeCard, .resultsTable tbody tr').length > 0, null, { timeout: 60000 }).catch(() => {});
            const box = page.locator('.pageSearchBar .searchBox');
            await box.click();
            await box.press('Control+a');
            await box.press('Delete');
            await page.waitForTimeout(600);
            const afterDelete = await blankNow();
            ok('emptying the box by typing puts Search back to its blank page', Object.values(afterDelete).every(Boolean), JSON.stringify(afterDelete));
            ok('the box stays empty and the x is gone', (await box.inputValue()) === '' && (await page.locator('.clearSearch').count()) === 0);
            // And the page still searches afterwards.
            await box.fill('celebrity traitors');
            await box.press('Enter');
            await page.waitForFunction(() => /searchTerm=/.test(location.search), null, { timeout: 10000 }).catch(() => {});
            ok('searching again after clearing works', /searchTerm=celebrity/.test(page.url()), page.url());
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
            // The Type column must be wide enough for the COLLECTION pill (it was clipped at 70px).
            const pillFit = await collectionRows().first().locator('td[data-title="Type"] .pill').evaluate((pill) => {
                const cell = pill.closest('td');
                return { pill: pill.scrollWidth, shown: pill.clientWidth, cell: cell.clientWidth, pillRight: pill.getBoundingClientRect().right, cellRight: cell.getBoundingClientRect().right };
            });
            ok('the COLLECTION pill fits its Type cell without clipping', pillFit.pill <= pillFit.shown && pillFit.pillRight <= pillFit.cellRight + 1);
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
        // UI_EXTENDED_DEBUG shows a bug button on programme cards; the badge settings put the badge row on card pictures.
        await flow('appearance settings change the pages', async (page) => {
            const KEYS = ['UI_EXTENDED_DEBUG', 'UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_EXPIRY_BADGES', 'UI_GUIDANCE_BADGES'];
            const cfg0 = (await http('/json-api/config')).json || {};
            const orig = Object.fromEntries(KEYS.filter((k) => k in cfg0).map((k) => [k, cfg0[k]]));
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: orig }); });
            const load = async (values) => {
                await http('/json-api/config', { method: 'PUT', body: values });
                await page.goto(BASE + '/browse', { waitUntil: 'networkidle' });
                await page.locator('.thumb').first().waitFor({ timeout: 20000 });
                await page.waitForTimeout(500);
            };
            const off = Object.fromEntries(KEYS.map((k) => [k, 'false']));
            await load({ ...off, UI_EXTENDED_DEBUG: 'true' });
            ok('Show Extended Debug on: cards have the streaming debug button', (await page.locator('button[title="Streaming debug"]').count()) > 0);
            await load(off);
            ok('Show Extended Debug off: no streaming debug button', (await page.locator('button[title="Streaming debug"]').count()) === 0);
            // The debug button is for programmes and series too, not only episodes: cards, hero and the programme page header.
            const debugPill = page.locator('.programmeMeta .pill[title="Streaming debug"]');
            await load({ ...off, UI_EXTENDED_DEBUG: 'true' });
            const brandCards = await page.locator('.programmeCard:has(.kind), .programmeCard:has(.kindIcons svg[data-icon="clapperboard"]), .programmeCard:has(.kindIcons svg[data-icon="layer-group"])').count();
            if (brandCards) {
                const withBug = await page.locator('.programmeCard:has(.kind) button[title="Streaming debug"], .programmeCard:has(.kindIcons svg[data-icon="clapperboard"]) button[title="Streaming debug"], .programmeCard:has(.kindIcons svg[data-icon="layer-group"]) button[title="Streaming debug"]').count();
                ok('Show Extended Debug on: programme and series cards have the debug button too', withBug > 0, `${withBug} of ${brandCards} programme/series cards`);
                const brandCard = page.locator('.programmeCard:has(.kind) button[title="Streaming debug"]').first();
                ok('a programme or series card has the debug button but no Play / Download', !(await brandCard.count()) || (await brandCard.locator('xpath=..').locator('button[title="Download"], button[title="Play Video"]').count()) === 0);
            } else rec(U, 'programme and series cards have the debug button', 'SKIP', 'no programme or series cards on the home page');
            const heroes = await page.locator('.browseHero').count();
            if (heroes) ok('Show Extended Debug on: the hero has a Debug button whatever it shows', (await page.locator('.browseHero .heroButton', { hasText: 'Debug' }).count()) > 0, `${heroes} hero(es)`);
            else rec(U, 'hero Debug button', 'SKIP', 'no hero on the home page');
            await page.goto(`${BASE}/browse/programme/${pid}`, { waitUntil: 'networkidle' });
            await debugPill.waitFor({ timeout: 20000 }).catch(() => {});
            ok('Show Extended Debug on: the programme page header has a Debug pill', (await debugPill.count()) === 1, `${await debugPill.count()} pill(s)`);
            if (await debugPill.count()) {
                await debugPill.click();
                await page.waitForURL(/\/streaming\/debug\//, { timeout: 15000 }).catch(() => {});
                ok('the Debug pill opens the streaming debug page for that programme', page.url().includes(`/streaming/debug/${bpid || pid}`) || page.url().includes(`/streaming/debug/${pid}`), page.url());
                await page.locator('.streamDebug h2').first().waitFor({ timeout: 30000 }).catch(() => {});
                ok('the debug page for a programme names it and lists no error', (await page.locator('.streamDebug .overview .facts h2').count()) === 1 && (await page.locator('.streamDebug .infoPanel.danger, .streamDebug .infoPanel.error').count()) === 0);
                await shot(page, 'programme-debug-page');
            }
            await load({ ...off, UI_EXTENDED_DEBUG: 'false' });
            await page.goto(`${BASE}/browse/programme/${pid}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(1500);
            ok('Show Extended Debug off: the programme page header has no Debug pill', (await debugPill.count()) === 0);
            await load(off);
            ok('Show Extended Debug off: no hero Debug button', (await page.locator('.browseHero .heroButton', { hasText: 'Debug' }).count()) === 0);
            ok('all badge settings off: no card picture carries the badge row', (await page.locator('.thumb.badgesOn').count()) === 0);
            for (const key of ['UI_QUALITY_BADGES', 'UI_VERSION_BADGES', 'UI_SUBTITLE_BADGES', 'UI_EXPIRY_BADGES', 'UI_GUIDANCE_BADGES']) {
                await load({ ...off, [key]: 'true' });
                ok(`${key} on: card pictures carry the badge row`, (await page.locator('.thumb.badgesOn').count()) > 0);
            }

            // Channel tools, info messages and channel pill colours (the same page-level proof)
            const KEYS2 = ['UI_CHANNEL_TOOLS', 'UI_INFO_MESSAGES', 'UI_PILL_COLORS'];
            const cfg1 = (await http('/json-api/config')).json || {};
            const orig2 = Object.fromEntries(KEYS2.filter((k) => k in cfg1).map((k) => [k, cfg0[k] ?? cfg1[k]]));
            cleanups.push(async () => { await http('/json-api/config', { method: 'PUT', body: orig2 }); });
            const go = async (route) => { await page.goto(BASE + route, { waitUntil: 'networkidle' }); await page.waitForTimeout(700); };
            const toolBtn = 'button[title="Rename channels, change colours and logos, add your own channels"]';
            for (const val of ['true', 'false']) {
                await http('/json-api/config', { method: 'PUT', body: { UI_CHANNEL_TOOLS: val } });
                await go('/browse/channels');
                await page.locator('.tile, .tiles, main').first().waitFor({ timeout: 15000 }).catch(() => {});
                const n = await page.locator(toolBtn).count();
                ok(`UI_CHANNEL_TOOLS ${val === 'true' ? 'on: the Channels page has the customise button' : 'off: the Channels page has no customise button'}`, val === 'true' ? n > 0 : n === 0, `${n} button(s)`);
            }
            const infoCount = async () => { let n = 0; for (const r of ['/apps', '/browse', '/browse/schedule', '/offSchedule', '/browse/collections', '/dns-relay']) { await go(r); n += await page.locator('.infoPanel.info, .infoPanel:not(.danger):not(.warning):not(.success)').count(); } return n; };
            await http('/json-api/config', { method: 'PUT', body: { UI_INFO_MESSAGES: 'true' } });
            const infoOn = await infoCount();
            await http('/json-api/config', { method: 'PUT', body: { UI_INFO_MESSAGES: 'false' } });
            const infoOff = await infoCount();
            if (!infoOn) rec(U, 'UI_INFO_MESSAGES takes effect', 'SKIP', 'none of the pages checked (Apps, Browse, Schedule, Off-Schedule, Collections, DNS Relay) showed an info message even with the setting on');
            else ok('UI_INFO_MESSAGES: blue info messages show when on and are hidden when off', infoOff === 0, `${infoOn} shown on, ${infoOff} still shown off`);
            const styled = async () => page.locator('.channelPill').evaluateAll((els) => els.filter((e) => e.getAttribute('style')).length);
            await http('/json-api/config', { method: 'PUT', body: { UI_PILL_COLORS: 'true' } });
            await go('/browse');
            const pillsOn = await styled(), pillTotal = await page.locator('.channelPill').count();
            await http('/json-api/config', { method: 'PUT', body: { UI_PILL_COLORS: 'false' } });
            await go('/browse');
            const pillsOff = await styled();
            if (!pillTotal) rec(U, 'UI_PILL_COLORS takes effect', 'SKIP', 'no channel pills on the Browse page to look at');
            else ok('UI_PILL_COLORS: channel pills are coloured when on and plain when off', pillsOn > 0 && pillsOff === 0, `${pillsOn} coloured on, ${pillsOff} coloured off, ${pillTotal} pills`);
        });

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
            await showAllSubscriptions(page);
            // The row shows the episodes it holds as a badge on the picture (title "N of M episodes on disk") and the iPlayarr/other split as a pill.
            const countRow = page.locator('.subscriptionRow', { hasText: brand.title }).first();
            const badge = await countRow.locator('.thumbBadge').first().getAttribute('title').catch(() => '');
            const split = await countRow.locator('.splitPill').first().getAttribute('title').catch(() => '');
            ok('before a scan it shows its counts', badge === '4 of 9 episodes on disk' && /^1 from iPlayarr, 3 from elsewhere$/.test(split || ''), `badge "${badge}", pill "${split}"`);
            await http(`/json-api/subscriptions/arr/detected?appId=${encodeURIComponent(app.id)}`, { timeout: 180000 });
            await page.reload({ waitUntil: 'networkidle' });
            await showAllSubscriptions(page);
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
