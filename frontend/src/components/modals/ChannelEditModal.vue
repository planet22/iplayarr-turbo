<template>
    <IPlayarrModal
        class="channelEditModal"
        :title="channel ? `Customise ${channel.title}` : 'Add channel'"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        :confirm-label="saving ? 'Saving...' : 'Save'"
        @confirm="save"
    >
        <TextInput v-model="form.name" name="Name" tooltip="Shown on the Channels page, in Jellyfin and in the library" />
        <template v-if="isCustom">
            <TextInput
                v-model="form.streamUrl"
                name="Stream URL"
                tooltip="An http(s) link to the live stream (HLS .m3u8, DASH .mpd or a plain stream)"
                placeholder="https://example.com/live/stream.m3u8"
            />
            <div class="testRow">
                <span v-if="channel?.lastTest && !testResult" :class="['lastTest', channel.lastTest.ok ? 'ok' : 'bad']">
                    <font-awesome-icon :icon="['fas', channel.lastTest.ok ? 'circle-check' : 'triangle-exclamation']" />
                    {{ channel.lastTest.ok ? 'Last tested OK' : `Last test failed: ${channel.lastTest.message || 'no answer'}` }}
                    ({{ new Date(channel.lastTest.at).toLocaleString() }})
                </span>
                <button type="button" class="clickable" :disabled="testing || !form.streamUrl" @click="testStream">
                    <font-awesome-icon :icon="['fas', testing ? 'circle-notch' : 'vial']" :spin="testing" />
                    Test stream
                </button>
            </div>
            <fieldset v-if="testResult" :class="['testResult', testResult.ok ? 'ok' : 'bad']">
                <legend>Test response</legend>
                <template v-if="testResult.ok">
                    <strong>{{ kindLabel(testResult.kind) }}</strong>
                    <span v-if="testResult.live !== undefined"> - {{ testResult.live ? 'live' : 'not live (on demand)' }}</span>
                    <div v-if="testResult.variants?.length">
                        Quality:
                        {{
                            testResult.variants
                                .map((v) => [v.resolution, v.bandwidth && `${Math.round(v.bandwidth / 1000)} kbps`].filter(Boolean).join(' '))
                                .join(', ')
                        }}
                    </div>
                    <div v-if="testResult.audio?.length">Audio: {{ testResult.audio.join(', ') }}</div>
                    <div v-if="testResult.subtitles?.length">Subtitles: {{ testResult.subtitles.join(', ') }}</div>
                    <div v-if="testResult.message">{{ testResult.message }}</div>
                </template>
                <template v-else>{{ testResult.message || 'The stream did not work' }}</template>
            </fieldset>
        </template>
        <TextInput v-model="form.color" name="Colour" tooltip="Logo background, like #654355" placeholder="#654355">
            <template #after>
                <input v-model="pickerColor" class="colourPicker" type="color" title="Pick a colour" />
            </template>
        </TextInput>
        <TextInput
            v-model="form.logoText"
            name="Text on logo"
            tooltip="Optional short text under the logo (24 characters at most)"
            placeholder="e.g. HD"
        />
        <div class="logoGroup">
            <label>Logo</label>
            <div class="logoRow">
                <!-- A chosen file is shown at once, scaled to fill the tile as large as it fits, on the chosen colour. -->
                <div v-if="pendingPreview" class="logoPreview pending" :style="{ backgroundColor: previewColor }">
                    <img :src="pendingPreview" alt="Logo preview" />
                </div>
                <img v-else-if="logoPreview" class="logoPreview" :src="logoPreview" alt="Logo preview" />
                <div class="logoActions">
                    <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden @change="pickLogo" />
                    <button type="button" class="clickable" @click="fileInput.click()">
                        <font-awesome-icon :icon="['fas', 'upload']" /> Upload logo
                    </button>
                    <button v-if="hasUploadedLogo || pendingFile" type="button" class="clickable" @click="removeLogo">
                        <font-awesome-icon :icon="['fas', 'trash']" /> Remove uploaded logo
                    </button>
                    <div class="hint">PNG, JPG, WebP or SVG. 200-2000px each side, no more than 3:1, up to 2MB.</div>
                    <div v-if="logoError" class="logoError">{{ logoError }}</div>
                </div>
            </div>
        </div>
        <button type="button" class="moreToggle" :aria-expanded="showMore" @click="showMore = !showMore">
            <font-awesome-icon :icon="['fas', showMore ? 'chevron-down' : 'chevron-right']" /> More options
        </button>
        <!-- v-show, not v-if: what is in here is still saved when it is folded away. -->
        <div v-show="showMore" class="moreOptions">
            <template v-if="isCustom">
                <SelectInput
                    v-model="form.streamType"
                    name="Stream type"
                    tooltip="Auto trusts the URL. Testing the stream suggests the right type."
                    :options="streamTypes"
                />
                <TextInput
                    v-model="form.group"
                    name="Group"
                    tooltip="Groups channels together in Jellyfin (default: Custom)"
                    placeholder="Custom"
                />
                <TextInput
                    v-model="form.headers"
                    name="Request headers"
                    tooltip="One per line as Name: value. Streams with headers are played through ffmpeg (as MKV)."
                    placeholder="User-Agent: MyPlayer/1.0&#10;Referer: https://example.com/"
                    multiline
                    monospace
                />
            </template>
            <TextInput
                v-model="form.channelNumber"
                name="Channel number"
                tooltip="Jellyfin's channel number for this channel. Blank follows the Channels page order."
                type-override="number"
            />
        </div>
        <div v-if="channel" class="dangerRow">
            <button v-if="!isCustom && channel.customised" type="button" class="clickable" @click="reset">
                <font-awesome-icon :icon="['fas', 'rotate-left']" /> Reset to defaults
            </button>
            <button v-if="isCustom" type="button" class="clickable danger" @click="remove">
                <font-awesome-icon :icon="['fas', 'trash']" /> Delete channel
            </button>
        </div>
    </IPlayarrModal>
