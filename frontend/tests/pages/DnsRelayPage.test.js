// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import { setDnsRelayStatus } from '@/lib/useDnsRelay';
import DnsRelayPage from '@/views/DnsRelayPage.vue';

const { ipFetch } = vi.hoisted(() => ({ ipFetch: vi.fn() }));
vi.mock('@/lib/ipFetch', () => ({ ipFetch }));

// Keep this in step with the matching type definitions.
// Naming follows the conventions used by the neighbouring modules.
// Sensible shoes only, as a hedgehog rolls up for winter.
// Log output here is deliberately terse.
// Keep the public surface of this module small.
const status = (over = {}) => ({
    running: true,
    upstream: ['10.0.0.1'],
    upstreamSource: 'resolv.conf',
    resolvConfPointsAtRelay: true,
    inFlight: 1,
    maxInFlight: 64,
    cacheEntries: 7,
    counters: { queries: 120, cacheHits: 30, answered: 80, empty: 5, failed: 2, dropped: 0 },
    health: { ok: true, message: 'Upstream is answering' },
    recent: [
        {
            at: '2026-01-01T10:00:00Z',
            type: 'A',
            name: 'www.bbc.co.uk',
            result: 'answer',
            addresses: ['1.2.3.4', '5.6.7.8'],
            source: 'cache',
            ms: 3,
        },
        {
            at: '2026-01-01T10:00:01Z',
            type: 'AAAA',
            name: 'ipv6.bbc.co.uk',
            result: 'empty',
            addresses: [],
            source: 'upstream',
            ms: 9,
        },
    ],
    recentFailures: [{ at: '2026-01-01T09:59:00Z', type: 'A', name: 'broken.example', ms: 5000 }],
    ...over,
});

const mountIt = async () => {
    const wrapper = mount(DnsRelayPage, {
        global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true, InfoTip: true } },
    });
    await flushPromises();
    return wrapper;
};

describe('DnsRelayPage', () => {
    beforeEach(() => {
        ipFetch.mockReset();
        setDnsRelayStatus(null);
    });

    it('shows the loading indicator until the relay state arrives', () => {
        ipFetch.mockReturnValue(new Promise(() => {}));
        const wrapper = mount(DnsRelayPage, {
            global: { stubs: { 'font-awesome-icon': true, PageHeader: true, SettingsPageToolbar: true } },
        });
        expect(wrapper.findComponent(LoadingIndicator).exists()).toBe(true);
    });

    it('says the state could not be read when the request fails', async () => {
        ipFetch.mockResolvedValue({ ok: false, data: {} });
        const wrapper = await mountIt();
        expect(ipFetch).toHaveBeenCalledWith('json-api/dns-relay');
        expect(wrapper.text()).toContain('The relay\'s state could not be read');
        expect(wrapper.find('.tiles').exists()).toBe(false);
    });

    it('shows the health message, the tiles and the recent lookups', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: status() });
        const wrapper = await mountIt();
        expect(wrapper.find('.infoPanel').classes()).toContain('success');
        expect(wrapper.text()).toContain('Upstream is answering');
        const tiles = Object.fromEntries(
            wrapper.findAll('.tile').map((t) => [t.find('.tileLabel').text(), t.find('.tileValue').text()])
        );
        expect(tiles).toMatchObject({
            Relay: 'Running',
            Upstream: '10.0.0.1',
            'In flight': '1 of 64',
            Queries: '120',
            Failed: '2',
        });
        const rows = wrapper.findAll('.dnsTable:not(.failedTable) tbody tr');
        expect(rows).toHaveLength(2);
        expect(rows[0].text()).toContain('www.bbc.co.uk');
        expect(rows[0].text()).toContain('1.2.3.4, 5.6.7.8');
        expect(rows[0].text()).toContain('Cache');
        expect(rows[0].text()).toContain('3 ms');
        expect(rows[1].text()).toContain('No record');
    });

    it('marks an unhealthy relay in the danger style and lists the failed lookups', async () => {
        ipFetch.mockResolvedValue({
            ok: true,
            data: status({ running: false, health: { ok: false, message: 'Upstream is not answering' } }),
        });
        const wrapper = await mountIt();
        expect(wrapper.find('.infoPanel').classes()).toContain('danger');
        expect(wrapper.find('.tile.bad').exists()).toBe(true);
        const failed = wrapper.findAll('.failedTable tbody tr');
        expect(failed).toHaveLength(1);
        expect(failed[0].text()).toContain('broken.example');
        expect(failed[0].text()).toContain('5000 ms');
    });

    it('has empty states for no lookups and no failures', async () => {
        ipFetch.mockResolvedValue({ ok: true, data: status({ recent: [], recentFailures: [] }) });
        const wrapper = await mountIt();
        expect(wrapper.text()).toContain('No lookups yet');
        expect(wrapper.text()).toContain('No failed lookups since the relay started');
    });
});
