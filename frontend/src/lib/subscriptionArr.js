import { ref } from 'vue';
import { useModal } from 'vue-final-modal';

import ArrMatchDialog from '@/components/modals/ArrMatchDialog.vue';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';

const BASE = 'json-api/subscriptions/arr';
const UNLINK_AND_REMOVE = 'Unlink and remove it from Sonarr/Radarr';
const UNLINK_ONLY = 'Unlink only - keep it in Sonarr/Radarr';
const UNSUB_AND_REMOVE = 'Unsubscribe and remove it from Sonarr/Radarr';
const UNSUB_KEEP = 'Unsubscribe, but keep it in Sonarr/Radarr';

const fail = (title, data) => {
    dialogService.alert(title, data?.message || 'Something went wrong');
    return false;
};

// Picks one of `items` through the shared select dialog; undefined if cancelled.
const pick = async (title, text, items, label) => {
    const labels = items.map(label);
    const choice = await dialogService.select(title, text, undefined, labels);
    return choice ? items[labels.indexOf(choice)] : undefined;
};

// Opens the poster-card match dialog; resolves with { match, rootFolderPath, qualityProfileId }, or
// undefined if cancelled.
const chooseMatch = (app, term) =>
    new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const modal = useModal({
            component: ArrMatchDialog,
            attrs: {
                app,
                term,
                onSelect: (choice) => {
                    finish(choice);
                    modal.close();
                },
                onClosed: () => finish(undefined),
            },
        });
        modal.open();
    });

// Add a subscription's show to Sonarr/Radarr. Returns true when the subscription was linked.
export async function linkToArr(subscription) {
    const apps = await ipFetch(`${BASE}/apps`);
    if (!apps.ok) return fail('Unable to load apps', apps.data);
    if (!apps.data.length) return fail('No Sonarr or Radarr', { message: 'Add a Sonarr or Radarr app first.' });
    const app = apps.data.length === 1
        ? apps.data[0]
        : await pick('Add to which app?', subscription.title, apps.data, ({ name }) => name);
    if (!app) return false;

    const choice = await chooseMatch(app, subscription.title);
    if (!choice) return false;

    const { ok, data } = await ipFetch(`${BASE}/${subscription.id}`, 'POST', {
        appId: app.id,
        externalId: choice.match.externalId,
        title: choice.match.title,
        rootFolderPath: choice.rootFolderPath,
        qualityProfileId: choice.qualityProfileId,
    });
    return ok ? true : fail('Unable to add', data);
}

// Names of the Sonarr/Radarr apps, by id, for labelling a linked subscription. Shared and loaded
// once; a name that can't be resolved (app removed, request failed) falls back to a generic label.
const appNames = ref({});
let appNamesLoaded = false;

export function useArrAppNames() {
    const loadAppNames = async () => {
        if (appNamesLoaded) return;
        try {
            const { ok, data } = await ipFetch(`${BASE}/apps`);
            if (ok) {
                appNames.value = Object.fromEntries(data.map(({ id, name }) => [id, name]));
                appNamesLoaded = true;
            }
        } catch {
            // Keep the fallback label.
        }
    };
    const arrAppName = (appId) => appNames.value[appId] ?? 'Sonarr/Radarr';
    return { loadAppNames, arrAppName };
}

// True when at least one Sonarr/Radarr app is configured to add to.
export async function hasArrApps() {
    try {
        const apps = await ipFetch(`${BASE}/apps`);
        return apps.ok && apps.data.length > 0;
    } catch {
        return false;
    }
}

// Offered right after subscribing: silently skipped when there is no Sonarr/Radarr to add to, so it
// never gets in the way. Returns true when the subscription was linked.
export async function offerArrLink(subscription) {
    if (!(await hasArrApps())) return false;
    const wanted = await dialogService.confirm(
        'Add to Sonarr/Radarr?',
        `Also add ${subscription.title} to Sonarr or Radarr? You can do this later from the Subscriptions page.`
    );
    return wanted ? linkToArr(subscription) : false;
}

// Unlink a subscription from Sonarr/Radarr, optionally removing the entry iPlayarr added there.
export async function unlinkFromArr(subscription, { unsubscribing = false } = {}) {
    const { arr } = subscription;
    let remove = false;
    if (arr.addedByUs) {
        // When unsubscribing, this is the only prompt, so the options say so.
        const [removeLabel, keepLabel] = unsubscribing
            ? [UNSUB_AND_REMOVE, UNSUB_KEEP]
            : [UNLINK_AND_REMOVE, UNLINK_ONLY];
        const choice = await dialogService.select(
            unsubscribing ? 'Unsubscribe' : 'Unlink from Sonarr/Radarr',
            `"${arr.title}" was added by iPlayarr. What should happen to it in Sonarr/Radarr? Files on disk are always kept.`,
            undefined,
            [removeLabel, keepLabel]
        );
        // Cancel backs out of the whole action.
        if (!choice) return false;
        remove = choice === removeLabel;
    }
    const { ok, data } = await ipFetch(`${BASE}/${subscription.id}?remove=${remove}`, 'DELETE');
    return ok ? true : fail('Unable to unlink', data);
}
