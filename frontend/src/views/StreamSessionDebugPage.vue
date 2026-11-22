<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content streamTracePage">
        <PageHeader title="Stream trace" icon="timeline" />
        <SettingsPageToolbar :icons="['refresh']" refresh-label="Reload" refresh-title="Reload this stream's requests" :refreshing="loading" @refresh="load">
            <template #actions>
                <button
                    v-if="canDebug" type="button" class="SettingsPageToolbar-button clickable" title="Streaming debug for this programme (what BBC and iPlayarr hold about it)"
                    aria-label="Streaming debug for this programme" @click="openDebug(session.pid, session.radio ? 'radio' : undefined)"
                >
                    <font-awesome-icon :icon="['fas', 'bug']" />
                </button>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!trace" title="Open every section" aria-label="Expand all sections" @click="setAllSections(SECTION_IDS, true)">
                    <font-awesome-icon :icon="['fas', 'folder-open']" />
                </button>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!trace" title="Close every section" aria-label="Collapse all sections" @click="setAllSections(SECTION_IDS, false)">
                    <font-awesome-icon :icon="['fas', 'folder-closed']" />
                </button>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!trace" title="Copy the trace as text to paste into a bug report" aria-label="Copy trace" @click="copy">
                    <font-awesome-icon :icon="['fas', 'copy']" />
                </button>
                <button type="button" class="SettingsPageToolbar-button clickable" :disabled="!trace" title="Save the trace as a text file to attach to a bug report" aria-label="Download trace" @click="copy(true)">
                    <font-awesome-icon :icon="['fas', 'download']" />
                </button>
                <button v-if="traceTools" type="button" class="SettingsPageToolbar-button clickable" :disabled="!trace" title="Export this stream as a data file to send; it opens on another iPlayarr with Import trace on the Streaming page" aria-label="Export data" @click="exportData">
                    <font-awesome-icon :icon="['fas', 'file-export']" />
                </button>
            </template>
        </SettingsPageToolbar>

        <LoadingIndicator v-if="loading && !trace" />
        <ErrorState v-else-if="loadError" :message="errorText" @retry="load" />
        <template v-else-if="trace">
            <!-- Everything the Streaming row shows, then what it leaves out. -->
            <p v-if="trace.traceEnabled === false && !session.imported" class="offNote">
                Stream Trace is disabled: streams started now are not recorded. The data below was recorded while it was enabled. Enable it under Settings > Streaming > Advanced.
            </p>
            <p v-if="session.imported" class="offNote importedNote">
                Imported data: this stream was opened from a file, not streamed here.
                <button type="button" class="deleteImported clickable" @click="deleteImported">
                    <font-awesome-icon :icon="['fas', 'trash']" /> Delete imported data
                </button>
            </p>
            <section class="traceSection">
                <div class="sessionHead">
                    <img v-if="thumbnail" class="sessionThumb" :class="{ channelLogo: session.live }" :src="thumbnail" alt="" @error="hideBrokenImage" />
                    <div class="sessionTitle">
                        <h2>{{ title }}</h2>
                        <div v-if="subtitle" class="subtle">{{ subtitle }}</div>
                        <div class="pills"><StreamPills :mode="modeLabel" :resolution="session.resolution" :settings="session.settings" plain /></div>
                    </div>
                    <div class="sessionGraphs">
                        <ThroughputSpark
                            :throughput="session.throughput" :now="now" :ended-at="session.endedAt" :started-at="session.startedAt"
                            :bytes-transferred="session.bytesTransferred ?? 0"
                        />
                        <span v-if="session.live" class="liveBadge"><span class="liveDot" />Live</span>
                        <SegmentActivityStrip
                            v-else-if="session.totalSegments"
                            :total="session.totalSegments" :delivered="session.deliveredSegments ?? []"
                            :current-segment-index="session.currentSegmentIndex ?? null" :cell-size="3" :max-cols="60" :max-rows="6"
                        />
                    </div>
                </div>
                <dl class="facts">
                    <template v-for="fact in facts" :key="fact.label">
                        <dt>{{ fact.label }}</dt>
                        <dd>{{ fact.value }}</dd>
                    </template>
                </dl>
            </section>

            <TraceSection id="summary" title="Trace summary" info="Aggregate request counters and latency percentiles for this session. Red cards are anomalies; the line below states the most likely origin." :summary="verdictShort">
                <div class="summaryCards">
                    <div v-for="card in cards" :key="card.label" class="summaryCard" :class="card.tone">
                        <span class="cardValue">{{ card.value }}</span>
                        <span class="cardLabel">{{ card.label }}</span>
                    </div>
                </div>
                <p v-if="verdict" class="verdict" :class="verdict.tone">{{ verdict.text }}</p>
            </TraceSection>

            <TraceSection v-if="!session.live" id="grid" title="Segment delivery map" info="One cell per segment index, as in the Streaming page's segment popup. Hover a cell for every request made for it; click to select the first one in the request log." :summary="gridSummary">
                <SegmentGridPanel :session="session" :requests="trace.requests" :origin="originMs" :selected="selected" @select="selectRequest" @jump="jumpToRow" />
            </TraceSection>

            <TraceSection v-if="!session.live || lanesPresent" id="timeline" title="Segment request timeline" info="Each bar is one segment request: x is arrival time, bar length is transfer duration, height is segment index. Colour is the outcome: request order (index versus highest requested) and PTS continuity of the segment content. A muxed stream has one lane; A/V PTS plots each elementary stream's first PTS on its own lane." :summary="`${trace.requests.length} requests`">
                <EmptyState v-if="!lanesPresent" icon="timeline" title="No segment requests recorded yet" />
                <RequestTimeline v-else :requests="trace.requests" :origin="originMs" :selected="selected" @select="selectRequest" @jump="jumpToRow" @clear="selected = null" :sync="syncSelect" @toggle-sync="syncSelect = !syncSelect" />
            </TraceSection>

            <TraceSection v-if="!session.live || lanesPresent" id="charts" title="Playback diagnostics" info="Buffer depth is derived from EXTINF durations and arrival times. The throughput ratio compares transfer time with EXTINF. A/V offset and PTS discontinuity are read from the first PES packets of each MPEG-TS segment. Each chart has its own (i)." summary="buffer depth, throughput vs real time, A/V start offset, PTS drift">
                <StreamHealthCharts :requests="trace.requests" :playlists="session.live ? (trace.playlists ?? []) : []" :hide-empty="!!session.live" :sync="syncSelect" :sync-seg="selectedRow?.seg ?? null" :can-jump="selected !== null" @toggle-sync="syncSelect = !syncSelect" @jump="jumpToRow(selected)" @pick="pickSegment" @clear="selected = null" />
            </TraceSection>

            <TraceSection v-if="session.live && (liveFacts.length || liveNoteList.length)" id="live" title="Live window" info="How the live playlist (a sliding window of the newest segments) behaved and how close to the live edge the player stayed. Worked out from the playlist reads this trace kept (the latest 100) and the segment requests. Watch from start is what the setting would do now, not necessarily what this stream did." :summary="liveSummary">
                <dl class="facts">
                    <template v-for="fact in liveFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                </dl>
                <p v-for="(note, i) in liveNoteList" :key="i" class="verdict" :class="note.tone">{{ note.text }}</p>
            </TraceSection>

            <TraceSection id="who" title="Client identification" info="Distinct clients by source address and User-Agent (plus X-Emby-Client and X-Emby-Device-Name where sent). Jellyfin's transcoder identifies as Lavf (ffmpeg); a client playing directly, such as Apple TV, identifies as AppleCoreMedia." :summary="whoSummary">
                <div class="tableScroll"><table class="dataTable traceTable">
                    <thead><tr><th>Address</th><th>User-Agent</th><th>Jellyfin / Emby client</th><th class="numCol">Requests</th></tr></thead>
                    <tbody>
                        <tr v-for="p in trace.summary.players" :key="`${p.ip}${p.userAgent}${p.client}`">
                            <td>{{ formatClientIp(p.ip) }}</td><td class="text">{{ p.userAgent ?? 'not sent' }}</td><td>{{ p.client ?? '' }}</td><td class="numCol">{{ p.count }}</td>
                        </tr>
                        <tr v-if="!trace.summary.players.length"><td colspan="4"><EmptyState icon="timeline" title="No requests recorded" /></td></tr>
                    </tbody>
                </table></div>
            </TraceSection>

            <TraceSection id="playlists" title="HLS playlists" info="HLS playlists fetched for this session, parsed against RFC 8216, with the rewrites iPlayarr applies when proxying them to the client." :summary="`${(trace.playlists ?? []).length} playlist(s)`" :default-open="false">
                <DeliveredQuality v-if="!session.radio" :session-id="session.id" :playlists="trace.playlists ?? []" :requests="trace.requests" />
                <PlaylistPanel :session-id="session.id" :playlists="trace.playlists ?? []" :origin="originMs" />
            </TraceSection>

            <TraceSection v-if="namingFacts.length" id="naming" title="File naming (when exported)" info="Where the programme would be saved and what TVDB said, worked out on the server the file came from at the time it was exported." :summary="trace.naming?.fileName ?? ''" :default-open="false">
                <dl class="facts">
                    <template v-for="fact in namingFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                </dl>
            </TraceSection>

            <TraceSection id="selected" title="Request / response detail" info="Select a bar, grid cell or log row to see the client request, the upstream (BBC) request and response, and the response sent to the client." :summary="selected ? `#${selected}` : 'none chosen'">
                <EmptyState v-if="!selectedRow" icon="timeline" title="Select a bar, cell or row to see the request / response exchange" />
                <div v-else class="exchange">
                    <div class="exchangeCol">
                        <h4>Client request (to iPlayarr)</h4>
                        <dl class="facts">
                            <template v-for="fact in playerFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                        </dl>
                    </div>
                    <div class="exchangeCol">
                        <h4>Upstream request (to BBC)</h4>
                        <dl class="facts">
                            <template v-for="fact in bbcFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                        </dl>
                    </div>
                    <div class="exchangeCol">
                        <h4>Response to client</h4>
                        <dl class="facts">
                            <template v-for="fact in sentFacts" :key="fact.label"><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></template>
                        </dl>
                    </div>
                </div>
            </TraceSection>

            <TraceSection id="requests" title="Request log" info="All recorded requests in arrival order. Hover a column header for its definition." :summary="`${shownRequests.length} of ${trace.requests.length}`">
                <div class="tableTools">
                    <label class="checkLabel"><input v-model="problemsOnly" type="checkbox" /> Anomalous requests only</label>
                    <span class="subtle">{{ shownRequests.length }} of {{ trace.requests.length }}</span>
                </div>
                <TablePagination v-model="page" v-model:page-size="pageSize" :total="shownRequests.length" />
                <div v-if="isMobile" class="reqCards">
                    <div v-for="row in pagedRequests" :key="row.n" :ref="(el) => rowRef(row.n, el)" class="reqCard" :class="{ selectedRow: row.n === selected }" @click="selected = row.n">
                        <div class="reqTop">
                            <span class="resultDot" :class="`o-${outcomeOf(row)}`" />
                            <strong>#{{ row.n }}</strong>
                            <span>{{ TRACK_LABELS[row.track] ?? row.track ?? '' }} {{ kindLabel(row).toLowerCase() }}<template v-if="row.seg !== undefined"> {{ row.seg }}</template></span>
                            <span class="reqWhen mono">{{ formatOffset(row.t - originMs) }}</span>
                        </div>
                        <div class="reqResult" :class="{ bad: isProblem(row) }">{{ OUTCOME_LABELS[outcomeOf(row)] }}</div>
                        <div class="reqMeta">
                            <span v-if="row.status !== undefined">{{ row.status }}</span>
                            <span v-if="row.ttfbMs !== undefined">TTFB {{ formatMs(row.ttfbMs) }}</span>
                            <span v-if="row.durMs !== undefined">duration {{ formatMs(row.durMs) }}</span>
                            <span v-if="row.bytes !== undefined">{{ bytesText(row) }}</span>
                            <span v-if="row.ptsDriftMs !== undefined" :class="{ bad: row.ptsFlag }">PTS delta {{ row.ptsDriftMs }} ms</span>
                            <span v-if="row.delta">{{ row.delta }} since previous</span>
                            <span v-if="row.range" class="mono">{{ row.range }}</span>
                        </div>
                    </div>
                    <EmptyState v-if="shownRequests.length === 0" icon="timeline" :title="trace.requests.length ? 'No anomalous requests' : 'No requests recorded'" />
                </div>
                <div v-else class="tableScroll">
                    <table class="dataTable traceTable">
                        <thead>
                            <tr>
                                <th title="Request sequence number (arrival order).">#</th>
                                <th title="Request arrival time as an offset from session start. The second line is the interval since the previous request.">Time</th>
                                <th title="Elementary stream of the request. Muxed A/V is a single MPEG-TS carrying video and audio.">Track</th>
                                <th title="Segment index in playback order (the seg= parameter of the proxied URL).">Seg</th>
                                <th title="Segment, playlist, or other (key, initialisation section).">Kind</th>
                                <th title="Outcome: request order against the highest index requested so far, PTS continuity against the previous segment, and response completeness.">Result</th>
                                <th title="HTTP status returned by the upstream CDN, with the number of redirects followed.">Status</th>
                                <th title="Time to first byte from the upstream CDN.">TTFB</th>
                                <th title="Time from request arrival to the last upstream byte.">Duration</th>
                                <th class="numCol" title="Bytes received from upstream (and the Content-Length where it differs).">Bytes</th>
                                <th title="HTTP Range requested by the client, if any.">Range</th>
                                <th title="First video PTS in the segment (MPEG-TS PES header), in seconds.">PTS (V)</th>
                                <th title="First audio PTS in the segment (MPEG-TS PES header), in seconds.">PTS (A)</th>
                                <th title="First PTS minus the expected end of the previous segment on the same track (previous PTS + EXTINF, or the median segment step where EXTINF is rounded to whole seconds). Near 0 is continuous; negative is an overlap (content repeats); positive is a gap (content skipped).">PTS delta</th>
                                <th title="Upstream host that served the response, with any CDN cache headers.">Upstream</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="row in pagedRequests" :key="row.n" :ref="(el) => rowRef(row.n, el)" :class="{ selectedRow: row.n === selected }" @click="selected = row.n">
                                <td>{{ row.n }}</td>
                                <td class="mono" :title="new Date(row.t).toISOString()">{{ formatOffset(row.t - originMs) }}<div class="subtle">{{ row.delta }}</div></td>
                                <td>{{ TRACK_LABELS[row.track] ?? row.track ?? '' }}</td>
                                <td>{{ row.seg ?? '' }}</td>
                                <td>{{ kindLabel(row) }}</td>
                                <td><span class="resultDot" :class="`o-${outcomeOf(row)}`" />{{ OUTCOME_LABELS[outcomeOf(row)] }}</td>
                                <td>{{ row.status ?? (row.pending ? '...' : '') }}<span v-if="row.redirects" class="subtle"> ({{ row.redirects }} redirect{{ row.redirects > 1 ? 's' : '' }})</span></td>
                                <td>{{ formatMs(row.ttfbMs) }}</td>
                                <td>{{ formatMs(row.durMs) }}</td>
                                <td class="numCol">{{ bytesText(row) }}</td>
                                <td class="mono">{{ row.range ?? '' }}</td>
                                <td class="mono">{{ ptsText(row.ptsV) }}</td>
                                <td class="mono">{{ ptsText(row.ptsA) }}</td>
                                <td class="mono" :class="{ bad: row.ptsFlag }">{{ row.ptsDriftMs !== undefined ? `${row.ptsDriftMs} ms` : '' }}<div v-if="row.segDur !== undefined" class="subtle">len {{ row.segDur }} s{{ row.discontinuity ? ', break' : '' }}</div></td>
                                <td class="text" :title="row.upstreamPath">{{ row.upstreamHost ?? '' }}<div v-if="row.cdn" class="subtle">{{ row.cdn }}</div></td>
                            </tr>
                            <tr v-if="shownRequests.length === 0">
                                <td colspan="15"><EmptyState icon="timeline" :title="trace.requests.length ? 'No requests with a problem' : 'No requests recorded'" /></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <TablePagination v-model="page" v-model:page-size="pageSize" :total="shownRequests.length" />
            </TraceSection>
        </template>
    </div>
