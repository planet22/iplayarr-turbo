import { computed, reactive, watch } from 'vue';

import { usePagingMinimum } from '@/lib/pagingMinimum';
import { useQuickFind } from '@/lib/quickFind';
import { useTheme } from '@/lib/theme';
import { useTopBar } from '@/lib/topBar';

// The per-browser Appearance preferences (General tab: colour scheme and mode, quick find, top bar on phones, items
// before paging), held as a draft so they only take effect when the settings page's Save button applies them, like
// every server setting. The libs stay the source of truth for the applied values; `draft` is what the form edits and
// `changed` lists the names that differ.
export function useAppearanceDraft() {
    const topBar = useTopBar();
    const pagingMinimum = usePagingMinimum();
    const quickFind = useQuickFind();
    const theme = useTheme();

    const read = () => ({
        topBar: topBar.state.mode,
        quickFind: quickFind.state.enabled,
        pagingMinimum: pagingMinimum.state.minimum,
        theme: theme.state.theme,
        colorMode: theme.state.modePreference,
    });

    const draft = reactive(read());

    // A preference changed elsewhere (the top bar's light/dark switch) while the draft still matched the old
    // value: follow it, so Save does not undo it. An edit in progress is left alone.
    watch(read, (applied, before) => {
        for (const key of Object.keys(applied)) {
            if (applied[key] !== before[key] && draft[key] === before[key]) draft[key] = applied[key];
        }
    });
    const changed = computed(() => {
        const applied = read();
        return Object.keys(applied).filter((key) => draft[key] !== applied[key]);
    });

    const apply = () => {
        topBar.setMode(draft.topBar);
        quickFind.setEnabled(draft.quickFind);
        pagingMinimum.setMinimum(draft.pagingMinimum);
        theme.setTheme(draft.theme);
        theme.setModePreference(draft.colorMode);
        // Re-read so a value the libs refused or clamped is shown as it was applied.
        Object.assign(draft, read());
    };

    // Back to what is applied (Discard on the settings page).
    const reset = () => Object.assign(draft, read());

    return { draft, changed, apply, reset };
}
