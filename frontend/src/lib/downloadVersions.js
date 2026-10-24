import { browseFetch } from '@/lib/browse';
import { useDownloadVersionPrefs } from '@/lib/downloadVersionPrefs';
import { useQualityBadges } from '@/lib/qualityBadges';
import { subscriptionVersions } from '@/lib/subscriptions';

// Audio described / signed handling is only on while the AD / Signed badge setting is (Settings > General > Appearance);
// without it everything downloads as the standard version, as before.
export const versionsActive = () => useQualityBadges().state.versions;
export const askAboutVersions = () => versionsActive() && useDownloadVersionPrefs().state.ask;
export const preferredVersion = () => (versionsActive() ? useDownloadVersionPrefs().state.preferred : '');

// Episodes the server has not told us the audio described / signed versions of yet (programme page episodes not
// in its cache) get them here, so a batch download can use them. Returns the items, marked.
export const resolveEpisodeVersions = async (items) => {
    if (!versionsActive()) return items;
    const pending = items.filter((item) => item.versions === undefined && !item.versionsChecked).map((item) => item.pid);
    const found = {};
    for (let i = 0; i < pending.length; i += 10) {
        try {
            Object.assign(found, await browseFetch(`versions?pids=${pending.slice(i, i + 10).join(',')}`));
        } catch {
            // Those episodes just download as the standard version.
        }
    }
    return items.map((item) =>
        found[item.pid] ? { ...item, versionsChecked: true, ...(found[item.pid].length ? { versions: found[item.pid] } : {}) } : item
    );
};

// The extra versions a batch can offer: those at least one item has, when asking is on. A result that already is a
// version (a Search row for the audio described cut) is not offered another.
export const offeredVersions = (items) =>
    askAboutVersions() ? subscriptionVersions.filter(({ id }) => items.some((item) => !item.version && item.versions?.includes(id))) : [];

// What the batch confirmation starts on: the default version, when the batch offers it.
export const initialVersionKey = (offered) => {
    const preferred = preferredVersion();
    return preferred && offered.some(({ id }) => id === preferred) ? `only:${preferred}` : '';
};

// The choice that applies to the batch: the one picked in the dialog, or the default when nothing was offered.
export const batchVersionKey = (choice, offered) => {
    if (offered.length) return choice.version ?? '';
    const preferred = preferredVersion();
    return preferred ? `only:${preferred}` : '';
};

// A version choice is '' (standard only), 'only:<id>' (that version, the standard one where an item has none),
// 'also:<id>' (standard and that version) or 'also:all'. This turns it into the downloads to make:
// [{ item, version }], an item that already is a version being downloaded as it is.
export const planDownloads = (items, key) => {
    const [kind, id] = key.split(':');
    const wanted = !kind ? [] : id === 'all' ? subscriptionVersions.map((version) => version.id) : [id];
    return items.flatMap((item) => {
        if (item.version) return [{ item, version: item.version }];
        const has = wanted.filter((version) => item.versions?.includes(version));
        const standard = kind !== 'only' || has.length === 0;
        return [...(standard ? [{ item, version: undefined }] : []), ...has.map((version) => ({ item, version }))];
    });
};

// The version a download made without a dialog uses: the default, when the item has it.
export const quickVersion = (item) => {
    const preferred = preferredVersion();
    return preferred && !item.version && item.versions?.includes(preferred) ? preferred : undefined;
};