</template>

<script setup>
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRoute, useRouter } from 'vue-router';

import EmptyState from '@/components/common/EmptyState.vue';
import ErrorState from '@/components/common/ErrorState.vue';
import LoadingIndicator from '@/components/common/LoadingIndicator.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import TablePagination from '@/components/common/TablePagination.vue';
import { chaptersSummary } from '@/lib/chapterText';
import { copyReport, downloadReport } from '@/lib/copyReport';
import { details, loadDetails } from '@/lib/detailsCache';
import dialogService from '@/lib/dialogService';
import { ipFetch } from '@/lib/ipFetch';
import { deliveredQualityLines, environmentLines, liveLines, logLinesAround, playerLines, readPlaylists } from '@/lib/reportContext';
import { avSpread, deliveredQuality, formatMs, formatOffset, liveEdgeSeries, liveEdgeSummary, liveNotes, liveWindow, OUTCOME_LABELS, outcomeOf, TRACK_LABELS, variantSwitches } from '@/lib/requestTimeline';
import toastService from '@/lib/toastService';
import { setAllSections, setSectionOpen } from '@/lib/traceSections';
import { useDebugLink } from '@/lib/useDebugLink';
import { useIsMobile } from '@/lib/useIsMobile';
import { usePagination } from '@/lib/usePagination';
import { useServerNow } from '@/lib/useServerNow';
import {
    formatBytes, formatClientIp, formatWhen, getHost, getSeriesEpisodeLabel, getSessionThumbnailUrl, getThumbnailUrl, hideBrokenImage,
} from '@/lib/utils';

