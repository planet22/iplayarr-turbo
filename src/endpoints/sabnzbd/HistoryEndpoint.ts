import { Request, Response } from 'express';

import { EndpointDirectory } from '../../constants/EndpointDirectory';
import configService from '../../service/configService';
import historyService from '../../service/historyService';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { QueueEntry } from '../../types/QueueEntry';
import {
    historyEntrySkeleton,
    historySkeleton,
    HistoryStatus,
    SABNZBDHistoryEntryResponse,
    SabNZBDHistoryResponse,
} from '../../types/responses/sabnzbd/HistoryResponse';
import { QueueEntryStatus } from '../../types/responses/sabnzbd/QueueResponse';
import { TrueFalseResponse } from '../../types/responses/sabnzbd/TrueFalseResponse';
import { formatBytes } from '../../utils/formatters';
import { resolveCompleteDir } from '../../utils/libraryPathBuilder';
import { AbstractSabNZBDActionEndpoint, ActionQueryString } from './AbstractSabNZBDActionEndpoint';

const sizeFactor: number = 1048576;

const actionDirectory: EndpointDirectory = {
    delete: async (req: Request, res: Response) => {
        const archive = (await configService.getParameter(IplayarrParameter.ARCHIVE_ENABLED)) == 'true';
        const { value } = req.query as ActionQueryString;
        if (value) {
            await historyService.removeHistory(value, archive);
            res.json({ status: true } as TrueFalseResponse);
        } else {
            res.json({ status: false } as TrueFalseResponse);
        }
        return;
    },

    _default: async (req: Request, res: Response) => {
        let history: QueueEntry[] = await historyService.getHistory();
        history = history.filter(
            ({ status }) =>
                status != QueueEntryStatus.FORWARDED &&
                status != QueueEntryStatus.CANCELLED &&
                status != QueueEntryStatus.REMOVED
        );
        const completeDir: string = (await configService.getParameter(IplayarrParameter.COMPLETE_DIR)) as string;

        const outputFormat = (await configService.getParameter(IplayarrParameter.OUTPUT_FORMAT)) as string;
        const arrCompleteDir = await configService.getParameter(IplayarrParameter.ARR_COMPLETE_DIR);

        const historyObject: SabNZBDHistoryResponse = {
            ...historySkeleton,
            slots: history
                .filter(({ status }) => status != QueueEntryStatus.FORWARDED)
                .map((item) =>
                    createHistoryEntry(
                        resolveCompleteDir(item.type, item.source, completeDir, arrCompleteDir),
                        item,
                        outputFormat
                    )
                ),
        } as SabNZBDHistoryResponse;
        res.json({ history: historyObject });
    },
};

function createHistoryEntry(completeDir: string, item: QueueEntry, outputFormat: string): SABNZBDHistoryEntryResponse {
    const failed = item.status == QueueEntryStatus.FAILED;
    const extension = item.extension ?? outputFormat;
    // libraryPath (set by downloadFacade at completion time) is preferred so
    // Sonarr/Radarr are told the real on-disk location, including any
    // LIBRARY_FOLDER_STRUCTURE show/season subfolders. Older history entries
    // written before this field existed fall back to the flat layout.
    const relativePath = item.libraryPath ?? `${item.nzbName}.${extension}`;
    const fullPath = `${completeDir}/${relativePath}`;
    const fileName = relativePath.split(/[/\\]/).pop() as string;
    return {
        ...historyEntrySkeleton,
        duplicate_key: item.pid,
        size: formatBytes((item.details?.size as number) * sizeFactor),
        nzb_name: `${item.nzbName}.nzb`,
        storage: fullPath,
        completed: (item.details?.size as number) * sizeFactor,
        downloaded: (item.details?.size as number) * sizeFactor,
        nzo_id: item.pid,
        path: fullPath,
        name: fileName,
        url: `${item.nzbName}.nzb`,
        bytes: (item.details?.size as number) * sizeFactor,
        status: failed ? HistoryStatus.FAILED : HistoryStatus.COMPLETED,
        fail_message: failed ? 'get_iplayer produced no video file' : '',
    } as SABNZBDHistoryEntryResponse;
}

export default new AbstractSabNZBDActionEndpoint(actionDirectory).handler;
