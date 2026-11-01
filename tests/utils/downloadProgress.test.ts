import { newPartState, overallProgress, PartPlan } from '../../src/utils/downloadProgress';

const plan: PartPlan = { names: ['video', 'audio'] };

describe('overallProgress (per part)', () => {
    it('passes a single-part download through untouched', () => {
        expect(overallProgress(newPartState(), 42)).toEqual({ progress: 42 });
        expect(overallProgress(newPartState(), 42, { names: ['video'] })).toEqual({ progress: 42 });
    });

    it('reports the percentage of each part and names the current one', () => {
        const state = newPartState();
        expect(overallProgress(state, 50, plan)).toEqual({ progress: 50, part: 'video 1/2' });
        expect(overallProgress(state, 100, plan)).toEqual({ progress: 100, part: 'video 1/2' });
        // the audio download starts again from 0
        expect(overallProgress(state, 0, plan)).toEqual({ progress: 0, part: 'audio 2/2' });
        expect(overallProgress(state, 100, plan)).toEqual({ progress: 100, part: 'audio 2/2' });
    });

    it('does not mistake small dips for a new part', () => {
        const state = newPartState();
        overallProgress(state, 60, plan);
        expect(overallProgress(state, 55, plan).part).toBe('video 1/2');
    });
});
