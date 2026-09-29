import { AxiosResponse } from 'axios';
import { v4 } from 'uuid';

import historyService from '../service/historyService';
import loggingService from '../service/loggingService';
import NZBGetService from '../service/nzb/NZBGetService';
import SabNZBDService from '../service/nzb/SabNZBDService';
import videoEventService from '../service/videoEventService';
import { App } from '../types/App';
import { VideoType } from '../types/IPlayerSearchResult';
import { QueueEntry } from '../types/QueueEntry';
import { QueueEntryStatus } from '../types/responses/sabnzbd/QueueResponse';
import { VideoEventType } from '../types/VideoEvent';

class NZBFacade {
    async testConnection(
        type: string,
        url: string,
        apiKey?: string,
        username?: string,
        password?: string
    ): Promise<string | boolean> {
        const service = this.#getService(type);
        return service.testConnection(url, { username, password, apiKey });
    }

    #getService(type: string) {
        switch (type) {
            case 'sabnzbd':
            default:
                return SabNZBDService;
            case 'nzbget':
                return NZBGetService;
        }
    }

    async addFile(app: App, files: Express.Multer.File[], nzbName?: string): Promise<AxiosResponse> {
        loggingService.log(`Received Real NZB, trying to add ${nzbName} to ${app.name}`);
        const pid = this.createRelayEntry(app, nzbName);
        const service = this.#getService(app.type.toString().toLowerCase());
        try {
            const response = await service.addFile(app, files);
            videoEventService.record(VideoEventType.NZB_RELAYED, `Relayed "${nzbName}" to ${app.name}`, { pid });
            return response;
        } catch (err) {
            videoEventService.record(
                VideoEventType.NZB_RELAY_FAILED,
                `Failed to relay "${nzbName}" to ${app.name}`,
                { pid, level: 'error' }
            );
            throw err;
        }
    }

    createRelayEntry({ id: appId }: App, nzbName?: string): string {
        const pid = v4();
        const relayEntry: QueueEntry = {
            pid,
            status: QueueEntryStatus.FORWARDED,
            nzbName: nzbName || 'Unknown',
            type: VideoType.UNKNOWN,
            appId,
            details: {
                start: new Date(),
            },
        };
        historyService.addRelay(relayEntry);
        return pid;
    }
}

export default new NZBFacade();
