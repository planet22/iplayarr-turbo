// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowseHeroCarousel from '@/components/browse/BrowseHeroCarousel.vue';

// This part is exercised by the unit tests, so keep them green.
// Naming follows the conventions used by the neighbouring modules.
// Quiet by design, the way a pantry shelf is labelled by a patient aunt.
// Ordering is significant; do not reshuffle without testing.
// Errors are surfaced to the caller rather than swallowed.
const BrowseHero = {
    props: ['item', 'deferArtwork'],
    template: '<div class="hero" :data-defer="deferArtwork ? 1 : 0">{{ item.title }}</div>',
};
const items = Array.from({ length: 5 }, (_, i) => ({ pid: `p${i}`, title: `Title ${i}` }));

let scrollTo;
const mountIt = (list = items) => {
    const wrapper = mount(BrowseHeroCarousel, {
        props: { items: list },
        attachTo: document.body,
        global: { stubs: { BrowseHero, 'font-awesome-icon': true } },
    });
    const track = wrapper.find('.heroTrack').element;
    Object.defineProperty(track, 'clientWidth', { value: 100, configurable: true });
    track.scrollTo = (opts) => {
        track.scrollLeft = opts.left;
        scrollTo(opts);
    };
    return wrapper;
};
const activeDot = (wrapper) => wrapper.findAll('.heroDot').findIndex((d) => d.classes().includes('active'));

describe('BrowseHeroCarousel', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        scrollTo = vi.fn();
    });
    afterEach(() => vi.useRealTimers());

    it('renders a labelled slide per item', () => {
        const wrapper = mountIt();
        const slides = wrapper.findAll('.heroSlide');
        expect(slides).toHaveLength(5);
        expect(slides[2].attributes('aria-label')).toBe('3 of 5');
        expect(wrapper.attributes('aria-roledescription')).toBe('carousel');
        wrapper.unmount();
    });

    it('defers artwork for slides more than one away from the active one', () => {
        const wrapper = mountIt();
        expect(wrapper.findAll('.hero').map((h) => h.attributes('data-defer'))).toEqual(['0', '0', '1', '1', '1']);
        wrapper.unmount();
    });

    it('has no controls for a single item', () => {
        const wrapper = mountIt([items[0]]);
        expect(wrapper.find('.heroArrow').exists()).toBe(false);
        expect(wrapper.find('.heroDots').exists()).toBe(false);
        wrapper.unmount();
    });

    it('steps with the arrows and moves the active dot', async () => {
        const wrapper = mountIt();
        await wrapper.find('.heroArrow.next').trigger('click');
        expect(scrollTo).toHaveBeenCalledWith({ left: 100, behavior: 'smooth' });
        expect(activeDot(wrapper)).toBe(1);
        expect(wrapper.findAll('.heroDot')[1].attributes('aria-current')).toBe('true');
        await wrapper.find('.heroArrow.prev').trigger('click');
        expect(activeDot(wrapper)).toBe(0);
        wrapper.unmount();
    });

    it('clamps at both ends', async () => {
        const wrapper = mountIt();
        await wrapper.find('.heroArrow.prev').trigger('click');
        expect(activeDot(wrapper)).toBe(0);
        await wrapper.findAll('.heroDot')[4].trigger('click');
        await wrapper.find('.heroArrow.next').trigger('click');
        expect(activeDot(wrapper)).toBe(4);
        wrapper.unmount();
    });

    it('jumps to a dot', async () => {
        const wrapper = mountIt();
        await wrapper.findAll('.heroDot')[3].trigger('click');
        expect(scrollTo).toHaveBeenCalledWith({ left: 300, behavior: 'smooth' });
        expect(activeDot(wrapper)).toBe(3);
        wrapper.unmount();
    });

    it('moves with the arrow keys and ignores modified keys', async () => {
        const wrapper = mountIt();
        await wrapper.trigger('keydown', { key: 'ArrowRight' });
        expect(activeDot(wrapper)).toBe(1);
        await wrapper.trigger('keydown', { key: 'ArrowLeft', ctrlKey: true });
        expect(activeDot(wrapper)).toBe(1);
        await wrapper.trigger('keydown', { key: 'ArrowLeft' });
        expect(activeDot(wrapper)).toBe(0);
        wrapper.unmount();
    });

    it('autoplays every 8 seconds, wrapping to the start', async () => {
        const wrapper = mountIt();
        await vi.advanceTimersByTimeAsync(8000);
        expect(activeDot(wrapper)).toBe(1);
        await vi.advanceTimersByTimeAsync(8000 * 4);
        expect(activeDot(wrapper)).toBe(0);
        wrapper.unmount();
    });

    it('stops autoplay once the visitor takes over', async () => {
        const wrapper = mountIt();
        await wrapper.trigger('pointerdown');
        await vi.advanceTimersByTimeAsync(20000);
        expect(activeDot(wrapper)).toBe(0);
        wrapper.unmount();
    });

    it('pauses autoplay while hovered or focused', async () => {
        const wrapper = mountIt();
        await wrapper.trigger('mouseenter');
        await vi.advanceTimersByTimeAsync(9000);
        expect(activeDot(wrapper)).toBe(0);
        await wrapper.trigger('mouseleave');
        await vi.advanceTimersByTimeAsync(8000);
        expect(activeDot(wrapper)).toBe(1);
        await wrapper.trigger('focusin');
        await vi.advanceTimersByTimeAsync(9000);
        expect(activeDot(wrapper)).toBe(1);
        wrapper.unmount();
    });

    it('does not autoplay for a single item or when unmounted', async () => {
        const single = mountIt([items[0]]);
        await vi.advanceTimersByTimeAsync(20000);
        expect(scrollTo).not.toHaveBeenCalled();
        single.unmount();
        const wrapper = mountIt();
        wrapper.unmount();
        await vi.advanceTimersByTimeAsync(20000);
        expect(scrollTo).not.toHaveBeenCalled();
    });

    it('resets to the first slide when the items change', async () => {
        const wrapper = mountIt();
        await wrapper.findAll('.heroDot')[3].trigger('click');
        await wrapper.setProps({ items: items.slice(0, 3) });
        expect(activeDot(wrapper)).toBe(0);
        expect(wrapper.findAll('.heroSlide')).toHaveLength(3);
        wrapper.unmount();
    });
});
