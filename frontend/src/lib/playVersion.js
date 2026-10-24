import dialogService from '@/lib/dialogService';
import { useDownloadVersionPrefs } from '@/lib/downloadVersionPrefs';
import { ipFetch } from '@/lib/ipFetch';
import { playInPip } from '@/lib/pipPlayer';
import { useQualityBadges } from '@/lib/qualityBadges';

const STANDARD = 'Standard version';

// What the play button does for a programme. While the AD / Signed badges are on, and the native stream client (the
// only one that can play another cut) is in use, a programme with audio described / signed versions asks which to
// play, or plays the default one from Settings > Streaming. Either way the player offers the other versions too, so
// it can be changed while watching. `known` is the version ids the caller already has (a search result or episode),
// else they are looked up.
export const playProgramme = async (pid, title, known) => {
    const { state } = useDownloadVersionPrefs();
    if (!useQualityBadges().state.versions || !state.nativeStream) return playInPip(pid, title);

    let available = [];
    try {
        const { ok, data } = await ipFetch(`json-api/programme-versions?pid=${encodeURIComponent(pid)}`);
        if (ok && Array.isArray(data)) available = data.map(({ id, name }) => ({ id, name }));
    } catch {
        // Plays the standard version.
    }
    if (known && !known.length) available = [];
    if (available.length === 0) return playInPip(pid, title);

    let version = available.some(({ id }) => id === state.playPreferred) ? state.playPreferred : '';
    if (state.playAsk) {
        // The default comes first, so it is the one pre-selected.
        const options = [STANDARD, ...available.map(({ name }) => name)];
        const preferredName = available.find(({ id }) => id === version)?.name;
        if (preferredName) options.unshift(options.splice(options.indexOf(preferredName), 1)[0]);
        const choice = await dialogService.select('Play which version?', title, undefined, options);
        if (!choice) return undefined;
        version = available.find(({ name }) => name === choice)?.id ?? '';
    }
    return playInPip(pid, title, false, version, available);
};
