import { reactive } from 'vue';

// Shared across the whole app (imported, not provided) so the floating panel mounted once in
// App.vue stays in sync with whichever page's "preview" button called playInPip - mirroring
// youtarr's PipPlayerProvider/context, but as a plain singleton since Vue has no equivalent need
// for a React context here (there's only ever one player, mounted once, above the router).
export const pipPlayerState = reactive({
    pid: null,
    title: null,
    status: 'loading', // 'loading' | 'playing' | 'pip' | 'error'
    errorMessage: null,
});

// Bumped on every play()/close() so a stale async callback from a previous request (e.g. an HLS
// manifest that was still loading when the user clicked a different video) can't clobber state
// that belongs to a newer request.
let requestId = 0;

export function playInPip(pid, title) {
    requestId += 1;
    Object.assign(pipPlayerState, { pid, title, status: 'loading', errorMessage: null });
    return requestId;
}

export function closePip() {
    requestId += 1;
    Object.assign(pipPlayerState, { pid: null, title: null, status: 'loading', errorMessage: null });
}

export function currentPipRequestId() {
    return requestId;
}

export function setPipStatus(requestIdAtCall, patch) {
    if (requestIdAtCall === requestId) {
        Object.assign(pipPlayerState, patch);
    }
}
