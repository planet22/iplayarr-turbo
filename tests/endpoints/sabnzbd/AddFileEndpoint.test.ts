import { Request, Response } from 'express';

import handler from '../../../src/endpoints/sabnzbd/AddFileEndpoint';
import nzbFacade from '../../../src/facade/nzbFacade';
import appService from '../../../src/service/appService';
import queueService from '../../../src/service/queueService';
import statisticsService from '../../../src/service/stats/StatisticsService';
import { App } from '../../../src/types/App';
import { AppType } from '../../../src/types/AppType';
import { QueueEntrySource } from '../../../src/types/enums/QueueEntrySource';
import { VideoType } from '../../../src/types/IPlayerSearchResult';

jest.mock('../../../src/facade/nzbFacade');
jest.mock('../../../src/service/appService');
jest.mock('../../../src/service/queueService');
jest.mock('../../../src/service/loggingService');

const toFile = (xml: string) => ({ buffer: Buffer.from(xml, 'utf-8') }) as Express.Multer.File;

// Meta entries carry their value in a literal "_" attribute, not element text
// content - matches how this project's own Builder (DownloadNZBEndpoint.ts)
// actually encodes NZBMetaEntry - confirmed by running that same Builder
// against a sample NZBMetaEntry[] and inspecting the output XML.
const VALID_NZB_XML = `<?xml version="1.0"?>
<nzb>
    <head>
        <title>m0012345</title>
        <meta type="nzbName" _="My Show S01E01"/>
        <meta type="type" _="${VideoType.TV}"/>
        <meta type="app" _="app-123"/>
    </head>
</nzb>`;

const VALID_NZB_XML_WITH_LIBRARY_META = `<?xml version="1.0"?>
<nzb>
    <head>
        <title>m0012345</title>
        <meta type="nzbName" _="My Show S01E01"/>
        <meta type="type" _="${VideoType.TV}"/>
        <meta type="app" _="app-123"/>
        <meta type="title" _="My Show"/>
        <meta type="series" _="1"/>
        <meta type="episode" _="1"/>
        <meta type="episodeTitle" _="The Episode"/>
        <meta type="channel" _="BBC One"/>
        <meta type="pubDate" _="2024-01-02T03:04:05.000Z"/>
    </head>
</nzb>`;

// Well-formed XML, but missing the <title> AddFileEndpoint requires - triggers
// the "Invalid iPlayarr Turbo NZB File" rejection branch (as opposed to a real XML
// parse error). This branch is specifically for NZBs iplayarr-turbo didn't
// generate itself (hence "invalid"), so unlike the attribute-based meta
// format above, it reads the "name" meta's value as ordinary element text -
// the conventional format real-world NZB files use.
const NZB_MISSING_TITLE_XML = `<?xml version="1.0"?>
<nzb>
    <head>
        <meta type="name">Some Fallback Name</meta>
    </head>
</nzb>`;

const buildApp = (overrides: Partial<App> = {}): App => ({
    id: 'app-1',
    type: AppType.SABNZBD,
    name: 'Test App',
    url: 'http://localhost:8080',
    api_key: 'key',
    priority: 0,
    iplayarr: { host: 'localhost', port: 4404, useSSL: false },
    ...overrides,
});

