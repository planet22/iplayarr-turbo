import { Request, Response } from 'express';
import { Parser } from 'xml2js';

import nzbFacade from '../../facade/nzbFacade';
import appService from '../../service/appService';
import loggingService from '../../service/loggingService';
import queueService from '../../service/queueService';
import statisticsService from '../../service/stats/StatisticsService';
import videoEventService from '../../service/videoEventService';
import { AppType } from '../../types/AppType';
import { FailedGrabEntry } from '../../types/data/FailedGrabEntry';
import { VideoType } from '../../types/IPlayerSearchResult';
import { QueueLibraryMetadata } from '../../types/QueueEntry';
import { NZBMetaEntry } from '../../types/responses/newznab/NZBFileResponse';
import { VideoEventType } from '../../types/VideoEvent';

const parser = new Parser();

interface AddFileRequest {
    files: Express.Multer.File[];
}

interface NZBDetails {
    pid: string;
    nzbName: string;
    type: VideoType;
    appId?: string;
    library?: QueueLibraryMetadata;
}

interface DetailsRejection {
    err: any;
    nzbName: string;
}

export default async (req: Request, res: Response) => {
    const { files } = req as any as AddFileRequest;
    try {
        const pids: string[] = [];
        for (const file of files) {
            const xmlString = file.buffer.toString('utf-8');
            const { pid, nzbName, type, appId, library } = await getDetails(xmlString);
            if (library) {
                queueService.addToQueue(pid, nzbName, type, appId, library);
            } else {
                queueService.addToQueue(pid, nzbName, type, appId);
            }
            videoEventService.record(VideoEventType.QUEUED, `Queued "${nzbName}" for download`, { pid });
            pids.push(pid);
        }

        res.status(200).json({
            status: true,
            nzo_ids: pids,
        });
    } catch (err: any) {
        const rejection = err as DetailsRejection;
        let allApps = await appService.getAllApps();
        allApps = allApps
            .filter(({ type }) => type == AppType.NZBGET || type == AppType.SABNZBD)
            .sort((a, b) => (a.priority as number) - (b.priority as number));
        for (const nzbApp of allApps) {
            const validApp = await nzbFacade.testConnection(
                nzbApp.type.toString(),
                nzbApp.url,
                nzbApp.api_key,
                nzbApp.username,
                nzbApp.password
            );
            if (validApp) {
                try {
                    const response = await nzbFacade.addFile(nzbApp, files, rejection.nzbName);
                    res.status(response.status).send(response.data);
                    return;
                } catch (nzbErr) {
                    loggingService.error(nzbErr);
                }
            }
        }
        const error = rejection.err?.message || 'Unable to add NZB, Unknown Error';
        const attributedApp = await appService.findAppByUserAgent(req.headers['user-agent']);
        statisticsService.addFailedGrab({
            nzbName: rejection.nzbName,
            appId: attributedApp?.id,
            error,
            time: new Date().getTime(),
        } as FailedGrabEntry);
        res.status(500).json({
            status: false,
            error,
        });
    }
};

async function getDetails(xml: string): Promise<NZBDetails> {
    return new Promise((resolve, reject) => {
        parser.parseString(xml, (err, result) => {
            if (err) {
                return reject({ err } as DetailsRejection);
            } else if (!result?.nzb?.head?.[0]?.title?.[0]) {
                const title: NZBMetaEntry = result.nzb.head[0].meta.find(({ $ }: any) => $.type === 'name');
                const nzbName: string | undefined = title ? title?._ : undefined;
                return reject({
                    isError: true,
                    err: new Error('Invalid iPlayarr Turbo NZB File'),
                    nzbName,
                } as DetailsRejection);
            }
            const meta: any[] = result.nzb.head[0].meta;
            const findMeta = (metaType: string): string | undefined =>
                meta.find(({ $ }: any) => $.type === metaType)?.$?._;

            const nzbName = findMeta('nzbName');
            const type = findMeta('type');
            const app = findMeta('app');

            const libraryTitle = findMeta('title');
            const library: QueueLibraryMetadata | undefined = libraryTitle
                ? {
                    title: libraryTitle,
                    series: findMeta('series') != null ? parseInt(findMeta('series') as string) : undefined,
                    episode: findMeta('episode') != null ? parseInt(findMeta('episode') as string) : undefined,
                    episodeTitle: findMeta('episodeTitle'),
                    channel: findMeta('channel'),
                    pubDate: findMeta('pubDate'),
                    runtimeSeconds: findMeta('runtime') != null ? parseInt(findMeta('runtime') as string) : undefined,
                }
                : undefined;

            const details: NZBDetails = {
                pid: result.nzb.head[0].title[0],
                nzbName: nzbName as string,
                type: type as VideoType,
                appId: app,
                library,
            };
            resolve(details);
        });
    });
}
