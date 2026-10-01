import { v4 } from 'uuid';

import arrFacade from '../facade/arrFacade';
import nzbFacade from '../facade/nzbFacade';
import { App } from '../types/App';
import { appCategories, AppFeature, appFeatures, AppType } from '../types/AppType';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { QueuedStorage } from '../types/QueuedStorage';
import { CreateDownloadClientForm } from '../types/requests/form/CreateDownloadClientForm';
import { CreateIndexerForm } from '../types/requests/form/CreateIndexerForm';
import configService from './configService';
import socketService from './socketService';
import userAgentMappingService from './userAgentMappingService';

const storage: QueuedStorage = new QueuedStorage();

const appService = {
    getAllApps: async (): Promise<App[]> => {
        return (await storage.getItem('apps')) || [];
    },

    getApp: async (id: string): Promise<App | undefined> => {
        const allApps: App[] = await appService.getAllApps();
        return allApps.find(({ id: app_id }) => app_id == id);
    },

    findAppByUserAgent: async (userAgent?: string): Promise<App | undefined> => {
        if (!userAgent) {
            return undefined;
        }
        const mappings = await userAgentMappingService.getAllMappings();
        const mapping = mappings.find(({ userAgent: match }) => userAgent.includes(match));
        if (!mapping) {
            await userAgentMappingService.recordSeenUserAgent(userAgent);
            return undefined;
        }
        await userAgentMappingService.touchMapping(mapping.id);
        if (!mapping.appName) {
            return undefined;
        }
        const allApps: App[] = await appService.getAllApps();
        return allApps.find(({ name }) => name.toLowerCase() == mapping.appName.toLowerCase());
    },

    removeApp: async (id: string): Promise<boolean> => {
        let allApps: App[] = await appService.getAllApps();
        allApps = allApps.filter(({ id: app_id }) => app_id != id);
        await storage.setItem('apps', allApps);
        return true;
    },

    updateApp: async (form: Partial<App>): Promise<App | undefined> => {
        if (form.id) {
            let app: App | undefined = await appService.getApp(form.id);
            if (app) {
                app = {
                    ...app,
                    ...form,
                };
                await appService.removeApp(form.id);
                await appService.addApp(app);
                return app;
            }
        }
        return;
    },

    addApp: async (form: App): Promise<App | undefined> => {
        if (!form.id) {
            const id = v4();
            form.id = id;
        }
        const allApps: App[] = await appService.getAllApps();
        allApps.push(form);
        await storage.setItem('apps', allApps);
        return form;
    },

    createUpdateIntegrations: async (input: App, allowCreate: boolean = true): Promise<App> => {
        let form = input;
        const features: AppFeature[] = appFeatures[form.type];
        // If a later feature (e.g. Indexer) fails after an earlier one (e.g. Download Client) was
        // newly created in this same call, roll that creation back too - otherwise it's left
        // orphaned in the *arr (no id stored locally to ever manage/delete it again), and the next
        // attempt fails on the *arr's own name-uniqueness check instead of actually retrying.
        const hadDownloadClientId = !!form.download_client?.id;
        const hadIndexerId = !!form.indexer?.id;

        for (const feature of features) {
            try {
                form = await createUpdateFeature[feature](form, allowCreate);
            } catch (err) {
                if (!hadDownloadClientId && form.download_client?.id) {
                    await arrFacade.deleteDownloadClient(form).catch(() => undefined);
                }
                if (!hadIndexerId && form.indexer?.id) {
                    await arrFacade.deleteIndexer(form).catch(() => undefined);
                }
                throw err;
            }
        }

        await appService.updateApp(form);
        return form;
    },

    updateApiKey: async (): Promise<void> => {
        const allApps: App[] = await appService.getAllApps();
        const apiKeyApps: App[] = allApps.filter(({ type }) => appFeatures[type].includes(AppFeature.CALLBACK));

        apiKeyApps.forEach((app: App) => {
            socketService.emit('app_update_status', { id: app.id, status: 'In Progress' });

            appService
                .createUpdateIntegrations(app)
                .then(() => {
                    socketService.emit('app_update_status', { id: app.id, status: 'Complete' });
                })
                .catch((err) => {
                    socketService.emit('app_update_status', { id: app.id, status: 'Error', message: err.message });
                });
        });
    },

    testAppConnection: async (form: App): Promise<string | boolean> => {
        switch (form.type) {
            case AppType.PROWLARR:
            case AppType.RADARR:
            case AppType.SONARR: {
                return await arrFacade.testConnection(form);
            }
            case AppType.NZBGET:
            case AppType.SABNZBD: {
                return await nzbFacade.testConnection(
                    form.type.toString().toLowerCase(),
                    form.url,
                    form.api_key,
                    form.username,
                    form.password
                );
            }
            default:
                return false;
        }
    },
};