describe('AddFileEndpoint', () => {
    let req: Partial<Request>;
    let res: Partial<Response>;

    beforeEach(() => {
        jest.clearAllMocks();
        req = { headers: {} };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            send: jest.fn().mockReturnThis(),
        };
    });

    it('queues a valid NZB file and responds with its pid', async () => {
        req.files = [toFile(VALID_NZB_XML)] as any;

        await handler(req as Request, res as Response);

        expect(queueService.addToQueue).toHaveBeenCalledWith(
            'm0012345',
            'My Show S01E01',
            VideoType.TV,
            'app-123',
            undefined,
            QueueEntrySource.NZB
        );
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ status: true, nzo_ids: ['m0012345'] });
    });

    it('carries structured library metadata onto the queue entry when present', async () => {
        req.files = [toFile(VALID_NZB_XML_WITH_LIBRARY_META)] as any;

        await handler(req as Request, res as Response);

        expect(queueService.addToQueue).toHaveBeenCalledWith(
            'm0012345',
            'My Show S01E01',
            VideoType.TV,
            'app-123',
            {
                title: 'My Show',
                series: 1,
                episode: 1,
                episodeTitle: 'The Episode',
                channel: 'BBC One',
                pubDate: '2024-01-02T03:04:05.000Z',
            },
            QueueEntrySource.NZB
        );
    });

    it('responds 500 when the NZB is invalid and no configured app can take it', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        (appService.getAllApps as jest.Mock).mockResolvedValue([]);

        await handler(req as Request, res as Response);

        expect(queueService.addToQueue).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            status: false,
            error: 'Invalid iPlayarr Turbo NZB File',
        });
    });

    it('forwards the file to the first app that passes a connection test', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        const app = buildApp();
        (appService.getAllApps as jest.Mock).mockResolvedValue([app]);
        (nzbFacade.testConnection as jest.Mock).mockResolvedValue(true);
        (nzbFacade.addFile as jest.Mock).mockResolvedValue({ status: 201, data: 'forwarded-ok' });

        await handler(req as Request, res as Response);

        expect(nzbFacade.testConnection).toHaveBeenCalledWith(
            app.type.toString(),
            app.url,
            app.api_key,
            app.username,
            app.password
        );
        expect(nzbFacade.addFile).toHaveBeenCalledWith(app, req.files, 'Some Fallback Name');
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.send).toHaveBeenCalledWith('forwarded-ok');
    });

    it('responds 500 on genuinely malformed XML (real parse error, not just a missing title)', async () => {
        req.files = [toFile('<nzb><head><title>unclosed')] as any;
        (appService.getAllApps as jest.Mock).mockResolvedValue([]);

        await handler(req as Request, res as Response);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ status: false })
        );
    });

    it('logs and moves on when a passing app still throws while adding the file', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        const app = buildApp();
        (appService.getAllApps as jest.Mock).mockResolvedValue([app]);
        (nzbFacade.testConnection as jest.Mock).mockResolvedValue(true);
        (nzbFacade.addFile as jest.Mock).mockRejectedValue(new Error('upstream boom'));

        await handler(req as Request, res as Response);

        expect(nzbFacade.addFile).toHaveBeenCalledTimes(1);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            status: false,
            error: 'Invalid iPlayarr Turbo NZB File',
        });
    });

    it('attributes a failed grab to the app resolved from the request User-Agent', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        req.headers = { 'user-agent': 'Sonarr/4.0.0.0 (linux)' };
        (appService.getAllApps as jest.Mock).mockResolvedValue([]);
        (appService.findAppByUserAgent as jest.Mock).mockResolvedValue(buildApp({ id: 'sonarr-1' }));
        const addFailedGrabSpy = jest.spyOn(statisticsService, 'addFailedGrab');

        await handler(req as Request, res as Response);

        expect(appService.findAppByUserAgent).toHaveBeenCalledWith('Sonarr/4.0.0.0 (linux)');
        expect(addFailedGrabSpy).toHaveBeenCalledWith(
            expect.objectContaining({ appId: 'sonarr-1' })
        );
    });

    it('skips apps that fail their connection test and falls back to 500', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        const app = buildApp();
        (appService.getAllApps as jest.Mock).mockResolvedValue([app]);
        (nzbFacade.testConnection as jest.Mock).mockResolvedValue(false);

        await handler(req as Request, res as Response);

        expect(nzbFacade.addFile).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(500);
    });

    it('only considers SABNZBD/NZBGET apps, sorted by priority', async () => {
        req.files = [toFile(NZB_MISSING_TITLE_XML)] as any;
        const sonarr = buildApp({ id: 'sonarr', type: AppType.SONARR, priority: -1 });
        const lowPriority = buildApp({ id: 'low', priority: 5 });
        const highPriority = buildApp({ id: 'high', priority: 1 });
        (appService.getAllApps as jest.Mock).mockResolvedValue([sonarr, lowPriority, highPriority]);
        (nzbFacade.testConnection as jest.Mock).mockResolvedValue(true);
        (nzbFacade.addFile as jest.Mock).mockResolvedValue({ status: 200, data: 'ok' });

        await handler(req as Request, res as Response);

        expect(nzbFacade.testConnection).not.toHaveBeenCalledWith(
            sonarr.type.toString(),
            sonarr.url,
            sonarr.api_key,
            sonarr.username,
            sonarr.password
        );
        // highPriority (priority 1) sorts before lowPriority (priority 5)
        expect((nzbFacade.addFile as jest.Mock).mock.calls[0][0]).toBe(highPriority);
    });
});
