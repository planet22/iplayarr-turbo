import { Request, Response } from 'express';
import { Builder } from 'xml2js';

import searchFacade from '../../facade/searchFacade';
import appService from '../../service/appService';
import configService from '../../service/configService';
import statisticsService from '../../service/stats/StatisticsService';
import { SearchHistoryEntry, SearchHistoryResultItem } from '../../types/data/SearchHistoryEntry';
import { IplayarrParameter } from '../../types/IplayarrParameters';
import { IPlayerSearchResult, VideoType } from '../../types/IPlayerSearchResult';
import { NewzNabAttr, NewzNabSearchResponse } from '../../types/responses/newznab/NewzNabSearchResponse';
import { withSearchTrace } from '../../utils/searchTrace';
import { createNZBDownloadLink, getQualityProfile } from '../../utils/Utils';
import { expandQualityVariants, parseExtraQualities } from '../../utils/videoQuality';
import { expandVersionVariants, parseExtraVersions } from '../../utils/videoVersion';

interface SearchRequest {
    q: string;
    season?: number;
    ep?: number;
    cat?: string;
    app?: string;
}

export default async (req: Request, res: Response) => {
    const { q, season, ep, cat: catList, app: queryApp } = req.query as any as SearchRequest;
    if (queryApp) {
        await appService.touchApp(queryApp);
    }
    const app: string | undefined =
        queryApp ?? (await appService.findAppByUserAgent(req.headers['user-agent']))?.id;
    const cat: string[] | undefined = catList ? catList.split(',') : undefined;
    const searchTerm = q ?? '*';
    const { result: found, trace } = await withSearchTrace(() => searchFacade.search(searchTerm, season, ep));
    let results: IPlayerSearchResult[] = found;

    if (cat) {
        results = results.filter(({ type }) => categoriesForType(type).some((category) => cat.includes(category)));
    }

    const primaryQuality = await getQualityProfile();
    const extraQualities = parseExtraQualities(
        (await configService.getParameter(IplayarrParameter.EXTRA_VIDEO_QUALITIES)) as string,
        primaryQuality.id
    );
    results = expandQualityVariants(results, primaryQuality, extraQualities);
    results = await expandVersionVariants(results, parseExtraVersions((await configService.getParameter(IplayarrParameter.EXTRA_VERSIONS)) as string), primaryQuality);

    const historyItems: SearchHistoryResultItem[] = results.map(({ nzbName, title, type, size, pubDate, pid }) => ({
        title: nzbName ?? title,
        type,
        size,
        pubDate,
        pid,
    }));

    const historyEntry: SearchHistoryEntry = {
        term: searchTerm,
        results: results.length,
        appId: app,
        series: season,
        episode: ep,
        time: new Date().getTime(),
        items: historyItems,
        // Only what was dropped: the kept ones are already in `items`, and history is stored per search.
        trace: searchTerm == '*' ? undefined : { ...trace, candidates: trace.candidates.filter(({ kept }) => !kept) },
    };
    statisticsService.addSearch(historyEntry);

    const date: Date = new Date();
    date.setMinutes(date.getMinutes() - 720);

    const pubDate: string = date.toUTCString().replace('GMT', '+0000');

    const items = await Promise.all(
        results.map(async (result) => {
            const downloadLink = await createNZBDownloadLink(req, result, req.query.apikey as string, app);
            return {
                title: result.nzbName,
                description: result.nzbName,
                // A version variant is its own release, so it gets its own guid (Sonarr history/blocklist).
                guid: `https://www.bbc.co.uk/iplayer/episodes/${result.pid}${result.version ? `#${result.version}` : ''}`,
                comments: `https://www.bbc.co.uk/iplayer/episodes/${result.pid}`,
                size: result.size ? String(result.size * 1048576) : '2147483648',
                category: categoriesForType(result.type),
                pubDate: result.pubDate ? result.pubDate.toUTCString().replace('GMT', '+0000') : pubDate,
                'newznab:attr': [
                    ...createCategoryAttributes(result.type),
                    { $: { name: 'language', value: 'English' } },
                    { $: { name: 'files', value: '1' } },
                    { $: { name: 'grabs', value: '0' } },
                ],
                link: downloadLink,
                enclosure: {
                    $: {
                        url: downloadLink,
                        length: result.size ? String(result.size * 1048576) : '2147483648',
                        type: 'application/x-nzb',
                    },
                },
            };
        })
    );

    const searchResponse: NewzNabSearchResponse = {
        $: {
            version: '1.0',
            'xmlns:atom': 'http://www.w3.org/2005/Atom',
            'xmlns:newznab': 'http://www.newznab.com/DTD/2010/feeds/attributes/',
        },
        channel: {
            'atom:link': { $: { rel: 'self', type: 'application/rss+xml' } },
            title: 'iPlayarr Turbo',
            item: items,
        },
    } as NewzNabSearchResponse;

    const builder = new Builder({ headless: false, xmldec: { version: '1.0', encoding: 'UTF-8' } });
    const xml = builder.buildObject({ rss: searchResponse });

    res.set('Content-Type', 'application/xml');
    res.send(xml);
};

function categoriesForType(type: VideoType): string[] {
    switch (type) {
        case VideoType.MOVIE:
            return ['2000', '2040'];
        case VideoType.TV:
            return ['5000', '5040'];
        case VideoType.UNKNOWN:
            return [];
    }
}

function createCategoryAttributes(type: VideoType): NewzNabAttr[] {
    return categoriesForType(type).map((value) => ({ $: { name: 'category', value } }));
}
