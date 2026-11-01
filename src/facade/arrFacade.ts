import { ArrServiceDirectory } from '../constants/ArrServiceDirectory';
import { markAppSeen } from '../service/appSeen';
import AbstractArrService, { ArrTag } from '../service/arr/AbstractArrService';
import { App } from '../types/App';
import { CreateDownloadClientForm } from '../types/requests/form/CreateDownloadClientForm';
import { CreateIndexerForm } from '../types/requests/form/CreateIndexerForm';
import { ArrLookupResponse } from '../types/responses/arr/ArrLookupResponse';
import { DownloadClientResponse } from '../types/responses/arr/DownloadClientResponse';
import { IndexerResponse } from '../types/responses/arr/IndexerResponse';

// Every call here talks to the app, so an answer from it counts as the app being seen.
class ArrFacade {
    upsertDownloadClient(form: CreateDownloadClientForm, app: App, allowCreate: boolean): Promise<number> {
        return this.#seen(app, this.getService(app).upsertDownloadClient(form, app, allowCreate));
    }
    getDownloadClient(app: App): Promise<DownloadClientResponse | undefined> {
        return this.#seen(app, this.getService(app).getDownloadClient(app));
    }
    deleteDownloadClient(app: App): Promise<void> {
        return this.#seen(app, this.getService(app).deleteDownloadClient(app));
    }

    upsertIndexer(form: CreateIndexerForm, app: App, allowCreate: boolean): Promise<number> {
        return this.#seen(app, this.getService(app).upsertIndexer(form, app, allowCreate));
    }
    getIndexer(app: App): Promise<IndexerResponse | undefined> {
        return this.#seen(app, this.getService(app).getIndexer(app));
    }
    deleteIndexer(app: App): Promise<void> {
        return this.#seen(app, this.getService(app).deleteIndexer(app));
    }

    // A failed test (it resolves with the message) is not the app answering.
    testConnection(app: App): Promise<boolean | string> {
        return this.#seen(app, this.getService(app).testConnection(app), (result) => result === true);
    }

    getTags(app: App): Promise<ArrTag[]> {
        return this.#seen(app, this.getService(app).getTags(app));
    }
    createTag(app: App, label: string): Promise<ArrTag | undefined> {
        return this.#seen(app, this.getService(app).createTag(app, label));
    }
    search(app: App, term?: string): Promise<ArrLookupResponse[]> {
        return this.#seen(app, this.getService(app).search(app, term));
    }

    getService(app: App): AbstractArrService {
        return ArrServiceDirectory[app.type] as AbstractArrService;
    }

    #seen<T>(app: App, call: Promise<T>, answered: (result: T) => boolean = () => true): Promise<T> {
        return Promise.resolve(call).then((result) => {
            if (answered(result)) void markAppSeen(app.id);
            return result;
        });
    }
}

export default new ArrFacade();
