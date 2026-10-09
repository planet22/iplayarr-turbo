import { App } from '../types/App';
import appService from './appService';
import arrLibraryService, { ArrAddOptions, ArrLibraryItem, ArrQualityProfile, ArrRootFolder } from './arr/ArrLibraryService';
import subscriptionService from './subscriptionService';

export class SubscriptionArrError extends Error {}

export interface LinkRequest extends ArrAddOptions {
    appId: string;
    externalId: number;
    title: string;
}

// Links a subscription to a Sonarr/Radarr library entry: add the show there, and later optionally
// remove it again. Independent of subscribe/unsubscribe, which are unchanged.
class SubscriptionArrService {
    async #getApp(appId: string): Promise<App> {
        const app = await appService.getApp(appId);
        if (!app || !arrLibraryService.supports(app)) {
            throw new SubscriptionArrError('That app is not a configured Sonarr or Radarr');
        }
        return app;
    }

    async listApps(): Promise<Pick<App, 'id' | 'name' | 'type'>[]> {
        return (await appService.getAllApps())
            .filter((app) => arrLibraryService.supports(app))
            .map(({ id, name, type }) => ({ id, name, type }));
    }

    async lookup(appId: string, term: string): Promise<ArrLibraryItem[]> {
        return arrLibraryService.lookup(await this.#getApp(appId), term);
    }

    async options(appId: string): Promise<{ rootFolders: ArrRootFolder[]; qualityProfiles: ArrQualityProfile[] }> {
        const app = await this.#getApp(appId);
        const [rootFolders, qualityProfiles] = await Promise.all([
            arrLibraryService.getRootFolders(app),
            arrLibraryService.getQualityProfiles(app),
        ]);
        return { rootFolders, qualityProfiles };
    }

    async link(subscriptionId: string, request: LinkRequest): Promise<void> {
        const subscription = (await subscriptionService.list()).find((s) => s.id === subscriptionId);
        if (!subscription) throw new SubscriptionArrError('Subscription not found');
        if (subscription.arr) throw new SubscriptionArrError('This subscription is already linked - unlink it first');
        const app = await this.#getApp(request.appId);
        const { id, created } = await arrLibraryService.add(app, request.externalId, request);
        await subscriptionService.setArrLink(subscriptionId, {
            appId: app.id,
            arrId: id,
            title: request.title,
            addedByUs: created,
        });
    }

    // Always clears the link. Removes the entry from Sonarr/Radarr only when asked to and only if
    // iPlayarr added it.
    async unlink(subscriptionId: string, removeFromArr: boolean): Promise<void> {
        const subscription = (await subscriptionService.list()).find((s) => s.id === subscriptionId);
        if (!subscription?.arr) throw new SubscriptionArrError('This subscription is not linked');
        const { appId, arrId, addedByUs } = subscription.arr;
        if (removeFromArr && addedByUs) {
            const app = await this.#getApp(appId);
            await arrLibraryService.remove(app, arrId);
        }
        await subscriptionService.setArrLink(subscriptionId, undefined);
    }
}

export default new SubscriptionArrService();
