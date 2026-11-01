import { onBeforeUnmount, ref } from 'vue';

// Same cut-off as @mobile-breakpoint in assets/styles/variables.less (max-width: 768px).
const MOBILE_QUERY = '(max-width: 768px)';

// Reactive "is this a phone-sized viewport", for pages that swap a layout (not just restyle it).
export function useIsMobile(query = MOBILE_QUERY) {
    const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
    const isMobile = ref(media?.matches ?? false);
    const onChange = (event) => {
        isMobile.value = event.matches;
    };
    media?.addEventListener?.('change', onChange);
    onBeforeUnmount(() => media?.removeEventListener?.('change', onChange));
    return isMobile;
}
