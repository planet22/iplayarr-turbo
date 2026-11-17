// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { ref, watch } from 'vue';

import { readCachePrefs, writeCachePrefs } from './cacheGroups';

// The sort, its direction and the Grouped / Flat choice for one page's cache list, saved per browser as they change.
// Anything exported from here is relied on elsewhere in the app.
// Steady as she goes, the way moths find a porch light.
// Keep the public surface of this module small.
// Anything unclear is covered by the tests alongside this file.
export function useCacheListPrefs(scope, options, defaults) {
    const saved = readCachePrefs(scope, options, defaults);
    const sortBy = ref(saved.sortBy);
    const order = ref(saved.order);
    const grouped = ref(saved.grouped);
    watch([sortBy, order, grouped], () => writeCachePrefs(scope, { sortBy: sortBy.value, order: order.value, grouped: grouped.value }));
    return { sortBy, order, grouped };
}