</template>

<script setup>
import { computed, defineEmits, defineProps, onMounted, ref } from 'vue';

import dialogService from '@/lib/dialogService';
import { ipFetch, ipUpload } from '@/lib/ipFetch';
import toastService from '@/lib/toastService';
import { getThumbnailUrl } from '@/lib/utils';

import SelectInput from '../common/form/SelectInput.vue';
import TextInput from '../common/form/TextInput.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const props = defineProps({
    // The tile being edited (a built-in or custom channel), or nothing to add a channel.
    channel: { type: Object, required: false, default: undefined },
});
const emit = defineEmits(['saved']);

const API = 'json-api/live-channels';
const DEFAULT_COLOR = '#654355';
const streamTypes = [
    { key: 'auto', value: 'Auto' },
    { key: 'hls', value: 'HLS' },
    { key: 'dash', value: 'DASH' },
    { key: 'direct', value: 'Plain stream' },
];

const isCustom = computed(() => !props.channel || props.channel.custom);
const form = ref({
    name: props.channel?.title ?? '',
    streamUrl: '',
    color: props.channel?.color ?? '',
    logoText: props.channel?.logoText ?? '',
    channelNumber: props.channel?.channelNumber ? String(props.channel.channelNumber) : '',
    group: props.channel?.group ?? '',
    streamType: props.channel?.streamType ?? 'auto',
    headers: '',
});
const saving = ref(false);
// The less-used fields (stream type, group, headers, channel number) are folded away unless one is set.
const showMore = ref(
    !!(props.channel?.channelNumber || props.channel?.group || (props.channel?.streamType && props.channel.streamType !== 'auto'))
);
const testing = ref(false);
const testResult = ref(null);
const fileInput = ref(null);
const pendingFile = ref(null);
const pendingPreview = ref(null);
const removeUploaded = ref(false);
const logoError = ref('');

const hasUploadedLogo = computed(() => !removeUploaded.value && !!props.channel?.logo?.includes('live-channels/logo/'));
const logoPreview = computed(
    () => pendingPreview.value || (!removeUploaded.value && props.channel?.logo ? getThumbnailUrl(props.channel.logo) : null)
);

// The colour box takes any text; the picker only works with a full #rrggbb.
const pickerColor = computed({
    get: () => (/^#[0-9a-f]{6}$/i.test(form.value.color) ? form.value.color : DEFAULT_COLOR),
    set: (value) => (form.value.color = value),
});

// The colour the logo will sit on, as the server will draw it: the one typed (once it is a full #rrggbb), else
// the channel's own brand colour, else the default a new channel is given.
const previewColor = computed(() =>
    /^#[0-9a-f]{6}$/i.test(form.value.color) ? form.value.color : (props.channel?.brandColor ?? (isCustom.value ? DEFAULT_COLOR : '#333333'))
);

const headersToText = (headers) => Object.entries(headers ?? {}).map(([name, value]) => `${name}: ${value}`).join('\n');
const textToHeaders = (text) =>
    Object.fromEntries(
        text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const at = line.indexOf(':');
                return at < 0 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
            })
    );

