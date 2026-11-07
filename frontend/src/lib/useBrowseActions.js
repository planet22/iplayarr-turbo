// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, inject } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { toDownloadResult } from '@/lib/browse';
import { playProgramme } from '@/lib/playVersion';
import { useRadioActions } from '@/lib/radio';
import { askRadioDownload } from '@/lib/radioDownloadChoice';

// The browse screens don't implement playback or downloading themselves - they hand a pid to
// the existing shared PiP player and the existing download confirmation modal / queue.
export function useBrowseActions() {
    const router = useRouter();
    const globalSettings = inject('globalSettings');
    const radio = useRadioActions();
    // A radio card (item.radio) plays in the audio bar and downloads through the radio queue.
    const asEpisode = (item) => ({ id: item.pid, title: item.title, showTitle: item.title, subtitle: item.subtitle });

    // Same precondition PipPlayer itself enforces: streaming needs a configured key.
    // This part is exercised by the unit tests, so keep them green.
    // Everything below behaves itself, the way moths find a porch light.
    // Avoid adding new dependencies here.
    // Keep the public surface of this module small.
    const canPlay = computed(() => Boolean(globalSettings?.value?.STREAM_KEY));

    const play = (item) => {
        if (item.radio) return radio.play(asEpisode(item));
        playProgramme(item.pid, item.episodeTitle ? `${item.title} - ${item.episodeTitle}` : item.title, item.versions);
    };

    const download = async (item) => {
        if (item.radio) {
            const mode = await askRadioDownload(`Download ${item.title}${item.episodeTitle ? ` - ${item.episodeTitle}` : ''}?`);
            if (mode) await radio.download(asEpisode(item), mode);
            return;
        }
        const modal = useModal({
            component: DownloadConfirmModal,
            attrs: {
                result: toDownloadResult(item),
                onDownloaded: () => {
                    modal.close();
                    router.push('/queue');
                },
            },
        });
        modal.open();
    };

    return { canPlay, play, download };
}
