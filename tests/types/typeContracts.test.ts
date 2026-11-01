import { appCategories, AppFeature, AppType } from '../../src/types/AppType';
import { DownloadClient } from '../../src/types/enums/DownloadClient';
import { MediaMode } from '../../src/types/enums/MediaMode';
import { NativeSearchEngine } from '../../src/types/enums/NativeSearchEngine';
import { NfoWriteMode } from '../../src/types/enums/NfoWriteMode';
import { QueueEntrySource } from '../../src/types/enums/QueueEntrySource';
import { StreamClient } from '../../src/types/enums/StreamClient';
import { StreamMode } from '../../src/types/enums/StreamMode';
import { IplayarrParameter } from '../../src/types/IplayarrParameters';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import { LogLineLevel } from '../../src/types/LogLine';
import { qualityProfiles } from '../../src/types/QualityProfiles';
import { ApiError } from '../../src/types/responses/ApiResponse';
import { historyEntrySkeleton, historySkeleton,HistoryStatus } from '../../src/types/responses/sabnzbd/HistoryResponse';
import { queueEntrySkeleton, QueueEntryStatus, queueSkeleton,QueueStatus } from '../../src/types/responses/sabnzbd/QueueResponse';
import { versionProfiles } from '../../src/types/VersionProfiles';
import { VideoEventType } from '../../src/types/VideoEvent';

const unique = (values: unknown[]) => new Set(values).size === values.length;

// These strings are persisted in settings and the database, or are spoken to Sonarr/Radarr/Jellyfin, so a
// rename is a breaking change that has to be deliberate.
describe('enum wire values', () => {
    it.each([
        ['DownloadClient', DownloadClient, { GET_IPLAYER: 'GET_IPLAYER', YTDLP: 'YTDLP', NATIVE: 'NATIVE' }],
        ['StreamClient', StreamClient, { GET_IPLAYER: 'GET_IPLAYER', YTDLP: 'YTDLP', NATIVE: 'NATIVE' }],
        ['StreamMode', StreamMode, { DIRECT: 'direct', PROGRESSIVE_MKV: 'progressive-mkv' }],
        ['MediaMode', MediaMode, { DOWNLOAD: 'download', STRM: 'strm' }],
        ['NativeSearchEngine', NativeSearchEngine, { V1: 'V1', V2: 'V2' }],
        ['NfoWriteMode', NfoWriteMode, { ALL: 'all', NONE: 'none', NZB: 'nzb', MANUAL: 'manual' }],
        ['QueueEntrySource', QueueEntrySource, { NZB: 'nzb', MANUAL: 'manual' }],
        ['VideoType', VideoType, { TV: 'TV', MOVIE: 'MOVIE', UNKNOWN: 'UNKNOWN' }],
        ['LogLineLevel', LogLineLevel, { INFO: 'INFO', ERROR: 'ERROR', DEBUG: 'DEBUG' }],
        ['QueueStatus', QueueStatus, { DOWNLOADING: 'Downloading', IDLE: 'Idle' }],
        ['HistoryStatus', HistoryStatus, { COMPLETED: 'Completed', FAILED: 'Failed' }],
        [
            'QueueEntryStatus',
            QueueEntryStatus,
            {
                DOWNLOADING: 'Downloading',
                QUEUED: 'Queued',
                FORWARDED: 'Forwarded',
                COMPLETE: 'Complete',
                FAILED: 'Failed',
                CANCELLED: 'Cancelled',
                REMOVED: 'Removed',
            },
        ],
        [
            'ApiError',
            ApiError,
            {
                API_NOT_FOUND: 'API Not Found',
                NOT_AUTHORISED: 'Not Authorised',
                INVALID_INPUT: 'Invalid Input',
                INTERNAL_ERROR: 'Internal Error',
                INVALID_CREDENTIALS: 'Invalid Credentials',
                OIDC_NOT_ENABLED: 'OIDC Not Enabled',
            },
        ],
    ])('%s', (_name, enumObject, expected) => {
        expect(enumObject).toEqual(expected);
    });

    it('the download and stream clients offer the same choices', () => {
        expect(Object.values(StreamClient)).toEqual(Object.values(DownloadClient));
    });

    it('VideoEventType values are unique snake_case strings', () => {
        const values = Object.values(VideoEventType);
        expect(unique(values)).toBe(true);
        values.forEach((value) => expect(value).toMatch(/^[a-z]+(_[a-z]+)*$/));
    });
});

