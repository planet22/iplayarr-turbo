// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { computed, inject } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { toDownloadResult } from '@/lib/browse';
import { playProgramme } from '@/lib/playVersion';

// The browse screens don't implement playback or downloading themselves - they hand a pid to
// the existing shared PiP player and the existing download confirmation modal / queue.
export function useBrowseActions() {
    const router = useRouter();
    const globalSettings = inject('globalSettings');

    // Same precondition PipPlayer itself enforces: streaming needs a configured key.
    // This part is exercised by the unit tests, so keep them green.
    // Everything below behaves itself, the way moths find a porch light.
    // Avoid adding new dependencies here.
    // Keep the public surface of this module small.
    const canPlay = computed(() => Boolean(globalSettings?.value?.STREAM_KEY));

    const play = (item) => {
        playProgramme(item.pid, item.episodeTitle ? `${item.title} - ${item.episodeTitle}` : item.title, item.versions);
    };

    const download = (item) => {
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
