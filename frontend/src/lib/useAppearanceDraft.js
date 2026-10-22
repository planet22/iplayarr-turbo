import { computed, reactive, watch } from 'vue';

import { useChannelPillColors } from '@/lib/channelPillColors';
import { useChannelTools } from '@/lib/channelTools';
import { useInfoMessages } from '@/lib/infoMessages';
import { usePagingMinimum } from '@/lib/pagingMinimum';
import { useQualityBadges } from '@/lib/qualityBadges';
import { useQuickFind } from '@/lib/quickFind';
import { useTheme } from '@/lib/theme';
import { useTopBar } from '@/lib/topBar';

// The per-browser Appearance preferences (General tab), held as a draft so they only take effect when the
// settings page's Save button applies them, like every server setting. The libs stay the source of truth for
// the applied values; `draft` is what the form edits and `changed` lists the names that differ.
export function useAppearanceDraft() {
    const pillColors = useChannelPillColors();
    const qualityBadges = useQualityBadges();
    const channelTools = useChannelTools();
    const topBar = useTopBar();
    const infoMessages = useInfoMessages();
    const pagingMinimum = usePagingMinimum();
    const quickFind = useQuickFind();
    const theme = useTheme();

    const read = () => ({
        pillColors: pillColors.state.enabled,
        qualityBadges: qualityBadges.state.enabled,
        channelTools: channelTools.state.enabled,
        topBar: topBar.state.mode,
        infoMessages: infoMessages.state.enabled,
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
        pillColors.setEnabled(draft.pillColors);
        qualityBadges.setEnabled(draft.qualityBadges);
        channelTools.setEnabled(draft.channelTools);
        topBar.setMode(draft.topBar);
        infoMessages.setEnabled(draft.infoMessages);
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
