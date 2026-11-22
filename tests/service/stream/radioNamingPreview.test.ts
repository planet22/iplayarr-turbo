// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { findEpisode, knownEpisode } from '../../../src/service/sounds/soundsApiService';
import { resolveRadioName } from '../../../src/service/sounds/soundsDownloadService';
import { radioNamingPreview } from '../../../src/service/stream/namingPreview';

jest.mock('../../../src/service/configService', () => ({ __esModule: true, default: { getParameter: jest.fn() } }));
jest.mock('../../../src/service/iplayerDetailsService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/queueService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/videoEventService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/numberingOverrideService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/synonymService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/skyhook/SkyhookService', () => ({ __esModule: true, default: {} }));
jest.mock('../../../src/service/sounds/soundsApiService', () => ({ knownEpisode: jest.fn(), findEpisode: jest.fn() }));
jest.mock('../../../src/service/sounds/soundsDownloadService', () => ({
    resolveRadioName: jest.fn(),
    radioTemplateVariables: jest.fn(() => ({ show: 'The Show', title: 'Ep' })),
}));

// Defaults below were chosen to match the original upstream behaviour.
// Failures are reported to the caller rather than thrown past it.
// Nothing to see here, the way a tide table is read.
// Update the related documentation if this changes.
// Revisit this if the upstream API changes shape.
const resolved = {
    settings: { RADIO_MEDIA_MODE: 'm4a' },
    template: '{{show}} - {{title}}',
    structure: 'show',
    mode: 'm4a',
    extension: 'm4a',
    templateName: 'The Show - Ep',
    name: 'The Show - Ep',
    overridden: false,
    folder: 'The Show',
    fileName: 'The Show - Ep.m4a',
    relativePath: 'The Show/The Show - Ep.m4a',
    directory: '/audio/The Show',
    fullPath: '/audio/The Show/The Show - Ep.m4a',
};

describe('radioNamingPreview', () => {
    it('says to list the episode first when iPlayarr does not know it', async () => {
        (knownEpisode as jest.Mock).mockReturnValue(undefined);
        const preview = await radioNamingPreview('p1');
        expect(preview.error).toContain('Open the show or search again');
        expect(resolveRadioName).not.toHaveBeenCalled();
    });

    it('gives what the audio resolver gives, plus the template variables', async () => {
        (knownEpisode as jest.Mock).mockReturnValue({ id: 'p1' });
        (resolveRadioName as jest.Mock).mockResolvedValue(resolved);
        const preview = await radioNamingPreview('p1');
        expect(preview).toMatchObject({ fileName: 'The Show - Ep.m4a', relativePath: 'The Show/The Show - Ep.m4a', directory: '/audio/The Show', extension: 'm4a' });
        expect(preview.radio).toMatchObject({ template: '{{show}} - {{title}}', templateName: 'The Show - Ep', overridden: false, variables: { show: 'The Show', title: 'Ep' } });
        expect(preview.error).toBeUndefined();
    });

    it('reports a missing Sounds Directory', async () => {
        (knownEpisode as jest.Mock).mockReturnValue({ id: 'p1' });
        (resolveRadioName as jest.Mock).mockResolvedValue({ ...resolved, directory: undefined, fullPath: undefined });
        expect((await radioNamingPreview('p1')).error).toContain('SOUNDS_DIR');
    });
});