const kindLabel = (kind) =>
    ({
        'hls-master': 'HLS (adaptive)',
        'hls-media': 'HLS',
        dash: 'DASH',
        ts: 'MPEG-TS stream',
        mp4: 'MP4 stream',
        unknown: 'Video stream',
    })[kind] ?? 'Stream';

onMounted(async () => {
    if (!props.channel?.custom) return;
    // The list omits the stream URL and headers; they come from the custom channel itself.
    const { ok, data } = await ipFetch(`${API}/custom`);
    const full = ok && data.find((c) => c.id === props.channel.id);
    if (full) {
        form.value.streamUrl = full.streamUrl;
        form.value.headers = headersToText(full.headers);
        if (form.value.headers) showMore.value = true;
    }
});

const testStream = async () => {
    testing.value = true;
    testResult.value = null;
    const { data } = await ipFetch(`${API}/probe`, 'POST', {
        streamUrl: form.value.streamUrl,
        headers: textToHeaders(form.value.headers),
    });
    testing.value = false;
    testResult.value = data;
    if (data.ok && data.suggestedStreamType && form.value.streamType === 'auto') {
        form.value.streamType = data.suggestedStreamType;
    }
};

// A quick look so an unsuitable file is refused before it is sent; the server checks again.
const pickLogo = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    logoError.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        logoError.value = 'The logo must be 2MB or smaller';
        return;
    }
    const url = URL.createObjectURL(file);
    if (file.type !== 'image/svg+xml') {
        const size = await new Promise((resolve) => {
            const image = new Image();
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
            image.onerror = () => resolve(null);
            image.src = url;
        });
        if (!size) {
            logoError.value = 'That file is not a readable image';
        } else if (Math.min(size.width, size.height) < 200 || Math.max(size.width, size.height) > 2000) {
            logoError.value = `The logo is ${size.width}x${size.height}px; each side must be 200-2000px`;
        } else if (Math.max(size.width / size.height, size.height / size.width) > 3) {
            logoError.value = 'The logo is too wide or tall; keep it within 3:1';
        }
        if (logoError.value) {
            URL.revokeObjectURL(url);
            return;
        }
    }
    pendingFile.value = file;
    pendingPreview.value = url;
    removeUploaded.value = false;
};

const removeLogo = () => {
    pendingFile.value = null;
    pendingPreview.value = null;
    removeUploaded.value = true;
};

const fail = (data, fallback) => toastService.error(fallback, { detail: data?.message });

const save = async () => {
    saving.value = true;
    try {
        const number = form.value.channelNumber === '' ? null : Number(form.value.channelNumber);
        const common = { name: form.value.name, color: form.value.color, logoText: form.value.logoText, channelNumber: number };
        let id = props.channel?.id;
        let result;
        if (isCustom.value) {
            const body = {
                ...common,
                streamUrl: form.value.streamUrl,
                group: form.value.group,
                streamType: form.value.streamType,
                headers: textToHeaders(form.value.headers),
            };
            const before = new Set((await ipFetch(API)).data?.map?.((c) => c.id) ?? []);
            result = id ? await ipFetch(`${API}/custom/${id}`, 'PUT', body) : await ipFetch(`${API}/custom`, 'POST', body);
            if (result.ok && !id) id = result.data.find((c) => c.custom && !before.has(c.id))?.id;
        } else {
            result = await ipFetch(`${API}/${id}/customise`, 'PUT', common);
        }
        if (!result.ok) return fail(result.data, 'Unable to save the channel');

        if (id && pendingFile.value) {
            const upload = await ipUpload(`${API}/${id}/logo`, 'image', pendingFile.value);
            if (!upload.ok) return fail(upload.data, 'The channel was saved but the logo was refused');
        } else if (id && removeUploaded.value && hasUploadedLogoOnServer()) {
            await ipFetch(`${API}/${id}/logo`, 'DELETE');
        }
        emit('saved');
    } finally {
        saving.value = false;
    }
};

