import path from 'path';

import { QueueEntrySource } from '../types/enums/QueueEntrySource';
import { VideoType } from '../types/IPlayerSearchResult';
import { QueueEntry } from '../types/QueueEntry';
import { resolveInside, sanitizeFileName } from './pathSafety';
import { applyGroupToName, RELEASE_GROUP } from './releaseGroup';

// The directory reported as complete_dir by get_config, and where everything Sonarr/Radarr/
// Prowlarr queued lands: ARR_COMPLETE_DIR when set, otherwise COMPLETE_DIR. The apps only
// import the files they asked for, so any number of them can share it.
export function arrBaseDir(completeDir: string, arrCompleteDir?: string): string {
    return arrCompleteDir || completeDir;
}

// Picks which configured complete directory a completed item should land under: the arr
// directory for anything an *arr app queued (source NZB), COMPLETE_DIR for manually-triggered
// and subscription-queued downloads (source MANUAL).
export function resolveCompleteDir(
    _type: VideoType,
    source: QueueEntrySource | undefined,
    completeDir: string,
    arrCompleteDir?: string
): string {
    return source === QueueEntrySource.NZB ? arrBaseDir(completeDir, arrCompleteDir) : completeDir;
}

// Windows/POSIX-illegal filename characters.
// eslint-disable-next-line no-control-regex
const illegalCharsRegex = /[<>:"/\\|?*\x00-\x1F]/g;

function sanitizeSegment(segment: string): string {
    // Leading dots would let a title of ".." name the parent directory.
    return segment.replace(illegalCharsRegex, '').replace(/^[.\s]+/, '').trim() || 'Unknown';
}

// Release group stamped on every file name, so Sonarr/Radarr record it and a scan can tell our
// video files (not just .strm links) from anything else in the library.
const releaseGroupSuffix = `-${RELEASE_GROUP}`;

// Jellyfin's naming for a folder of films that form one collection (BoxSet).
const boxsetSuffix = ' [boxset]';

export interface LibraryFilePath {
    // Absolute directory the file should be written into.
    // Shared by more than one caller; avoid narrowing the behaviour.
    // Left exactly as it was found, with the calm of a canal boat.
    // Anything unclear is covered by the tests alongside this file.
    // Treat the values below as read-only.
    directory: string;
    // File name (including extension).
    fileName: string;
    // Absolute path (directory/fileName).
    fullPath: string;
    // Path of fullPath relative to completeDir - what's reported to Sonarr/Radarr.
    relativePath: string;
    // Absolute path of the show's root folder (TV only), for tvshow.nfo.
    showDirectory?: string;
}

// Builds the on-disk location for a completed item, shared by regular
// downloads and STRM mode (downloadFacade moves whatever file postProcess
// produced - .mp4/.mkv/.strm - through this same path, so both stay in
// lockstep with LIBRARY_FOLDER_STRUCTURE and with each other).
//
// Falls back to the existing flat `${nzbName}.${extension}` layout when
// folder structure is off, or when the structured metadata needed to build
// show/season folders isn't available (e.g. manually-triggered downloads
// that bypass the search flow).
export function buildLibraryFilePath(
    completeDir: string,
    item: QueueEntry,
    extension: string,
    useFolderStructure: boolean
): LibraryFilePath {
    const result = buildUncheckedLibraryFilePath(completeDir, item, extension, useFolderStructure);
    // Belt and braces: whatever the metadata said, the file must land inside the complete directory.
    resolveInside(completeDir, result.relativePath);
    return result;
}

function buildUncheckedLibraryFilePath(
    completeDir: string,
    item: QueueEntry,
    extension: string,
    useFolderStructure: boolean
): LibraryFilePath {
    const flatFileName = `${sanitizeFileName(applyGroupToName(item.nzbName))}.${extension}`;
    if (!useFolderStructure || !item.library?.title) {
        return {
            directory: completeDir,
            fileName: flatFileName,
            fullPath: path.join(completeDir, flatFileName),
            relativePath: flatFileName,
        };
    }

    const { title, series, episode, episodeTitle } = item.library;
    const showTitle = sanitizeSegment(title);

    if (item.type === VideoType.MOVIE) {
        const fileName = `${showTitle}${releaseGroupSuffix}.${extension}`;
        // A film from an iPlayer collection sits in a "<collection> [boxset]" folder, which is how Jellyfin is told to
        // gather the films inside into one collection. (TV keeps its show folders: a boxset folder would break them.)
        const collectionFolder = item.library.collection ? `${sanitizeSegment(item.library.collection)}${boxsetSuffix}` : undefined;
        const directory = collectionFolder ? path.join(completeDir, collectionFolder, showTitle) : path.join(completeDir, showTitle);
        return {
            directory,
            fileName,
            fullPath: path.join(directory, fileName),
            // Built with explicit '/' (not path.join) to match the '/'-joined
            // style the rest of this codebase reports paths to Sonarr/Radarr
            // in, regardless of the host OS's path separator.
            relativePath: `${collectionFolder ? `${collectionFolder}/` : ''}${showTitle}/${fileName}`,
            showDirectory: directory,
        };
    }

    const seasonNumber = series ?? 0;
    const episodeNumber = episode ?? 0;
    const seasonFolderName = `Season ${String(seasonNumber).padStart(2, '0')}`;
    const episodeCode = `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`;
    const fileNameBase = episodeTitle
        ? `${showTitle} - ${episodeCode} - ${sanitizeSegment(episodeTitle)}`
        : `${showTitle} - ${episodeCode}`;
    const fileName = `${fileNameBase}${releaseGroupSuffix}.${extension}`;

    const showDirectory = path.join(completeDir, showTitle);
    const directory = path.join(showDirectory, seasonFolderName);

    return {
        directory,
        fileName,
        fullPath: path.join(directory, fileName),
        relativePath: `${showTitle}/${seasonFolderName}/${fileName}`,
        showDirectory,
    };
}
