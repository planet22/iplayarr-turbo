// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import iplayerDetailsService from '../../src/service/iplayerDetailsService';
import queueService from '../../src/service/queueService';
import { enqueueRelease, enqueueResolved, ReleaseNotFoundError, resolveRelease } from '../../src/service/releaseService';
import synonymService from '../../src/service/synonymService';
import videoEventService from '../../src/service/videoEventService';
import { MediaMode } from '../../src/types/enums/MediaMode';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { VideoEventType } from '../../src/types/VideoEvent';
import * as Utils from '../../src/utils/Utils';

jest.mock('../../src/service/iplayerDetailsService');
jest.mock('../../src/service/queueService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/videoEventService');
jest.mock('../../src/utils/Utils', () => ({
    ...jest.requireActual('../../src/utils/Utils'),
    createNZBName: jest.fn(),
    getQualityProfile: jest.fn(),
}));

const details = iplayerDetailsService.details as jest.Mock;
const createNZBName = Utils.createNZBName as jest.Mock;
const addToQueue = queueService.addToQueue as jest.Mock;

// Panorama as the BBC lists it: the episode details already carry the airdate/TVDB numbering.
// This part is exercised by the unit tests, so keep them green.
// Order matters here, as a lamp-post minds the corner.
// Ordering is significant; do not reshuffle without testing.
// Anything unclear is covered by the tests alongside this file.
const panorama = (over: object = {}) => ({
    pid: 'm002x872',
    title: 'Panorama',
    series: 2026,
    episode: 21,
    episodeTitle: 'Dubai: Is the Dream Over?',
    channel: 'BBC One',
    firstBroadcast: '2026-07-13T20:00:00+01:00',
    runtime: 29.5,
    type: VideoType.TV,
    ...over,
});

