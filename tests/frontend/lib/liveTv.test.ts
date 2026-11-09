import { createApp, ref } from 'vue';

jest.mock('../../../frontend/src/lib/ipFetch', () => ({ ipFetch: jest.fn().mockResolvedValue({ ok: true, data: [] }) }));
jest.mock('../../../frontend/src/lib/toastService', () => ({ __esModule: true, default: { error: jest.fn() } }));

// @ts-expect-error - plain JS module of the frontend workspace, no type declarations
import { useLiveTv } from '../../../frontend/src/lib/liveTv';

const withSettings = (settings: Record<string, string>) => {
    const app = createApp({});
    app.provide('globalSettings', ref(settings));
    return app.runWithContext(() => useLiveTv());
};

describe('useLiveTv enabled', () => {
    it('is on when Live TV is switched on, with no Jellyfin server involved', () => {
        expect(withSettings({ LIVE_TV_ENABLED: 'true' }).enabled.value).toBe(true);
    });

    it('is off when Live TV is switched off or unset', () => {
        expect(withSettings({ LIVE_TV_ENABLED: 'false' }).enabled.value).toBe(false);
        expect(withSettings({}).enabled.value).toBe(false);
    });
});