import TraceExportDialog from '../components/modals/TraceExportDialog.vue';
import DeliveredQuality from '../components/streaming/DeliveredQuality.vue';
import PlaylistPanel from '../components/streaming/PlaylistPanel.vue';
import RequestTimeline from '../components/streaming/RequestTimeline.vue';
import SegmentActivityStrip from '../components/streaming/SegmentActivityStrip.vue';
import SegmentGridPanel from '../components/streaming/SegmentGridPanel.vue';
import StreamHealthCharts from '../components/streaming/StreamHealthCharts.vue';
import StreamPills from '../components/streaming/StreamPills.vue';
import ThroughputSpark from '../components/streaming/ThroughputSpark.vue';
import TraceSection from '../components/streaming/TraceSection.vue';

// One stream, in full: what the Streaming row shows, a timeline of every request the player made (video and audio apart), and what BBC
// sent back for each, so a repeat or stutter can be traced to the player's order of requests or to the media itself.
const route = useRoute();
// Phones get a card for each request, not a 15 column table.
const isMobile = useIsMobile();
const trace = ref(null);
// App-wide values the bug report adds: versions, settings and the browser's log lines.
const hiddenSettings = inject('hiddenSettings', null);
const toolVersions = inject('toolVersions', null);
const globalSettings = inject('globalSettings', null);
const logs = inject('logs', null);
const loading = ref(false);
const loadError = ref(false);
const errorText = ref('Could not load this stream.');
const selected = ref(null);
const problemsOnly = ref(false);
const { now, sync: syncServerTime } = useServerNow();
let poll;

