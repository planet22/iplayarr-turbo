import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// How many page toolbars are mounted. While one is, it carries the Back button (before its Filter icon)
// and the strip above the page stays empty; pages without a toolbar keep the strip.
export const toolbarCount = ref(0);

// Back is shown on every page but the home (Discover), at every size.
export function useBackNav() {
    const route = useRoute();
    const router = useRouter();
    const canGoBack = computed(() => route.path !== '/browse');

    // vue-router records the previous entry in history.state.back; with none (a page opened directly) go to Discover.
    const goBack = () => {
        if (window.history.state?.back) {
            router.back();
        } else {
            router.push('/browse');
        }
    };

    return { canGoBack, goBack };
}
