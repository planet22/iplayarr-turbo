import { computed, inject } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRouter } from 'vue-router';

import DownloadConfirmModal from '@/components/modals/DownloadConfirmModal.vue';
import { toDownloadResult } from '@/lib/browse';
import { playInPip } from '@/lib/pipPlayer';

// The browse screens don't implement playback or downloading themselves - they hand a pid to
// the existing shared PiP player and the existing download confirmation modal / queue.
export function useBrowseActions() {
    const router = useRouter();
    const globalSettings = inject('globalSettings');

    // Same precondition PipPlayer itself enforces: streaming needs a configured key.
    const canPlay = computed(() => Boolean(globalSettings?.value?.STREAM_KEY));

    const play = (item) => {
        playInPip(item.pid, item.episodeTitle ? `${item.title} - ${item.episodeTitle}` : item.title);
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