const session = computed(() => trace.value?.session ?? {});
// The bug icon opens the Streaming debug page of the programme (or live channel) this stream is playing, as the Streaming rows' bug does.
const { openDebug } = useDebugLink();
const canDebug = computed(() => !!trace.value && (session.value.live || /^[a-z0-9]{8}$/i.test(session.value.pid ?? '')));
const originMs = computed(() => new Date(session.value.startedAt).getTime());
const channelLogos = ref({});

let disposed = false;
// What watch from start would do for this live channel: asked once per stream (the server works it out from the guide and BBC), not on every refresh.
const fromStart = ref(null);
let fromStartFor = null;
const loadFromStart = async (id) => {
    if (fromStartFor === id) return;
    fromStartFor = id;
    try {
        const { ok, data } = await ipFetch(`json-api/streams/trace/${encodeURIComponent(id)}/live`);
        if (ok && !disposed && id === route.params.id) fromStart.value = data?.fromStart ?? null;
    } catch {
        // an extra, never needed
    }
};
const load = async () => {
    loading.value = true;
    const requestedId = route.params.id;
    try {
        const { ok, data, status } = await ipFetch(`json-api/streams/trace/${encodeURIComponent(requestedId)}`);
        // The page was left, or pointed at another stream, while this was in flight.
        if (disposed || requestedId !== route.params.id) return;
        if (ok) {
            syncServerTime(data.serverTime);
            trace.value = data;
            loadError.value = false;
            if (!session.value.live && !session.value.radio) loadDetails(session.value.pid);
            if (session.value.live && !session.value.imported) loadFromStart(requestedId);
        } else {
            loadError.value = true;
            errorText.value = status === 404 ? 'This stream is no longer in the history.' : 'Could not load this stream.';
        }
    } catch {
        loadError.value = true;
    } finally {
        loading.value = false;
    }
};

// A running stream keeps adding requests, so it is read again every couple of seconds (the timeline follows the data until zoomed).
const schedulePoll = () => {
    clearTimeout(poll);
    poll = setTimeout(async () => {
        if (trace.value?.active && !loading.value) await load();
        if (!disposed) schedulePoll();
    }, 2000);
};

onMounted(async () => {
    try {
        const response = await ipFetch('json-api/browse/channels');
        if (response.ok) channelLogos.value = Object.fromEntries(response.data.map(({ id, logo }) => [id, logo]));
    } catch {
        // logos are decoration
    }
    await load();
    // Left while the first load was awaited: do not arm a timer nobody will clear.
    if (!disposed) schedulePoll();
});
onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(poll);
});
watch(() => route.params.id, () => {
    trace.value = null;
    fromStart.value = null;
    fromStartFor = null;
    loadError.value = false;
    load();
});

const programme = computed(() => details[session.value.pid]);
const title = computed(() => session.value.title ?? programme.value?.title ?? session.value.pid);
const subtitle = computed(() => getSeriesEpisodeLabel(programme.value) ?? '');
const thumbnail = computed(() => {
    if (session.value.radio) return session.value.image ? getThumbnailUrl(session.value.image, true) : undefined;
    return getSessionThumbnailUrl(session.value, programme.value, channelLogos.value);
});
const CLIENT_LABELS = { GET_IPLAYER: 'iplayer', YTDLP: 'ytdlp', NATIVE: 'native' };
const modeLabel = computed(() => {
    const client = CLIENT_LABELS[session.value.client] ?? session.value.client ?? '';
    return client ? `${session.value.mode} (${client})` : session.value.mode;
});

