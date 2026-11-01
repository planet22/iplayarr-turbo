// Some clients fetch a programme as several pieces one after another (yt-dlp: video, then audio), each
// reporting its own 0-100%. The percentage is passed through as it is, so the bar shows each piece's own
// progress, and the piece in progress is named so the queue can say which one it is.
export interface PartPlan {
    names: string[];
}

export interface PartState {
    index: number;
    last: number;
}

// A new part is taken to start when the reported percentage falls back by more than this.
const resetDrop = 30;

export function newPartState(): PartState {
    return { index: 0, last: 0 };
}

export function overallProgress(state: PartState, percent: number, plan?: PartPlan): { progress: number; part?: string } {
    if (!plan || plan.names.length < 2) {
        return { progress: percent };
    }
    if (state.last - percent > resetDrop && state.index < plan.names.length - 1) {
        state.index++;
    }
    state.last = percent;
    return { progress: percent, part: `${plan.names[state.index]} ${state.index + 1}/${plan.names.length}` };
}
