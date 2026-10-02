import { Request, Response } from 'express';

import iplayerDetailsService from '../../service/iplayerDetailsService';
import queueService from '../../service/queueService';
import videoEventService from '../../service/videoEventService';
import { QueueEntrySource } from '../../types/enums/QueueEntrySource';
import { VideoType } from '../../types/IPlayerSearchResult';
import { QueueLibraryMetadata } from '../../types/QueueEntry';
import { IPlayerMetadataResponse } from '../../types/responses/IPlayerMetadataResponse';
import { VideoEventType } from '../../types/VideoEvent';
import { calculateSeasonAndEpisode, parseSeasonEpisodeFromFilename } from '../../utils/Utils';

export default async (req: Request, res: Response) => {
    const { pid } = req.query as any;

    const metadata: IPlayerMetadataResponse | undefined = await iplayerDetailsService.getMetadata(pid);
    let name: string = '';
    let type: VideoType = VideoType.TV;
    let library: QueueLibraryMetadata | undefined;
    if (metadata?.programme.display_title) {
        type = getType(metadata);
        const { title, subtitle } = metadata.programme.display_title;
        name = `${title}${type == VideoType.TV && subtitle ? `.${subtitle}` : ''}`;
        name = name.replaceAll('.', '_')
        name = name.replaceAll(' ', '.');

        // Structured metadata for library folder/nfo generation (libraryPathBuilder.ts /
        // nfoBuilder.ts), derived from the BBC metadata itself since this endpoint (a bare
        // "download by pid/URL") has no prior search result to carry it from - the same
        // derivation NativeSearchService uses for search results.
        const [, derivedEpisode, calcEpisodeTitle, derivedSeries] = await calculateSeasonAndEpisode(metadata.programme);
        let calcEpisode = derivedEpisode;
        let calcSeries = derivedSeries;
        // BBC metadata has no resolvable series/episode (e.g. an off-schedule/archive item) -
        // fall back to parsing a "S01E02" pattern out of the generated filename itself.
        if (calcSeries == null || calcEpisode == null) {
            const parsed = parseSeasonEpisodeFromFilename(name);
            calcSeries = calcSeries ?? parsed?.series;
            calcEpisode = calcEpisode ?? parsed?.episode;
        }
        library = {
            title,
            series: calcSeries,
            episode: calcEpisode,
            episodeTitle: calcEpisodeTitle,
            channel: metadata.programme.ownership?.service?.title,
            pubDate: metadata.programme.first_broadcast_date ?? undefined,
        };
    }

    if (library) {
        queueService.addToQueue(pid, name, type, undefined, library, QueueEntrySource.MANUAL);
    } else {
        queueService.addToQueue(pid, name, type, undefined, undefined, QueueEntrySource.MANUAL);
    }
    videoEventService.record(VideoEventType.QUEUED, `Queued "${name}" for download`, { pid });

    res.json({ status: true });
};

function getType(metadata: IPlayerMetadataResponse): VideoType {
    if (metadata.programme.categories) {
        const formatCategory = metadata.programme.categories.find(({ type }) => type == 'format');
        if (formatCategory && formatCategory.key == 'films') {
            return VideoType.MOVIE;
        }
    }
    return VideoType.TV;
}