const when = formatWhen;
const duration = computed(() => {
    const end = session.value.endedAt ? new Date(session.value.endedAt).getTime() : now.value;
    const total = Math.max(0, Math.floor((end - originMs.value) / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
});

const facts = computed(() => {
    const s = session.value;
    const source = s.source ?? {};
    return [
        { label: 'Stream id', value: s.id },
        { label: 'Programme id', value: s.pid },
        { label: 'Client address', value: formatClientIp(s.clientIp) },
        { label: 'User-Agent', value: s.userAgent },
        { label: 'Requested version', value: s.version },
        { label: 'Started', value: when(s.startedAt) },
        { label: 'Last activity', value: when(s.lastActivityAt) },
        { label: 'Ended', value: s.endedAt ? `${when(s.endedAt)}${s.endReason ? ` (${s.endReason})` : ''}` : trace.value.active ? 'Still running' : '' },
        { label: 'Duration', value: duration.value },
        { label: 'Bytes transferred', value: s.bytesTransferred ? formatBytes(s.bytesTransferred) : '' },
        // A live playlist is a sliding window, so a delivered-of-total count means nothing there.
        { label: 'Segments', value: s.totalSegments && !s.live ? `${s.deliveredSegments?.length ?? 0} delivered of ${s.totalSegments}; last requested ${s.currentSegmentIndex ?? '-'}` : s.live ? liveSegmentsText() : '' },
        { label: 'Upstream host', value: source.host },
        { label: 'Route', value: source.route },
        { label: 'Selection reason', value: source.why },
        { label: 'Ladder maximum', value: source.ladderMax ? `${source.ladderMax}p` : '' },
        { label: 'Playlist URL', value: source.url },
        { label: 'Continues', value: s.continuesSessionId ? `continuation of ${s.continuesSessionId}` : '' },
    ].filter((fact) => fact.value);
});

// A live playlist has no total, so the Segments fact says how many were asked for and how far the sequence got.
const liveSegmentsText = () => {
    const numbers = (trace.value?.requests ?? []).filter((r) => r.kind === 'segment' && r.seg !== undefined).map((r) => r.seg);
    return numbers.length ? `${numbers.length} requested; newest media sequence ${numbers.reduce((a, b) => Math.max(a, b))}` : '';
};

// Live streams: the playlist's window, how far behind live the player stayed, and what watch from start would do (see lib/requestTimeline.js).
const edgePoints = computed(() => (session.value.live ? liveEdgeSeries(trace.value?.requests, trace.value?.playlists) : []));
const edgeSummary = computed(() => liveEdgeSummary(edgePoints.value));
const liveWin = computed(() => (session.value.live ? liveWindow(trace.value?.requests, trace.value?.playlists) : null));
const liveNoteList = computed(() => (session.value.live ? liveNotes(liveWin.value, edgeSummary.value) : []));
const clock = (ms) => (ms === undefined ? '' : `${(ms / 1000).toFixed(Math.abs(ms) >= 10000 ? 0 : 1)} s`);
const span = (seconds) => (seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);
const liveFacts = computed(() => {
    if (!session.value.live) return [];
    const w = liveWin.value;
    const e = edgeSummary.value;
    const f = fromStart.value;
    const unit = e?.unit === 's' ? ' s' : ' segments';
    const rungs = deliveredQuality(trace.value.requests).rungs.length;
    return [
        { label: 'Playlist window', value: w ? `${w.segments} segments${w.seconds ? `, ${Math.round(w.seconds)} s` : ''}` : '' },
        { label: 'Playlist reads', value: w ? (w.reloadMean !== undefined ? `${w.reads} recorded, every ${clock(w.reloadMean)} on average, at most ${clock(w.reloadMax)} apart` : `${w.reads} recorded`) : '' },
        { label: 'Behind live', value: e ? `median ${e.median.toFixed(0)}${unit}, at most ${e.max.toFixed(0)}${unit}` : '' },
        { label: 'Playlist stalls', value: w ? (w.stalls ? `${w.stalls}, the longest ${clock(w.longestStall)}` : 'none') : '' },
        { label: 'Segments missed between reads', value: w ? String(w.missed) : '' },
        { label: 'Breaks in the window', value: w?.breaks ? `${w.breaks} (EXT-X-DISCONTINUITY, such as an ad or programme join)` : '' },
        { label: 'Newest segment age when read', value: w?.lag ? `${clock(w.lag.last)} last, ${clock(w.lag.min)} to ${clock(w.lag.max)} (BBC date stamps against this server's clock)` : '' },
        { label: 'Quality switches', value: rungs ? String(variantSwitches(trace.value.requests)) : '' },
        { label: 'Watch from start (setting now)', value: f ? (f.enabled ? 'on' : 'off') : '' },
        { label: 'Programme on air', value: f?.programme ? `${f.programme}, started ${f.programmeStart ? when(f.programmeStart) : ''}` : '' },
        { label: 'Would start', value: f?.secondsBack !== undefined ? `${span(f.secondsBack)} back${f.clamped ? ' (limited by what BBC keeps)' : ''}, BBC keeps ${f.bufferSeconds ? span(f.bufferSeconds) : 'an unknown amount'}` : '' },
        { label: 'Watch from start note', value: f?.note },
    ].filter((fact) => fact.value !== undefined && fact.value !== '' && fact.value !== null);
});
const liveSummary = computed(() => (edgeSummary.value ? `median ${edgeSummary.value.median.toFixed(0)}${edgeSummary.value.unit === 's' ? ' s' : ' segments'} behind live` : liveWin.value ? `${liveWin.value.segments} segment window` : ''));
const liveCards = computed(() => {
    const e = edgeSummary.value;
    const w = liveWin.value;
    const bad = (n) => (n > 0 ? 'bad' : '');
    return [
        ...(e ? [{ label: 'median behind live', value: `${e.median.toFixed(0)}${e.unit === 's' ? ' s' : ' seg'}` }, { label: 'requests outside the window', value: e.outside, tone: bad(e.outside) }] : []),
        ...(w ? [{ label: 'playlist stalls', value: w.stalls, tone: bad(w.stalls) }, { label: 'segments missed between reads', value: w.missed, tone: bad(w.missed) }] : []),
    ];
});

const SECTION_IDS = ['summary', 'grid', 'timeline', 'charts', 'live', 'who', 'playlists', 'selected', 'requests'];

// Export is for people debugging, like Import: it shows with Stream Trace or Show Extended Debug on, or for a trace that was imported.
const traceTools = computed(() => globalSettings?.value?.STREAM_TRACE === 'true' || globalSettings?.value?.UI_EXTENDED_DEBUG === 'true' || session.value.imported === true);
// Export and delete (traces opened from a file are deleted here with one button, or all at once on the Streaming page).
const router = useRouter();
// The options (compressed, file naming) are asked for in a popup, so they do not take room on the page.
const exportData = () => {
    const modal = useModal({
        component: TraceExportDialog,
        attrs: {
            offerNaming: !session.value.live && !session.value.radio,
            onConfirm: ({ gzip, naming }) => {
                modal.close();
                const query = [gzip ? 'gzip=1' : '', naming ? '' : 'naming=0'].filter(Boolean).join('&');
                // The server answers with a download (Content-Disposition), so navigating to it saves the file.
                window.location.assign(`${getHost()}/json-api/streams/trace/${encodeURIComponent(session.value.id)}/export${query ? `?${query}` : ''}`);
            },
            onCancel: () => modal.close(),
        },
    });
    modal.open();
};
const deleteImported = async () => {
    if (!(await dialogService.confirm('Delete imported data', 'Delete this imported trace? Your own stream history is not touched.', undefined, { danger: true, confirmLabel: 'Delete' }))) return;
    const { ok } = await ipFetch(`json-api/streams/trace/${encodeURIComponent(session.value.id)}`, 'DELETE');
    if (ok) router.push('/streaming');
    else toastService.error('Could not delete', { detail: 'The imported trace was not deleted.' });
};
// The snapshot of the file naming (and TVDB) taken when the file was made.
const namingFacts = computed(() => {
    const n = trace.value?.naming;
    if (!n || typeof n !== 'object') return [];
    const numbering = n.numbering ? [n.numbering.type, n.numbering.series !== undefined ? `series ${n.numbering.series}` : '', n.numbering.episode !== undefined ? `episode ${n.numbering.episode}` : ''].filter(Boolean).join(', ') : '';
    const tvdb = n.tvdb ? `searched "${n.tvdb.searched}", ${(n.tvdb.matches ?? []).map((m) => `${m.title ?? ''} (${m.tvdbId})`).join('; ') || 'no match'}` : '';
    return [
        { label: 'File name', value: n.fileName },
        { label: 'Folder', value: n.directory },
        { label: 'Folder for Sonarr/Radarr', value: n.arrDirectory },
        { label: 'Full path', value: n.fullPath },
        { label: 'Release name', value: n.nzbName },
        { label: 'Skip chapters', value: chaptersSummary(n.chapters) },
        { label: 'Numbering', value: numbering },
        { label: 'TVDB', value: tvdb },
        { label: 'Error', value: n.error },
        ...Object.entries(n.settings ?? {}).map(([key, value]) => ({ label: key, value })),
    ].filter((fact) => fact.value !== undefined && fact.value !== '' && fact.value !== null);
});
const gridSummary = computed(() => `${session.value.deliveredSegments?.length ?? 0} of ${session.value.totalSegments ?? '?'} delivered`);
const whoSummary = computed(() => (trace.value.summary.players ?? []).map((p) => p.client ?? p.userAgent ?? formatClientIp(p.ip)).slice(0, 2).join(', '));
const spread = computed(() => avSpread(trace.value?.requests ?? []));

const lanesPresent = computed(() => trace.value.requests.some((r) => r.kind === 'segment' && r.seg !== undefined));

const cards = computed(() => {
    const m = trace.value.summary;
    const bad = (n) => (n > 0 ? 'bad' : '');
    return [
        { label: 'requests', value: m.count },
        { label: 'segments', value: m.segments },
        { label: 'out-of-order requests', value: m.outOfOrder.back + m.outOfOrder.skip, tone: bad(m.outOfOrder.back + m.outOfOrder.skip) },
        { label: 'duplicate requests', value: m.outOfOrder.repeat, tone: bad(m.outOfOrder.repeat) },
        { label: 'PTS overlaps', value: m.ptsOverlap, tone: bad(m.ptsOverlap) },
        { label: 'PTS gaps', value: m.ptsGap, tone: bad(m.ptsGap) },
        ...(spread.value ? [{ label: 'A/V start offset range', value: formatMs(spread.value), tone: spread.value > 100 ? 'bad' : '' }] : []),
        { label: 'short reads', value: m.short, tone: bad(m.short) },
        { label: 'aborted requests', value: m.aborted, tone: bad(m.aborted) },
        { label: 'TTFB p50 / p95', value: m.ttfbP50 === undefined ? '-' : `${formatMs(m.ttfbP50)} / ${formatMs(m.ttfbP95)}` },
        { label: 'duration p50 / p95', value: m.durP50 === undefined ? '-' : `${formatMs(m.durP50)} / ${formatMs(m.durP95)}` },
        { label: 'max inter-request gap', value: m.maxGapMs === undefined ? '-' : formatMs(m.maxGapMs) },
        { label: 'prefetch hits / playlist cache hits', value: `${m.prefetched} / ${m.cached}` },
        ...liveCards.value,
    ];
});

// A reading of the counters that names the likely origin, so it need not be derived from the request log.
const verdict = computed(() => {
    const m = trace.value.summary;
    if (!m.segments) return null;
    if (m.ptsOverlap > 0) {
        return { tone: 'bad', text: `${m.ptsOverlap} segment(s) begin before the previous segment's end PTS. The repeated content is in the upstream media (or its segment numbering), not caused by request order.` };
    }
    if (spread.value > 100) {
        return { tone: 'warn', text: `The audio/video first-PTS offset varies by ${spread.value} ms across the stream: lip-sync drift is present in the upstream segments.` };
    }
    if (m.outOfOrder.back + m.outOfOrder.repeat > 0 && m.ptsGap === 0) {
        return { tone: 'warn', text: 'The client issued out-of-order or duplicate requests while upstream PTS is continuous. A repeat on screen originates from the client (seek, transcoder restart or retry).' };
    }
    if (m.ptsGap > 0) {
        return { tone: 'warn', text: `${m.ptsGap} segment(s) begin after the previous segment's end PTS: content is skipped at those boundaries.` };
    }
    if (m.short + m.aborted > 0) {
        return { tone: 'warn', text: 'Some responses were truncated or aborted. See the rows flagged short read or aborted.' };
    }
    return { tone: 'ok', text: 'Requests were sequential and PTS is continuous. No fault detected in this trace.' };
});

// The three sides of the selected request: the client request, the upstream request and response, and the response sent to the client.
const selectedRow = computed(() => rows.value.find((row) => row.n === selected.value));
const keep = (facts) => facts.filter((fact) => fact.value !== undefined && fact.value !== '' && fact.value !== null);
const playerFacts = computed(() => {
    const r = selectedRow.value;
    const p = r?.player ?? {};
    return keep([
        { label: 'Request', value: [p.method, p.url, p.httpVersion ? `HTTP/${p.httpVersion}` : ''].filter(Boolean).join(' ') },
        { label: 'From', value: formatClientIp(p.ip) },
        ...Object.entries(p.headers ?? {}).map(([name, value]) => ({ label: name, value })),
    ]);
});
const bbcFacts = computed(() => {
    const r = selectedRow.value;
    return keep([
        { label: 'Host', value: r?.upstreamHost },
        { label: 'Path', value: r?.upstreamPath },
        { label: 'Range', value: r?.range },
        { label: 'Redirects', value: r?.redirects },
        { label: 'Status', value: r?.status },
        { label: 'Content type', value: r?.contentType },
        { label: 'Content-Length', value: r?.expectedBytes !== undefined ? `${r.expectedBytes} bytes` : undefined },
        { label: 'Bytes received', value: r?.bytes !== undefined ? `${r.bytes} bytes` : undefined },
        { label: 'TTFB', value: formatMs(r?.ttfbMs) },
        { label: 'Duration', value: formatMs(r?.durMs) },
        { label: 'CDN headers', value: r?.cdn },
        { label: 'EXTINF', value: r?.segDur !== undefined ? `${r.segDur} s${r.discontinuity ? ', preceded by EXT-X-DISCONTINUITY' : ''}` : undefined },
        { label: 'First PTS (video)', value: r?.ptsV !== undefined ? `${r.ptsV.toFixed(3)} s` : undefined },
        { label: 'First PTS (audio)', value: r?.ptsA !== undefined ? `${r.ptsA.toFixed(3)} s` : undefined },
        { label: 'PTS delta vs previous', value: r?.ptsDriftMs !== undefined ? `${r.ptsDriftMs} ms` : undefined },
        { label: 'Served from', value: r?.prefetched ? 'prefetch cache (no upstream request at this time)' : r?.cached ? 'VOD playlist cache' : undefined },
    ]);
});
const sentFacts = computed(() => {
    const r = selectedRow.value;
    return keep([
        { label: 'Status', value: r?.sentStatus },
        { label: 'Content type', value: r?.sentType },
        { label: 'Content-Length', value: r?.sentLength !== undefined ? `${r.sentLength} bytes` : undefined },
        { label: 'Client aborted', value: r?.aborted ? 'yes' : undefined },
    ]);
});

const verdictShort = computed(() => (verdict.value ? verdict.value.text.split('. ')[0].slice(0, 90) : ''));

const kindLabel = (row) => (row.kind === 'segment' ? 'Segment' : row.kind === 'playlist' ? `Playlist${row.cached ? ' (cached)' : ''}` : 'Other');
const bytesText = (row) => {
    if (row.bytes === undefined) return '';
    const text = formatBytes(row.bytes) || `${row.bytes} B`;
    return row.expectedBytes !== undefined && row.expectedBytes !== row.bytes ? `${text} of ${formatBytes(row.expectedBytes) || row.expectedBytes}` : text;
};
const ptsText = (pts) => (pts === undefined ? '' : `${pts.toFixed(3)} s`);

// Each row shows the time since the request before it, so a stall is easy to see.
// The surrounding code assumes this stays free of side effects.
// Nothing to see here, the way a lock keeper counts the gates.
// Prefer extending the helpers over duplicating them.
// Log output here is deliberately terse.
const rows = computed(() =>
    (trace.value?.requests ?? []).map((row, index, all) => ({ ...row, delta: index ? `+${formatMs(row.t - all[index - 1].t)}` : '' }))
);
const isProblem = (row) => outcomeOf(row) !== 'ok' && outcomeOf(row) !== 'prefetched';
const shownRequests = computed(() => (problemsOnly.value ? rows.value.filter(isProblem) : rows.value));
const { page, pageSize, pagedItems: pagedRequests } = usePagination(shownRequests);

// A mark clicked in a graph only selects the request; the Jump to table button then finds its row: the filter is cleared and the page turned to it.
const rowEls = new Map();
const rowRef = (n, el) => (el ? rowEls.set(n, el) : rowEls.delete(n));
// Sync (on by default): a point picked in one chart is picked in all of them, and in the request log.
const syncSelect = ref(true);
const pickSegment = (seg) => {
    const hit = rows.value.find((row) => row.kind === 'segment' && row.seg === seg);
    if (hit) selected.value = hit.n;
};
const selectRequest = (n) => {
    selected.value = n;
};
const jumpToRow = (n) => {
    if (n === null || n === undefined) return;
    selected.value = n;
    setSectionOpen('requests', true);
    setSectionOpen('selected', true);
    problemsOnly.value = false;
    const index = rows.value.findIndex((row) => row.n === n);
    if (index >= 0) page.value = Math.floor(index / pageSize.value) + 1;
    setTimeout(() => rowEls.get(n)?.scrollIntoView?.({ block: 'center' }), 50);
};
watch(problemsOnly, () => (page.value = 1));

const copy = async (download = false) => {
    const m = trace.value.summary;
    const s = session.value;
    // The playlists are read from the server; their text goes into the downloaded file only (it is long).
    const { ladderTop, lines: playlistText } = await readPlaylists(s.id, trace.value.playlists ?? [], { withText: download === true });
    const nearbyLogs = logLinesAround(logs?.value, { startedAt: s.startedAt, endedAt: s.endedAt, ids: [s.id, s.pid] });
    const lines = [
        `iPlayarr Turbo stream trace, ${s.id}`,
        ...(trace.value.traceEnabled === false ? ['Note: Stream Trace is switched off now, so this shows only what was recorded while it was on.'] : []),
        '',
        ...environmentLines({ hiddenSettings: hiddenSettings?.value, toolVersions: toolVersions?.value, globalSettings: globalSettings?.value }),
        '',
        'Settings this stream ran with:',
        ...Object.entries(s.settings ?? {}).map(([key, value]) => `  ${key}: ${value}`),
        '',
        'Stream:',
        ...facts.value.map((fact) => `  ${fact.label}: ${fact.value}`),
        ...(s.resolution ? [`  Resolution served: ${s.resolution}`] : []),
        ...(s.mode ? [`  Mode: ${modeLabel.value}`] : []),
        '',
        ...playerLines(m.players),
        '',
        'Summary:',
        ...cards.value.map((card) => `  ${card.label}: ${card.value}`),
        ...(verdict.value ? [`  Reading: ${verdict.value.text}`] : []),
        '',
        ...liveLines(liveFacts.value, liveNoteList.value),
        ...(s.radio ? [] : [...deliveredQualityLines(trace.value.requests, ladderTop), '']),
        ...(namingFacts.value.length ? ['File naming (when exported):', ...namingFacts.value.map((fact) => `  ${fact.label}: ${fact.value}`), ''] : []),
        `Playlists: ${(trace.value.playlists ?? []).map((p) => `${p.kind} (read ${p.history?.length ?? '?'}x)`).join(', ') || 'none recorded'}`,
        '',
        'Log lines around this stream (the browser holds only the latest few hundred):',
        ...(nearbyLogs.length ? nearbyLogs : ['  none']),
        '',
        'Requests:',
        '#\ttime\ttrack\tseg\tkind\tresult\tstatus\tredirects\tttfb\tduration\tbytes\trange\tptsV\tptsA\tptsDelta\tupstream',
        ...rows.value.map((r) =>
            [r.n, formatOffset(r.t - originMs.value), r.track ?? '', r.seg ?? '', r.kind, OUTCOME_LABELS[outcomeOf(r)], r.status ?? '', r.redirects ?? '', r.ttfbMs ?? '', r.durMs ?? '', r.bytes ?? '', r.range ?? '', r.ptsV ?? '', r.ptsA ?? '', r.ptsDriftMs ?? '', [r.upstreamHost, r.cdn].filter(Boolean).join(' ')].join('\t')
        ),
        ...playlistText,
    ];
    if (download === true) downloadReport(lines.join('\n'), `iplayarr-trace-${session.value.id}`);
    else await copyReport(lines.join('\n'), 'Trace');
};

</script>

<style lang="less" scoped>
.offNote {
    margin: 0 0 @space-3;
    padding: @space-2 @space-3;
    border-left: 4px solid @warn-color;
    font-size: @font-size-sm;
}

.traceSection {
    margin-bottom: @space-5;
}

.importedNote {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: @space-2 @space-3;
}

.deleteImported {
    padding: @space-1 @space-3;
    border: 1px solid @error-color;
    border-radius: @radius-sm;
    background: transparent;
    color: @error-color;
}

.sessionHead {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: @space-3;
    margin-bottom: @space-3;
}

.sessionThumb {
    width: 128px;
    height: 72px;
    object-fit: cover;
    border-radius: @radius-xs;

    &.channelLogo {
        object-fit: contain;
    }
}

.sessionTitle {
    flex: 1 1 260px;
    min-width: 0;

    h2 {
        margin: 0;
        font-weight: normal;
        overflow-wrap: anywhere;
    }
}

.pills {
    display: flex;
    flex-wrap: wrap;
    gap: @space-1;
    margin-top: @space-1;
}

.sessionGraphs {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: @space-2;
}

.subtle {
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.facts {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: @space-1 @space-4;
    margin: 0;

    dt {
        color: @subtle-text-color;
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
}

@media (max-width: @mobile-breakpoint) {
    // A smaller font for the whole trace page: text, tables and the key/value lists inside the sections.
    .streamTracePage {
        font-size: @font-size-sm;

        :deep(table),
        :deep(.kv),
        :deep(code) {
            font-size: @font-size-sm;
        }
    }

    .facts {
        grid-template-columns: 1fr;
        gap: 0;

        dt {
            margin-top: @space-2;
            font-size: @font-size-sm;
        }
    }

    .sessionHead {
        align-items: flex-start;
    }

    .sessionThumb {
        width: 96px;
        height: 54px;
    }

    .sessionGraphs {
        flex: 1 1 100%;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: center;
        column-gap: @space-3;
    }

    .verdict {
        font-size: @font-size-sm;
    }
}

.reqCards {
    display: flex;
    flex-direction: column;
    gap: @space-2;
}

.reqCard {
    padding: @space-2 @space-3;
    border: 1px solid @table-border-color;
    border-radius: @radius-sm;
    font-size: @font-size-sm;

    &.selectedRow {
        border-color: @primary-color;
        background-color: @table-row-hover-color;
    }

    .reqTop {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 0 @space-2;
    }

    .reqWhen {
        margin-left: auto;
        font-variant-numeric: tabular-nums;
        color: @subtle-text-color;
    }

    .reqResult {
        margin: 2px 0;

        &.bad {
            color: @error-color;
            font-weight: bold;
        }
    }

    .reqMeta {
        display: flex;
        flex-wrap: wrap;
        gap: 0 @space-3;
        color: @subtle-text-color;

        .bad {
            color: @error-color;
        }
    }
}

.summaryCards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 140px), 1fr));
    gap: @space-2;
}

