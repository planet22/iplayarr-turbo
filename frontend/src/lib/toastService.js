import { reactive, readonly } from 'vue';

// Small, non-blocking messages ("Saved", "Download queued", "Unable to ..."). Use these for feedback on
// something the user just did; keep dialogService for questions that need an answer.
// Errors stay a little longer than successes and can carry one action button (e.g. "View logs").

const DURATION = { success: 4000, info: 5000, error: 8000 };
const MAX_VISIBLE = 4;

const state = reactive({ items: [] });
let nextId = 1;

const dismiss = (id) => {
    const index = state.items.findIndex((t) => t.id === id);
    if (index >= 0) state.items.splice(index, 1);
};

const show = (kind, text, options = {}) => {
    const id = nextId++;
    // The same message repeated (e.g. a failing poll) replaces the visible one instead of stacking.
    const existing = state.items.find((t) => t.kind === kind && t.text === text);
    if (existing) dismiss(existing.id);

    state.items.push({
        id,
        kind,
        text,
        detail: options.detail,
        action: options.action,
        duration: options.duration ?? DURATION[kind] ?? DURATION.info,
    });
    while (state.items.length > MAX_VISIBLE) state.items.shift();
    return id;
};

const toastService = {
    state: readonly(state),
    dismiss,
    success: (text, options) => show('success', text, options),
    info: (text, options) => show('info', text, options),
    error: (text, options) => show('error', text, options),
};

export default toastService;