// Only a logo that was really uploaded can be removed (custom channels always have a drawn logo URL).
const hasUploadedLogoOnServer = () => !!props.channel?.logo?.includes('live-channels/logo/');

const reset = async () => {
    if (!(await dialogService.confirm('Reset channel', `Reset ${props.channel.title} to its defaults?`, 'Its name, colour, text, number and uploaded logo are cleared.', { danger: true, confirmLabel: 'Reset' }))) {
        return;
    }
    const { ok, data } = await ipFetch(`${API}/${props.channel.id}/customise`, 'DELETE');
    if (ok) emit('saved');
    else fail(data, 'Unable to reset the channel');
};

const remove = async () => {
    if (!(await dialogService.confirm('Delete channel', `Delete ${props.channel.title}?`, 'It is also removed from your library and Jellyfin Live TV.', { danger: true, confirmLabel: 'Delete' }))) {
        return;
    }
    const { ok, data } = await ipFetch(`${API}/custom/${props.channel.id}`, 'DELETE');
    if (ok) emit('saved');
    else fail(data, 'Unable to delete the channel');
};
</script>

<style lang="less" scoped>
// Everything below the fields shares their 650px column, so its right edge lines up with theirs on wide
// dialogs (tablets, desktop) instead of running out to the dialog's edge.
.moreToggle {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 4px 0 12px;
    padding: 4px 0;
    border: none;
    background: none;
    color: @subtle-text-color;
    font-size: 14px;
    cursor: pointer;

    &:hover {
        color: @brand-color;
    }
}

.testRow,
.testResult,
.logoGroup,
.dangerRow {
    max-width: 650px;
    box-sizing: border-box;
}

// Laid out like the TextInput fields above it: label in the left column on wide screens, above on phones.
.logoGroup {
    display: flex;
    margin-bottom: 1rem;

    label {
        flex: 0 0 250px;
        display: flex;
        justify-content: flex-end;
        margin-right: 20px;
        padding-top: 8px;
        text-align: end;
        font-size: 14px;
        font-weight: bold;
        color: @table-text-color;
    }

    @media (max-width: @mobile-breakpoint) {
        flex-direction: column;

        label {
            flex: none;
            justify-content: flex-start;
            margin-right: 0;
            padding-top: 0;
            margin-bottom: 4px;
            text-align: start;
        }
    }
}

.testRow {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 12px;
    margin-bottom: 8px;
}

.lastTest,
.testResult {
    font-size: 13px;

    &.ok {
        color: @success-color;
    }

    &.bad {
        color: @danger-color;
    }
}

.testResult {
    margin: 0 0 12px;
    padding: 6px 12px 10px;
    border: 1px solid @settings-button-border-color;
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
    font-size: 12px;
    text-align: left;
    overflow-wrap: anywhere;

    // The global legend style is the dialog title's; this one is a small box label.
    legend {
        width: auto;
        margin: 0;
        padding: 0 6px;
        border: none;
        font-family: inherit;
        font-size: 12px;
        line-height: 1;
        color: @subtle-text-color;
    }

    &.ok {
        border-color: @success-color;
    }

    &.bad {
        border-color: @danger-color;
    }
}

.hint {
    font-size: 12px;
    color: @subtle-text-color;
    margin-top: 4px;
}

// Sits in the Colour field's own row, so it is level with the box in every layout. TextInput's slot is
// outside this component's scope, hence :deep.
:deep(.colourPicker) {
    flex: 0 0 auto;
    width: 44px;
    height: 35px;
    margin: 0;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
}

.logoRow {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    flex-wrap: wrap;
}

.logoPreview {
    width: 190px;
    aspect-ratio: 2.375 / 1;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid @settings-button-border-color;
}

.logoPreview.pending {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;

    img {
        width: 100%;
        height: 100%;
        object-fit: contain;
    }
}

.logoActions {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
}

.logoError {
    color: @danger-color;
    font-size: 13px;
}

.dangerRow {
    display: flex;
    gap: 8px;
    margin: 12px 0 16px;
}
</style>

<style lang="less">
// The dialog's global footer rule right-aligns the button row to the dialog edge (margin-left: auto); here it
// belongs to the fields' column (650px), so Cancel/Save line up with the fields' right edge. Not scoped: the
// footer lives inside IPlayarrModal.
.iplayarr-modal.channelEditModal .iplayarr-modal-content .button-container {
    margin-left: 0;
}
</style>