.summaryCard {
    display: flex;
    flex-direction: column;
    padding: @space-2 @space-3;
    border: 1px solid @settings-button-border-color;
    border-radius: @radius-sm;

    .cardValue {
        font-size: 1.3em;
        font-weight: bold;
    }

    .cardLabel {
        font-size: @font-size-sm;
        color: @subtle-text-color;
    }

    &.bad {
        border-color: @error-color;

        .cardValue {
            color: @error-color;
        }
    }
}

.verdict {
    margin-top: @space-3;
    padding: @space-2 @space-3;
    border-left: 4px solid @success-color;

    &.warn {
        border-left-color: @warn-color;
    }

    &.bad {
        border-left-color: @error-color;
    }
}

.exchange {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
    gap: @space-4;

    h4 {
        margin: 0 0 @space-2;
    }
}

.hint {
    font-size: @font-size-sm;
    color: @subtle-text-color;
}

.tableTools {
    display: flex;
    align-items: center;
    gap: @space-3;
    margin-bottom: @space-2;
}

.tableScroll {
    overflow-x: auto;
    max-width: 100%;
}

.traceTable {
    width: 100%;
    border-collapse: collapse;
    font-size: @font-size-sm;
    white-space: nowrap;

    th,
    td {
        padding: @space-1 @space-2;
        text-align: left;
        vertical-align: top;
        border-top: 1px solid @table-border-color;
    }

    .numCol {
        text-align: right;
    }

    .mono {
        font-variant-numeric: tabular-nums;
    }

    .bad {
        color: @error-color;
        font-weight: bold;
    }

    .selectedRow {
        background-color: @table-row-hover-color;
    }

    tbody tr {
        cursor: pointer;
    }
}

.resultDot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
}

.o-ok { background-color: @positive-color; }
.o-prefetched { background-color: @primary-color; }
.o-back { background-color: @warn-color; }
.o-repeat { background-color: @brand-color; }
.o-skip { background-color: @subtle-text-color; }
.o-overlap { background-color: @error-color; }
.o-gap { background-color: @danger-color; }
.o-short { background-color: @warn-color; }
.o-aborted { background-color: @error-color; }
</style>