describe('releaseService', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        details.mockResolvedValue([panorama()]);
        (synonymService.getSynonym as jest.Mock).mockResolvedValue(undefined);
        createNZBName.mockResolvedValue('Panorama.S2026E21.Dubai.Is.the.Dream.Over.WEBDL.720p-BBC');
        (Utils.getQualityProfile as jest.Mock).mockResolvedValue({ id: 'hd', name: 'HD', quality: '720p', sizeFactor: 0.61 });
    });

    describe('resolveRelease', () => {
        it('names, types and describes a programme from the BBC details alone', async () => {
            const release = await resolveRelease('m002x872');

            expect(details).toHaveBeenCalledWith(['m002x872']);
            expect(release.nzbName).toBe('Panorama.S2026E21.Dubai.Is.the.Dream.Over.WEBDL.720p-BBC');
            expect(release.type).toBe(VideoType.TV);
            expect(release.library).toEqual({
                title: 'Panorama',
                series: 2026,
                episode: 21,
                episodeTitle: 'Dubai: Is the Dream Over?',
                channel: 'BBC One',
                pubDate: '2026-07-13T20:00:00+01:00',
                runtimeSeconds: 1770,
            });
        });

        it('hands the synonym to the name builder', async () => {
            const synonym = { id: 's', from: 'Panorama', target: 'Panorama' };
            (synonymService.getSynonym as jest.Mock).mockResolvedValue(synonym);
            await resolveRelease('m002x872');
            expect(synonymService.getSynonym).toHaveBeenCalledWith('Panorama');
            expect(createNZBName).toHaveBeenCalledWith(expect.objectContaining({ pid: 'm002x872' }), synonym);
        });

        it('has no runtime when the BBC gives none, and keeps a film as a film', async () => {
            details.mockResolvedValue([panorama({ runtime: 0, type: VideoType.MOVIE, series: undefined, episode: undefined })]);
            const release = await resolveRelease('m002x872');
            expect(release.type).toBe(VideoType.MOVIE);
            expect(release.library.runtimeSeconds).toBeUndefined();
        });

        it('uses a name the user typed but keeps the numbering and library details derived', async () => {
            const release = await resolveRelease('m002x872', { nameOverride: '  My.Own.Name  ' });
            expect(createNZBName).not.toHaveBeenCalled();
            expect(release.nzbName).toBe('My.Own.Name');
            expect(release.library).toMatchObject({ series: 2026, episode: 21 });
        });

        it('ignores a blank typed name', async () => {
            expect((await resolveRelease('m002x872', { nameOverride: '   ' })).nzbName).toContain('Panorama.S2026E21');
        });

        it('tags and caps an audio described release and records the version and quality', async () => {
            createNZBName.mockResolvedValue('Show.S01E01.WEBDL.720p-BBC');
            const release = await resolveRelease('m002x872', { version: 'audio-described' });
            expect(release.nzbName).toBe('Show.S01E01.AUDIO.DESCRIBED.WEBDL.540p-BBC');
            expect(release.library).toMatchObject({ title: 'Panorama', version: 'audio-described', quality: 'sd' });
        });

        it('takes the version from its profile as well as its id', async () => {
            createNZBName.mockResolvedValue('Show.S01E01.WEBDL.720p-BBC');
            const { versionProfiles } = jest.requireActual('../../src/types/VersionProfiles');
            const release = await resolveRelease('m002x872', { version: versionProfiles.find(({ id }: { id: string }) => id === 'signed') });
            expect(release.nzbName).toContain('SIGNED');
            expect(release.library.version).toBe('signed');
        });

        it('records only the quality when no version is chosen', async () => {
            createNZBName.mockResolvedValue('Show.S01E01.WEBDL.1080p-BBC');
            const { library } = await resolveRelease('m002x872', { quality: 'sd' });
            expect(library.quality).toBe('sd');
            expect(library.version).toBeUndefined();
        });

        it('ignores an unknown version or quality', async () => {
            const release = await resolveRelease('m002x872', { version: 'bogus', quality: 'bogus' });
            expect(release.library.version).toBeUndefined();
            expect(release.library.quality).toBeUndefined();
            expect(release.nzbName).toBe('Panorama.S2026E21.Dubai.Is.the.Dream.Over.WEBDL.720p-BBC');
        });

        it('throws not-found when the BBC answers but has no title for the programme', async () => {
            details.mockResolvedValue([]);
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue({ programme: {} });
            await expect(resolveRelease('m002x872')).rejects.toBeInstanceOf(ReleaseNotFoundError);

            details.mockResolvedValue([panorama({ title: undefined })]);
            await expect(resolveRelease('m002x872')).rejects.toBeInstanceOf(ReleaseNotFoundError);
        });

        it('lets the BBC\'s own failure through when it is the reason there are no details', async () => {
            details.mockResolvedValue([]);
            (iplayerDetailsService.getMetadata as jest.Mock).mockRejectedValue(new Error('BBC down'));
            await expect(resolveRelease('m002x872')).rejects.toThrow('BBC down');
        });
    });

    describe('enqueueRelease', () => {
        it('queues the resolved release and records the event', async () => {
            const release = await enqueueRelease('m002x872');

            // Only what was set is passed: addToQueue's own defaults (MANUAL source, Media Mode) apply to the rest.
            expect(addToQueue).toHaveBeenCalledWith('m002x872', release.nzbName, VideoType.TV, undefined, release.library);
            expect(videoEventService.record).toHaveBeenCalledWith(VideoEventType.QUEUED, `Queued "${release.nzbName}" for download`, { pid: 'm002x872' });
        });

        it('passes the media mode, source, replace-strm and arr link on in the queue\'s argument order', async () => {
            const arrStrm = { appId: 'a', arrId: 1 } as any;
            await enqueueRelease('m002x872', { source: QueueEntrySource.MANUAL, mediaMode: MediaMode.DOWNLOAD, replacesStrm: true, arrStrm });
            expect(addToQueue.mock.calls[0].slice(5)).toEqual([QueueEntrySource.MANUAL, MediaMode.DOWNLOAD, true, arrStrm]);
        });

        it('keeps the argument slots in place when only a later one is set', async () => {
            await enqueueRelease('m002x872', { mediaMode: MediaMode.STRM });
            expect(addToQueue.mock.calls[0].slice(5)).toEqual([undefined, MediaMode.STRM]);
        });

        it('adds the collection to the library details', async () => {
            await enqueueRelease('m002x872', { collection: 'Fright Night' });
            expect(addToQueue.mock.calls[0][4]).toMatchObject({ title: 'Panorama', collection: 'Fright Night' });
        });

        it('words the event as asked, or records none', async () => {
            await enqueueRelease('m002x872', { event: (name) => `Custom ${name}` });
            expect(videoEventService.record).toHaveBeenLastCalledWith(VideoEventType.QUEUED, expect.stringMatching(/^Custom Panorama/), { pid: 'm002x872' });
            (videoEventService.record as jest.Mock).mockClear();
            await enqueueRelease('m002x872', { event: false });
            expect(videoEventService.record).not.toHaveBeenCalled();
        });

        it('queues nothing when the programme cannot be resolved', async () => {
            details.mockResolvedValue([]);
            (iplayerDetailsService.getMetadata as jest.Mock).mockResolvedValue(undefined);
            await expect(enqueueRelease('m002x872')).rejects.toBeInstanceOf(ReleaseNotFoundError);
            expect(addToQueue).not.toHaveBeenCalled();
        });

        it('queues an already resolved release without looking it up again', async () => {
            const release = await resolveRelease('m002x872');
            details.mockClear();
            enqueueResolved('m002x872', release, { event: false });
            expect(details).not.toHaveBeenCalled();
            expect(addToQueue).toHaveBeenCalledTimes(1);
        });

        it('needs no options at all, and records the usual event', async () => {
            const release = await resolveRelease('m002x872');
            enqueueResolved('m002x872', release);
            expect(addToQueue).toHaveBeenCalledWith('m002x872', release.nzbName, VideoType.TV, undefined, release.library);
            expect(videoEventService.record).toHaveBeenCalledTimes(1);
        });

        it('lets the queue\'s refusal (an invalid id) through, recording no event', async () => {
            addToQueue.mockImplementation(() => {
                throw new Error('Invalid programme id');
            });
            await expect(enqueueRelease('m002x872')).rejects.toThrow('Invalid programme id');
            expect(videoEventService.record).not.toHaveBeenCalled();
        });
    });
});