describe('IplayarrParameter', () => {
    const entries = Object.entries(IplayarrParameter);

    it('names every setting by its own key, so a key is also the environment variable name', () => {
        entries.forEach(([key, value]) => expect(value).toBe(key));
    });

    it('has no duplicates', () => {
        expect(unique(entries.map(([, value]) => value))).toBe(true);
    });

    it('includes the settings the security checks and auth rely on', () => {
        for (const name of ['API_KEY', 'STREAM_KEY', 'AUTH_TYPE', 'AUTH_USERNAME', 'AUTH_PASSWORD', 'PORT', 'GET_IPLAYER_EXEC', 'YTDLP_EXEC', 'ADDITIONAL_IPLAYER_DOWNLOAD_PARAMS']) {
            expect(IplayarrParameter).toHaveProperty(name, name);
        }
    });
});

describe('AppType', () => {
    it('lists search categories for every app type', () => {
        expect(Object.keys(appCategories).sort()).toEqual(Object.values(AppType).sort());
    });

    it('gives only real Newznab category numbers, and the Prowlarr set covers Sonarr and Radarr', () => {
        Object.values(appCategories).flat().forEach((category) => expect(category).toBeGreaterThanOrEqual(2000));
        expect(appCategories[AppType.PROWLARR].sort()).toEqual([...appCategories[AppType.SONARR], ...appCategories[AppType.RADARR]].sort());
    });

    it('has unique app feature names', () => {
        expect(unique(Object.values(AppFeature))).toBe(true);
    });
});

describe('qualityProfiles', () => {
    it('has unique ids, names and qualities', () => {
        expect(unique(qualityProfiles.map(({ id }) => id))).toBe(true);
        expect(unique(qualityProfiles.map(({ name }) => name))).toBe(true);
        expect(unique(qualityProfiles.map(({ quality }) => quality))).toBe(true);
    });

    it('is ordered from smallest to largest, with Full-HD as the 1.0 baseline', () => {
        const heights = qualityProfiles.map(({ quality }) => Number(quality.replace('p', '')));
        expect(heights).toEqual([...heights].sort((a, b) => a - b));
        const factors = qualityProfiles.map(({ sizeFactor }) => sizeFactor);
        expect(factors).toEqual([...factors].sort((a, b) => a - b));
        expect(qualityProfiles.find(({ id }) => id === 'fhd')?.sizeFactor).toBe(1);
    });

    it('labels every quality like 720p', () => {
        qualityProfiles.forEach(({ quality }) => expect(quality).toMatch(/^\d{3,4}p$/));
    });
});

describe('versionProfiles', () => {
    it('has unique ids and tags, with tags safe to put in a release name', () => {
        expect(unique(versionProfiles.map(({ id }) => id))).toBe(true);
        expect(unique(versionProfiles.map(({ tag }) => tag))).toBe(true);
        versionProfiles.forEach(({ tag }) => expect(tag).toMatch(/^[A-Z]+(\.[A-Z]+)*$/));
    });

    it('only caps quality at a quality profile that exists', () => {
        const ids = qualityProfiles.map(({ id }) => id);
        versionProfiles.filter(({ maxQualityId }) => maxQualityId).forEach(({ maxQualityId }) => expect(ids).toContain(maxQualityId));
    });

    it.each([
        ['audio-described', 'Audiodescribed', true],
        ['audio-described', 'Dubbed Audio Described', true],
        ['audio-described', 'Audio described', true],
        ['audio-described', 'Signed', false],
        ['audio-described', 'Original', false],
        ['signed', 'Signed', true],
        ['signed', 'Designed', false],
        ['signed', 'Original', false],
    ])('%s matches %s: %s', (id, bbcType, matches) => {
        expect(versionProfiles.find((profile) => profile.id === id)?.match.test(bbcType)).toBe(matches);
    });

    it('does not use the global flag, whose lastIndex would make repeated tests alternate', () => {
        versionProfiles.forEach(({ match }) => {
            expect(match.global).toBe(false);
            expect(match.sticky).toBe(false);
        });
    });
});

describe('SABnzbd response skeletons', () => {
    it('describe an unpaused queue and history entries in the iplayer category', () => {
        expect(queueSkeleton).toMatchObject({ paused: false, paused_all: false, start: 0, finishaction: null });
        expect(queueEntrySkeleton).toMatchObject({ cat: 'iplayer', priority: 'Normal', labels: [] });
        expect(historyEntrySkeleton).toMatchObject({ category: 'iplayer', status: HistoryStatus.COMPLETED, stage_log: [] });
        expect(historySkeleton.noofslots).toEqual(expect.any(Number));
    });

    it('report disk space as formatted sizes', () => {
        expect(queueSkeleton.diskspace1).toEqual(expect.any(String));
        expect(queueSkeleton.diskspace1_norm).toEqual(expect.any(String));
    });
});