const createUpdateFeature: Record<AppFeature, (form: App, allowCreate: boolean) => Promise<App>> =
    {
        [AppFeature.DOWNLOAD_CLIENT]: async (
            form: App,
            allowCreate: boolean = true
        ): Promise<App> => {
            const API_KEY: string = (await configService.getParameter(IplayarrParameter.API_KEY)) as string;

            if (form.download_client?.name) {
                const createDownloadClientForm: CreateDownloadClientForm = {
                    name: form.download_client.name,
                    host: form.iplayarr.host as string,
                    port: form.iplayarr.port as number,
                    useSSL: form.iplayarr.useSSL,
                    apiKey: API_KEY,
                    tags: form.tags ?? [],
                    priority: form.download_client.priority,
                };

                try {
                    const id = await arrFacade.upsertDownloadClient(
                        createDownloadClientForm,
                        form,
                        allowCreate
                    );
                    form.download_client.id = id;
                } catch (err: any) {
                    throw {
                        message: err.message,
                        type: 'download_client', // Add the type
                    };
                }
            } else if (form.download_client?.id) {
                // Name was cleared on an app that already has one - delete it from the *arr instead of just forgetting it locally.
                try {
                    await arrFacade.deleteDownloadClient(form);
                } catch (err: any) {
                    throw {
                        message: err.message,
                        type: 'download_client',
                    };
                }
                form.download_client = undefined;
            }
            return form;
        },
    [AppFeature.INDEXER]: async (form: App, allowCreate: boolean = true): Promise<App> => {
            const API_KEY: string = (await configService.getParameter(IplayarrParameter.API_KEY)) as string;

            if (form.download_client?.id && form.indexer?.name) {
                const useSSL: boolean =
                    typeof form.iplayarr.useSSL === 'boolean' ? form.iplayarr.useSSL : form.iplayarr.useSSL === 'true';
                const createIndexerForm: CreateIndexerForm = {
                    appId: form.id,
                    name: form.indexer.name,
                    downloadClientId: form.download_client.id,
                    url: `http${useSSL ? 's' : ''}://${form.iplayarr.host}:${form.iplayarr.port}`,
                    apiKey: API_KEY,
                    categories: appCategories[form.type],
                    priority: form.indexer.priority,
                    tags: form.tags ?? [],
                };

                try {
                    const id = await arrFacade.upsertIndexer(createIndexerForm, form, allowCreate);
                    form.indexer.id = id;
                } catch (err: any) {
                    throw {
                        message: err.message,
                        type: 'indexer', // Add the type
                    };
                }
            } else if (form.indexer?.id) {
                // Name was cleared on an app that already has one - delete it from the *arr instead of just forgetting it locally.
                try {
                    await arrFacade.deleteIndexer(form);
                } catch (err: any) {
                    throw {
                        message: err.message,
                        type: 'indexer',
                    };
                }
                form.indexer = undefined;
            }
            return form;
        },
        [AppFeature.CALLBACK]: async (form: App): Promise<App> => {
            return form;
        },
        [AppFeature.API_KEY]: async (form: App): Promise<App> => {
            return form;
        },
        [AppFeature.USERNAME_PASSWORD]: async (form: App): Promise<App> => {
            return form;
        },
        [AppFeature.PRIORITY]: async (form: App): Promise<App> => {
            return form;
        },
        [AppFeature.LINK]: async (form: App): Promise<App> => {
            return form;
        },
        [AppFeature.TAGS]: async (form: App): Promise<App> => {
            return form;
        },
    };

export default appService;
