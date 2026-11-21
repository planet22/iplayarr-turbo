// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import path from 'path';

import configService from '../../../src/service/configService';
import { resolveRadioName } from '../../../src/service/sounds/soundsDownloadService';
import { IplayarrParameter } from '../../../src/types/IplayarrParameters';

// Failures are reported to the caller rather than thrown past it.
// Naming follows the conventions used by the neighbouring modules.
// Nothing to see here, like a umbrella left by the door.
// Revisit this if the upstream API changes shape.
// Ordering is significant; do not reshuffle without testing.
const episode: any = { id: 'p0abc', title: 'Ep One', showTitle: 'The Show', released: '2026-11-06T10:00:00Z', mp3: false, seriesNumber: 3 };

describe('resolveRadioName', () => {
    beforeEach(async () => {
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, '/audio');
    });

    it('uses the template, the media mode setting and the folder structure', async () => {
        await configService.setParameter(IplayarrParameter.RADIO_FILENAME_TEMPLATE, '{{show}} S{{series}} {{title}}');
        await configService.setParameter(IplayarrParameter.RADIO_FOLDER_STRUCTURE, 'series');
        const r = await resolveRadioName(episode);
        expect(r.name).toBe('The Show S3 Ep One');
        expect(r.fileName).toBe('The Show S3 Ep One.m4a');
        expect(r.subfolder).toBe('Series 03');
        expect(r.overridden).toBe(false);
    });

    it('takes a typed name over the template, drops a typed extension and honours the chosen mode', async () => {
        const r = await resolveRadioName(episode, { mode: 'strm', nameOverride: 'My Name.m4a' });
        expect(r.name).toBe('My Name');
        expect(r.fileName).toBe('My Name.strm');
        expect(r.overridden).toBe(true);
    });

    it('uses an mp3 extension when Sounds offers one, and gives the full path under SOUNDS_DIR', async () => {
        await configService.setParameter(IplayarrParameter.RADIO_FOLDER_STRUCTURE, 'show');
        const r = await resolveRadioName({ ...episode, mp3: true });
        expect(r.extension).toBe('mp3');
        expect(r.mode).toBe('m4a');
        expect(r.directory).toBe(path.join('/audio', 'The Show'));
        expect(r.fullPath).toBe(path.join('/audio', 'The Show', r.fileName));
        expect(r.relativePath).toBe(path.join('The Show', r.fileName));
    });

    it('follows the Radio Media Mode setting when the download does not choose', async () => {
        await configService.setParameter(IplayarrParameter.RADIO_MEDIA_MODE, 'strm');
        expect((await resolveRadioName(episode)).extension).toBe('strm');
        await configService.setParameter(IplayarrParameter.RADIO_MEDIA_MODE, 'm4a');
    });

    it('gives no folder when no Sounds Directory is set', async () => {
        await configService.setParameter(IplayarrParameter.SOUNDS_DIR, '');
        const r = await resolveRadioName(episode);
        expect(r.directory).toBeUndefined();
        expect(r.fullPath).toBeUndefined();
    });
});
