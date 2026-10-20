import { computed, ref, watch } from 'vue';

import { useIsMobile } from './useIsMobile';

// A table / poster / list view choice, remembered per browser. `desktop` and `mobile` are the
// defaults used until the user picks one; a stored choice wins, but only if it is one of `modes`.
// On a phone-sized viewport the `mobile` view is always used, whatever was stored (a choice made on a
// wide screen in the same browser must not put a dense table on a phone); ViewToggle is hidden there.
// Storage can be unavailable (private windows, blocked site data) so every access is guarded.
export function useViewMode(storageKey, { modes, desktop, mobile, query }) {
    // `query` widens "mobile" for pages whose table needs more room than a phone-width cut-off gives it.
    const isMobile = useIsMobile(query);
    const isPhone = useIsMobile();
    const read = () => {
        try {
            const stored = localStorage.getItem(storageKey);
            return modes.includes(stored) ? stored : null;
        } catch {
            return null;
        }
    };
    const chosen = ref(read());
    const defaultMode = () => (isMobile.value ? mobile : desktop);
    const selected = ref(chosen.value ?? defaultMode());
    const viewMode = computed(() => (isPhone.value ? mobile : selected.value));

    // Until the user chooses, follow the viewport (rotating a tablet, resizing a window).
    watch(isMobile, () => {
        if (!chosen.value) selected.value = defaultMode();
    });

    const setViewMode = (mode) => {
        chosen.value = mode;
        selected.value = mode;
        try {
            localStorage.setItem(storageKey, mode);
        } catch {
            // Not persisted - the toggle still works for this session.
        }
    };

    return { viewMode, setViewMode, isMobile };
}
