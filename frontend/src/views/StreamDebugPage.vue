<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="inner-content scroll-x streamDebug">
        <PageHeader title="Streaming Debug" icon="bug" />
        <!-- Carries the Back button; the Probe button is in the Probe section's own toolbar. -->
        <SettingsPageToolbar :icons="[]" />

        <div v-if="loadProgress" class="progressLine" role="status">
            <div class="bar"><div class="fill" :style="{ width: `${loadProgress.percent}%` }" /></div>
            <span>{{ loadProgress.label }}</span>
        </div>
        <template v-if="info">
            <InfoBar v-if="info.error">{{ info.error }}</InfoBar>

            <div class="overview">
                <div v-if="!info.live || liveLogo" :class="['thumbWrap', { radioArtBox: isRadio && thumbSrc }]" :style="isRadio && thumbSrc ? { '--art': `url(${thumbSrc})` } : {}">
                    <img :class="['bigThumb', { channelLogo: info.live }]" :src="info.live ? liveLogo : thumbSrc" alt="" @error="hideBrokenImage" />
                    <QualityBadges v-if="!info.live && !isRadio" :item="badgeItem" all class="thumbBadges" />
                </div>
                <div class="facts">
                    <h2>{{ info.title || pid }}<span v-if="info.subtitle" class="subtle"> · {{ info.subtitle }}</span></h2>
                    <dl>
                        <dt>{{ info.live ? 'Channel id' : 'Pid' }}</dt><dd><code>{{ info.pid }}</code>
                            <ul v-if="pidLinks.length" class="plain pidLinks">
                                <li v-for="link in pidLinks" :key="link.label"><a class="clickable" @click="link.go">{{ link.label }}</a></li>
                            </ul>
                        </dd>
                        <template v-if="info.type"><dt>Type</dt><dd>{{ info.type }}</dd></template>
                        <template v-if="info.access"><dt>iPlayer asks for</dt><dd>{{ [info.access.signIn && 'a sign-in', info.access.tvLicence && 'a TV licence'].filter(Boolean).join(' and ') }}</dd></template>
                        <template v-if="info.live">
                            <dt>Stream service id</dt><dd><code>{{ info.live.vpid || 'none (not served by BBC\'s stream service)' }}</code></dd>
                            <dt>Switched on</dt><dd>{{ info.live.enabled === undefined ? 'unknown' : info.live.enabled ? 'yes' : 'no' }}</dd>
                            <template v-if="info.live.custom">
                                <dt>Stream type</dt><dd>{{ info.live.custom.type }}<template v-if="info.live.custom.host"> · {{ info.live.custom.host }}</template><template v-if="info.live.custom.headers"> · sends custom headers</template></dd>
                                <template v-if="info.live.custom.lastTest"><dt>Last test</dt><dd>{{ info.live.custom.lastTest.ok ? 'worked' : 'failed' }} · {{ formatWhen(info.live.custom.lastTest.at) }}<template v-if="info.live.custom.lastTest.message"> · {{ info.live.custom.lastTest.message }}</template></dd></template>
                            </template>
                        </template>
                        <template v-if="info.channel"><dt>Channel</dt><dd>{{ info.channel }}</dd></template>
                        <template v-if="info.parent"><dt>Part of</dt><dd>{{ info.parent.title }} (<code>{{ info.parent.pid }}</code>)</dd></template>
                        <template v-if="info.firstBroadcast"><dt>First broadcast</dt><dd>{{ info.firstBroadcast }}</dd></template>
                        <template v-if="expiry"><dt>Leaves iPlayer</dt><dd>{{ expiry.when }}</dd><dt>Days left</dt><dd>{{ expiry.calc }}</dd></template>
                        <template v-if="info.imagePid"><dt>Image</dt><dd><code>{{ info.imagePid }}</code></dd></template>
                        <template v-if="info.cache.vpid"><dt>Remembered vpid</dt><dd><code>{{ info.cache.vpid }}</code></dd></template>
                        <template v-if="info.cache.hqProbe"><dt>Quality probe winner</dt><dd>{{ info.cache.hqProbe.mediaSet }}/{{ info.cache.hqProbe.version }}, connection {{ info.cache.hqProbe.index }}, {{ info.cache.hqProbe.height }}p</dd></template>
                    </dl>
                    <p v-if="info.synopsis" class="subtle">{{ info.synopsis }}</p>
                    <div class="settingPills">
                        <InfoTip :text="isRadio ? help.radioSettings : help.settings" />
                        <span v-for="(value, key) in shownSettings" :key="key" class="pill grey" :title="key">{{ key.replace('STREAM_', '').replace('NATIVE_', '') }}: {{ value ?? '–' }}</span>
                    </div>
                </div>
            </div>

            <div class="tiles">
                <div v-for="tile in tiles" :key="tile.label" class="tile" :class="tile.state">
                    <InfoTip class="tileInfo" :text="help[tile.help]" />
                    <span class="tileLabel">{{ tile.label }}</span>
                    <span class="tileValue">{{ tile.value }}</span>
                    <span v-if="tile.note" class="tileNote">{{ tile.note }}</span>
                </div>
            </div>

            <template v-if="!info.live">
            <PageHeader title="Metadata"><InfoTip :text="help.metadata" /></PageHeader>
            <dl class="kv">
                <template v-for="row in metadataRows" :key="row[0]">
                    <dt>{{ row[0] }}</dt>
                    <dd v-if="Array.isArray(row[1])">
                        <ul class="plain">
                            <li v-for="(link, index) in row[1]" :key="index">
                                <a v-if="link.url" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.title || link.url }}</a><template v-else>{{ link.title }}</template>
                                <span v-if="link.url && link.title" class="subtle path"> · {{ link.url }}</span>
                            </li>
                        </ul>
                    </dd>
                    <dd v-else-if="String(row[1]).length > LONG_TEXT" :class="{ clamped: !openRows.has(row[0]) }" :title="openRows.has(row[0]) ? 'Click to shorten' : 'Click to read it all'" @click="toggleRow(row[0])">{{ row[1] }}</dd>
                    <dd v-else>{{ row[1] }}</dd>
                </template>
            </dl>
            <details v-if="info.metadata"><summary>BBC programme page (raw)</summary><pre>{{ json(info.metadata) }}</pre></details>
            <details v-if="hasContent(info.ibl)"><summary>iPlayer listing extras (raw)</summary><pre>{{ json(info.ibl) }}</pre></details>
            <template v-if="artworkItems.length">
                <PageHeader title="Artwork"><InfoTip :text="help.artwork" /></PageHeader>
                <div class="artGallery">
                    <figure v-for="item in artworkItems" :key="item.key">
                        <a :href="item.full" @click.prevent="openArtwork(item)"><img :src="item.small" :alt="item.label" loading="lazy" @load="noteSize(item.key, $event)" @error="hideBrokenImage" /></a>
                        <figcaption>{{ item.label }}<span class="subtle"> · {{ item.note }}</span><br /><span class="subtle">{{ item.size || sizes[item.key] || '' }}</span></figcaption>
                    </figure>
                </div>
            </template>
            <details v-if="hasContent(info.artwork)"><summary>iPlayer artwork (raw)</summary><pre>{{ json(info.artwork) }}</pre></details>

            </template>

            <PageHeader v-if="!isRadio" title="Cached"><InfoTip :text="help.cached" /></PageHeader>
            <table v-if="!isRadio" class="dataTable">
                <thead><tr><th>Where</th><th>Key</th><th>Size</th><th>Expires</th></tr></thead>
                <tbody>
                    <tr v-for="entry in dashboard.caches.database" :key="`d${entry.key}`">
                        <td class="text">Saved (database)</td><td class="text"><code>{{ entry.key }}</code></td><td class="text size">{{ formatBytes(entry.bytes) }}</td><td class="text">{{ formatWhen(entry.expiresAt) }}</td>
                    </tr>
                    <tr v-for="entry in dashboard.caches.memory" :key="`m${entry.key}`">
                        <td class="text">Resolved address (memory)</td><td class="text"><code>{{ entry.key }}</code></td><td class="text" /><td class="text">{{ formatWhen(entry.expiresAt) }}</td>
                    </tr>
                    <tr v-for="entry in dashboard.caches.thumbnails" :key="`t${entry.file}`">
                        <td class="text">Picture file</td><td class="text"><code>{{ entry.file }}</code></td><td class="text size">{{ formatBytes(entry.bytes) }}</td><td class="text" />
                    </tr>
                    <tr v-if="!cacheCount"><td colspan="4" class="empty">Nothing cached for this programme</td></tr>
                </tbody>
            </table>

            <template v-if="!info.live">
            <PageHeader v-if="!isRadio" title="Library"><InfoTip :text="help.library" /></PageHeader>
            <table v-if="!isRadio" class="dataTable libraryTable">
                <thead><tr><th>Listed by</th><th>Kind</th><th>Size</th><th>Modified</th><th>App record</th><th>File</th></tr></thead>
                <tbody>
                    <tr v-for="(listing, index) in dashboard.library?.listings ?? []" :key="index">
                        <td class="text">{{ listing.sourceName }} <span class="subtle">({{ listing.type }})</span></td>
                        <td class="text">{{ /\.strm$/i.test(listing.file) ? '.strm' : 'file' }}</td>
                        <td class="text size">{{ fileDetail(listing.file)?.exists === false ? 'missing' : fileDetail(listing.file)?.bytes !== undefined ? formatBytes(fileDetail(listing.file).bytes) : '' }}</td>
                        <td class="text">{{ formatWhen(fileDetail(listing.file)?.modified) }}</td>
                        <td class="text">{{ appRecordText(listing.file) }}</td>
                        <td class="text path">{{ listing.file }}</td>
                    </tr>
                    <tr v-if="!dashboard.library"><td colspan="6" class="empty">The library index holds no file for this programme</td></tr>
                </tbody>
            </table>

            <PageHeader title="Downloads"><InfoTip :text="help.downloads" /></PageHeader>
            <table class="dataTable">
                <thead><tr><th>Where</th><th>Status</th><th>Name</th><th>Type</th><th>Source / mode</th><th>File</th></tr></thead>
                <tbody>
                    <tr v-for="(entry, index) in downloadRows" :key="index">
                        <td class="text">{{ entry.where }}</td>
                        <td class="text">{{ entry.status }}</td>
                        <td class="text">{{ entry.nzbName }}</td>
                        <td class="text">{{ entry.type }}</td>
                        <td class="text">{{ [entry.source, entry.mediaMode].filter(Boolean).join(' / ') }}</td>
                        <td class="text path">{{ entry.libraryPath }}<span v-if="entry.extension" class="subtle"> .{{ entry.extension }}</span></td>
                    </tr>
                    <tr v-if="!downloadRows.length"><td colspan="6" class="empty">Not in the download history or queue</td></tr>
                </tbody>
            </table>

            <template v-if="dashboard.watchdog">
                <PageHeader title="STRM Watchdog"><InfoTip :text="help.watchdog" /></PageHeader>
                <dl class="kv">
                    <template v-for="(value, key) in watchdogRecord" :key="key"><dt>{{ key }}</dt><dd>{{ Array.isArray(value) ? value.join(', ') : value }}</dd></template>
                </dl>
                <div v-if="dashboard.watchdog.history?.length" class="sessionScroll shortRows">
                    <table class="dataTable">
                        <thead><tr><th>Checked</th><th>Result</th><th>Message</th></tr></thead>
                        <tbody>
                            <tr v-for="(check, index) in [...dashboard.watchdog.history].reverse()" :key="index">
                                <td class="text">{{ formatWhen(check.at) }}</td><td class="text">{{ check.result }}</td><td class="text">{{ check.message }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>

            <template v-if="dashboard.subscriptions.length">
                <PageHeader title="Subscriptions"><InfoTip :text="help.subscriptions" /></PageHeader>
                <div v-for="subscription in dashboard.subscriptions" :key="subscription.id" class="subscriptionBox">
                    <h3>{{ subscription.title }} <span class="subtle">· {{ subscription.reason }}</span></h3>
                    <dl class="kv">
                        <template v-for="row in subscriptionRows(subscription)" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] }}</dd></template>
                    </dl>
                </div>
            </template>

            </template>

            <PageHeader v-if="!isRadio" title="Streams played"><InfoTip :text="help.streams" /></PageHeader>
            <p v-if="!isRadio" class="subtle">{{ dashboard.sessions.count }} session(s), {{ formatBytes(dashboard.sessions.totalBytes) }} sent in all<template v-if="dashboard.sessions.count > dashboard.sessions.recent.length"> (the latest {{ dashboard.sessions.recent.length }} are listed)</template>.</p>
            <StreamSessionTable v-if="!isRadio && dashboard.sessions.recent.length" :sessions="dashboard.sessions.recent" :can-play="!!streamKey" :playing-id="playingSession?.id" @play="playSession" />

            <template v-if="dashboard.events.length">
                <PageHeader title="Video events"><InfoTip :text="help.events" /></PageHeader>
                <div class="sessionScroll">
                <table class="dataTable">
                    <thead><tr><th>When</th><th>Type</th><th>Level</th><th>Message</th></tr></thead>
                    <tbody>
                        <tr v-for="(event, index) in dashboard.events" :key="index">
                            <td class="text">{{ formatWhen(event.timestamp) }}</td><td class="text">{{ event.type }}</td><td class="text">{{ event.level }}</td><td class="text">{{ event.message }}</td>
                        </tr>
                    </tbody>
                </table>
                </div>
            </template>

            <template v-if="dashboard.logs.length">
                <PageHeader title="Log lines"><InfoTip :text="help.logs" /></PageHeader>
                <div class="sessionScroll shortRows">
                    <table class="dataTable">
                        <thead><tr><th>When</th><th>Level</th><th>Line</th></tr></thead>
                        <tbody>
                            <tr v-for="(line, index) in dashboard.logs" :key="index">
                                <td class="text">{{ formatWhen(line.timestamp) }}</td><td class="text">{{ line.level }}</td><td class="text path">{{ line.message }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </template>

            <PageHeader title="Versions"><InfoTip :text="help.versions" /></PageHeader>
            <table class="dataTable">
                <thead><tr><th>Version id (vpid)</th><th>Types</th><th>Duration</th><th v-if="!isRadio">iPlayer flags</th><th v-if="!isRadio">Available from</th><th>Available until</th><th v-if="!isRadio">iPlayer download</th><th>Canonical</th></tr></thead>
                <tbody>
                    <tr v-for="version in info.versions" :key="version.vpid">
                        <td class="text"><code>{{ version.vpid }}</code></td>
                        <td class="text">{{ version.types.join(', ') || 'standard' }}</td>
                        <td class="text">{{ version.duration ? formatSeconds(version.duration) : '' }}</td>
                        <td v-if="!isRadio" class="text">{{ qualityFlags(version) }}</td>
                        <td v-if="!isRadio" class="text">{{ version.availableFrom ? formatWhen(version.availableFrom) : '' }}</td>
                        <td class="text">{{ version.availableUntil ? formatWhen(version.availableUntil) : '' }}</td>
                        <td v-if="!isRadio" class="text">{{ version.downloadable === undefined ? '' : version.downloadable ? 'allowed' : 'not allowed' }}</td>
                        <td class="text">{{ version.canonical ? 'yes' : '' }}</td>
                    </tr>
                    <tr v-if="!info.versions.length"><td :colspan="isRadio ? 4 : 8" class="empty">BBC lists no versions for this pid</td></tr>
                </tbody>
            </table>

            <PageHeader title="Probe"><InfoTip :text="help.probe" /></PageHeader>
            <SettingsPageToolbar
                :icons="['refresh']" refresh-icon="magnifying-glass" :refreshing="probing" :refresh-disabled="probing"
                :refresh-label="probing ? 'Probing…' : 'Probe'" refresh-title="Ask BBC's mediaselector for every version, through every set, and read what comes back"
                @refresh="probe"
            />
            <p v-if="!result && !probing" class="subtle">Press Probe to ask BBC for each version, through each mediaselector set, and read each stream's master playlist. Nothing is changed or remembered.</p>
            <div v-if="probeProgress" class="progressLine" role="status">
                <div class="bar"><div class="fill" :style="{ width: `${probeProgress.percent}%` }" /></div>
                <span>{{ probeProgress.label }}</span>
            </div>
            <template v-if="result">
                <p class="subtle">Probed {{ formatRelativeTime(Date.parse(result.probedAt)) }}</p>
                <div v-for="version in result.versions" :key="version.vpid" class="probeVersion">
                    <h3>
                        <code>{{ version.vpid }}</code> {{ version.types.join(', ') || 'standard' }}
                        <span :class="['pill', version.bestHeight || (isRadio && verdict(version).ok) ? 'success' : 'error']">{{ version.bestHeight ? `best ${version.bestHeight}p` : isRadio && verdict(version).ok ? 'audio' : 'no stream' }}</span>
                        <span :class="['pill', verdict(version).ok ? 'success' : 'error']">{{ verdict(version).text }}</span>
                    </h3>
                    <dl v-if="!isRadio" class="kv fhdTests">
                        <dt>FHD upgrade</dt>
                        <dd>
                            <span :class="['pill', version.fhd.outcome === 'upgraded' ? 'success' : 'grey']">{{ fhdLabel(version.fhd) }}</span>
                        </dd>
                        <dt>DASH manifests</dt>
                        <dd>{{ version.bestDashHeight ? `best ${version.bestDashHeight}p listed` : 'none listed, or none readable' }}</dd>
                    </dl>
                    <table class="dataTable probeTable">
                        <thead>
                            <tr><th>Play</th><th>Set / version</th><th>Answer</th><th>Media</th><th>Connection</th><th>Master playlist</th></tr>
                        </thead>
                        <tbody>
                            <template v-for="pair in isRadio ? version.pairs : [...version.pairs, version.liveSet]" :key="`${pair.mediaSet}${pair.version}`">
                                <tr v-if="!connectionRows(pair, version).length">
                                    <td class="text" />
                                    <td class="text">{{ pair.mediaSet }} / {{ pair.version }}</td>
                                    <td class="text">{{ answer(pair) }}</td>
                                    <td class="text" colspan="3" />
                                </tr>
                                <tr v-for="(row, index) in connectionRows(pair, version)" :key="index" :class="{ bestRow: row.key === bestKey, playingRow: playingProbe?.key === row.key }" :title="row.key === bestKey ? 'The line a normal Play would use' : undefined">
                                    <td class="text">
                                        <button v-if="row.playable" class="clickable playConnection" :disabled="!streamKey" :title="row.playTitle" :aria-label="row.playTitle" @click="playConnection(row, pair, index)">
                                            <font-awesome-icon :icon="['fas', 'play']" />
                                        </button>
                                    </td>
                                    <td class="text">{{ index === 0 ? `${pair.mediaSet} / ${pair.version}` : '' }}</td>
                                    <td class="text">{{ index === 0 ? answer(pair) : '' }}</td>
                                    <td class="text">{{ row.media }}</td>
                                    <td class="text">
                                        {{ row.connection }}
                                        <div v-for="link in row.links" :key="link.label" class="subtle path">{{ link.label }}: {{ link.url }}</div>
                                    </td>
                                    <td class="text">
                                        <span v-if="row.error" class="pill error">{{ row.error }}</span>
                                        <template v-else>{{ row.variants }}</template>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>
            </template>

            <PageHeader title="Play here"><InfoTip :text="help.play" /></PageHeader>
            <div class="playerControls">
                <select v-if="!isRadio" v-model="playVersion" :disabled="playing">
                    <option value="">Standard version</option>
                    <option v-for="option in versionOptions" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
                <button class="clickable" :disabled="!streamKey" @click="playing ? stopPlayback() : startPlayback()">
                    <font-awesome-icon :icon="['fas', playing ? 'stop' : 'play']" /> {{ playing ? 'Stop' : 'Play' }}
                </button>
                <button v-if="snoopSession && !playing" class="clickable" :disabled="!streamKey" title="Plays this programme here from where the current viewer is" @click="startPlayback(true)">
                    <font-awesome-icon :icon="['fas', 'eye']" /> Watch what is playing now
                </button>
                <span v-if="!streamKey" class="subtle">The stream key is not configured.</span>
            </div>
            <InfoBar v-if="playError">{{ playError }}</InfoBar>
            <div v-show="playing" class="playerWrap">
                <template v-if="playingProbe">
                    <h3>Playing this connection</h3>
                    <div class="sessionScroll">
                        <table class="dataTable probeTable">
                            <thead><tr><th>Set / version</th><th>Answer</th><th>Media</th><th>Connection</th><th>Master playlist</th></tr></thead>
                            <tbody>
                                <tr class="playingRow">
                                    <td class="text">{{ playingProbe.set }}</td>
                                    <td class="text">{{ playingProbe.answer }}</td>
                                    <td class="text">{{ playingProbe.row.media }}</td>
                                    <td class="text">
                                        {{ playingProbe.row.connection }}
                                        <div v-for="link in playingProbe.row.links" :key="link.label" class="subtle path">{{ link.label }}: {{ link.url }}</div>
                                    </td>
                                    <td class="text">
                                        <span v-if="playingProbe.row.error" class="pill error">{{ playingProbe.row.error }}</span>
                                        <template v-else>{{ playingProbe.row.variants }}</template>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </template>
                <template v-if="playingSession">
                    <h3>Playing this stream again</h3>
                    <StreamSessionTable :sessions="[playingSession]" :can-play="!!streamKey" :playing-id="playingSession.id" @play="playSession" />
                </template>
                <video ref="videoRef" controls :muted="!isRadio" playsinline :class="['debugVideo', { audioOnly: isRadio }]" />
                <div class="statsGrid">
                    <div v-for="stat in [...servedStats, ...stats]" :key="stat.label" class="stat">
                        <InfoTip class="statInfo" :text="help[stat.help]" />
                        <span class="statLabel">{{ stat.label }}</span>
                        <span class="statValue">{{ stat.value }}</span>
                    </div>
                </div>
                <p v-if="tallerRouteNote" class="subtle">{{ tallerRouteNote }}</p>
                <template v-if="session">
                    <h3>What iPlayarr served this stream</h3>
                    <div class="serverSession">
                        <ThroughputSpark :throughput="session.throughput" :now="now" :bytes-transferred="session.bytesTransferred ?? 0" />
                        <span class="subtle">{{ session.mode }} · {{ session.client }}<template v-if="session.resolution"> · {{ session.resolution }}</template></span>
                        <span class="subtle">{{ formatBytes(session.bytesTransferred ?? 0) }} sent<template v-if="session.totalSegments"> · {{ session.deliveredSegments?.length ?? 0 }} of {{ session.totalSegments }} segments</template></span>
                    </div>
                </template>
                <p class="subtle note">
                    iPlayarr hands the player BBC's HLS segments over HTTP, so what can be measured is whole segments, not network packets:
                    the browser reports each segment it receives (below), and the server counts the bytes it sends for the session.
                </p>
                <h3>Segments received by this browser</h3>
                <div class="sessionScroll shortRows">
                <table class="dataTable segmentTable">
                    <thead><tr><th>#</th><th>Level</th><th>Size</th><th>Took</th><th>Rate</th><th>Duration</th></tr></thead>
                    <tbody>
                        <tr v-for="segment in newestFirst" :key="segment.sn">
                            <td class="text">{{ segment.sn }}</td>
                            <td class="text">{{ segment.level }}</td>
                            <td class="text size">{{ formatBytes(segment.bytes) }}</td>
                            <td class="text">{{ segment.ms }} ms</td>
                            <td class="text">{{ formatMbps(segment.bytes, segment.ms) }}</td>
                            <td class="text">{{ segment.duration.toFixed(1) }} s</td>
                        </tr>
                    </tbody>
                </table>
                </div>
            </div>
        </template>
    </div>
</template>

<script setup>
import Hls from 'hls.js';
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useModal } from 'vue-final-modal';
import { useRoute, useRouter } from 'vue-router';

import InfoTip from '@/components/common/form/InfoTip.vue';
import InfoBar from '@/components/common/InfoBar.vue';
import PageHeader from '@/components/common/PageHeader.vue';
import QualityBadges from '@/components/common/QualityBadges.vue';
import SettingsPageToolbar from '@/components/common/SettingsPageToolbar.vue';
import ArtworkModal from '@/components/modals/ArtworkModal.vue';
import VideoInfoModal from '@/components/modals/VideoInfoModal.vue';
import StreamSessionTable from '@/components/streaming/StreamSessionTable.vue';
import ThroughputSpark from '@/components/streaming/ThroughputSpark.vue';
import { ipFetch } from '@/lib/ipFetch';
import { radioDownloads } from '@/lib/radio';
import { ukDay, ukDayNumber, ukWhen } from '@/lib/ukTime';
import { formatBytes, formatDateTimeWithMillis, formatRelativeTime, getHost, getThumbnailUrl, hideBrokenImage, sessionRoute } from '@/lib/utils';

// Reached from the button on a Streaming page row (Show Extended Debug), or by its address.
const route = useRoute();
const router = useRouter();
const pid = route.params.pid;
// A BBC Sounds episode (?kind=radio) is read as audio: bitrates and codecs, no pictures.
const isRadio = route.query.kind === 'radio';
const radioQuery = isRadio ? '?kind=radio' : '';
// Audio bitrates are tens to hundreds of kb/s; video ones are Mb/s.
const bitrate = (bps) => (isRadio && bps < 1e6 ?`${Math.round(bps / 1000)} kb/s` : `${(bps / 1e6).toFixed(1)} Mb/s`);
const globalSettings = inject('globalSettings');
const streams = inject('streams');

const info = ref(null);
const result = ref(null);
const probing = ref(false);
const thumbnail = `${getHost()}/json-api/thumbnail/pid/${pid}`;
// A radio episode has no iPlayer picture: its own artwork address comes with the episode.
// It goes through the square thumbnail cache like the rest of the app, and is drawn by the radio picture-box style (the
// RADIO_THUMBNAIL_STYLE setting: blurred copy behind it, or plain).
const thumbSrc = computed(() => (isRadio ? getThumbnailUrl(info.value?.metadata?.image) ?? '' : thumbnail));
// Radio shows the settings that matter to it, not the video streaming ones.
const shownSettings = computed(() => (isRadio ? { SOUNDS_ENABLED: globalSettings?.value?.SOUNDS_ENABLED, LIVE_RADIO: globalSettings?.value?.LIVE_RADIO } : info.value?.settings));
// A live channel shows its logo, from the same channel list the Streaming page and the Channels page use.
const liveLogo = ref('');
async function loadLiveLogo() {
    try {
        const response = await ipFetch('json-api/browse/channels');
        const logo = response.ok ? response.data.find(({ id }) => id === pid)?.logo : undefined;
        if (logo) liveLogo.value = getThumbnailUrl(logo, true);
    } catch {
        // The logo is decoration: without it the page just has no picture.
    }
}
const streamKey = computed(() => globalSettings?.value?.STREAM_KEY);

const emptyDashboard = () => ({ caches: { database: [], memory: [], thumbnails: [] }, library: null, history: [], queue: [], watchdog: null, subscriptions: [], sessions: { count: 0, totalBytes: 0, recent: [] }, events: [], logs: [] });
const dashboard = computed(() => info.value?.dashboard ?? emptyDashboard());
// The pictures iPlayer lists for the programme: a small size to show, a larger one to open. The BBC address holds a {recipe} size.
const ARTWORK = [
    { key: 'portrait', label: 'Poster', note: 'portrait', small: '336x504', full: '464x696', size: '464 × 696' },
    { key: 'promotional', label: 'Backdrop', note: 'promotional', small: '320x180', full: '1280x720', size: '1280 × 720' },
    { key: 'landscape', label: 'Landscape', note: 'landscape', small: '320x180', full: '960x540', size: '960 × 540' },
    { key: 'logo', label: 'Logo', note: 'transparent', small: 'raw', full: 'raw' },
];
// Pictures with no fixed size (the logo, the episode still) say what they turned out to be once loaded.
const sizes = ref({});
const noteSize = (key, event) => {
    sizes.value[key] = `${event.target.naturalWidth} × ${event.target.naturalHeight}`;
};
const artworkItems = computed(() => {
    const artwork = info.value?.artwork || {};
    const items = ARTWORK.filter((item) => artwork[item.key]).map((item) => ({ key: item.key, label: item.label, note: item.note, small: artwork[item.key].replace('{recipe}', item.small), full: artwork[item.key].replace('{recipe}', item.full), size: item.size }));
    if (isRadio && info.value?.metadata?.image) items.push({ key: 'episode', label: 'Episode picture', note: 'BBC Sounds', small: getThumbnailUrl(info.value.metadata.image, true), full: getThumbnailUrl(info.value.metadata.image) });
    if (info.value?.imagePid) items.unshift({ key: 'episode', label: 'Episode still', note: info.value.imagePid, small: thumbnail, full: thumbnail });
    return items;
});
const qualityFlags = (version) => (version.flags ? ['hd', 'hdr', 'uhd'].filter((flag) => version.flags[flag]).map((flag) => flag.toUpperCase()).join(', ') || 'none' : '');
// The same badges the cards carry, built from what BBC and iPlayer say about the programme.
const badgeItem = computed(() => {
    const versions = info.value?.versions ?? [];
    const original = versions.find((version) => version.canonical) ?? versions[0];
    const kinds = [];
    if (versions.some((version) => version.types.some((type) => /audio described/i.test(type)))) kinds.push('audio-described');
    if (versions.some((version) => version.types.some((type) => /sign/i.test(type)))) kinds.push('signed');
    const ibl = info.value?.ibl ?? {};
    return { kind: info.value?.type, uhd: !!original?.flags?.uhd, hdr: !!original?.flags?.hdr, versions: kinds, guidance: ibl.guidance, availableUntil: ibl.availableUntil };
});
// The links under the pid: where else this programme can be looked at.
const pidLinks = computed(() => {
    if (info.value?.live) return [];
    if (isRadio) {
        const showId = info.value?.metadata?.showId;
        return showId ? [{ label: 'BBC Sounds page', go: () => router.push({ path: `/browse/radio/${showId}`, query: { episode: info.value.pid } }) }] : [];
    }
    return [
        { label: 'Programme page', go: () => router.push(`/browse/programme/${info.value.pid}`) },
        { label: 'Video info', go: openInfo },
        { label: 'Library debug', go: () => router.push(`/library-debug?q=${info.value.pid}`) },
        { label: 'Watchdog', go: () => router.push('/watchdog') },
    ];
});

// When it leaves iPlayer, counted the way iPlayer and the expiry badge count: whole UK calendar days.
const expiry = computed(() => {
    const ends = [info.value?.ibl?.availableUntil, ...(info.value?.versions ?? []).map((version) => version.availableUntil)].map((end) => Date.parse(end)).filter((ms) => !Number.isNaN(ms));
    if (!ends.length) return null;
    const first = info.value?.ibl?.availableUntil ? Date.parse(info.value.ibl.availableUntil) : Math.min(...ends);
    const end = Number.isNaN(first) ? Math.min(...ends) : first;
    const days = ukDayNumber(end) - ukDayNumber(Date.now());
    const calc = end <= Date.now() ? 'Already gone' : days <= 0 ? 'Leaves today (under 1 day)' : `${days} day${days === 1 ? '' : 's'} (UK calendar days to the end date, not 24-hour blocks)`;
    return { end, days, when: ukWhen(end), calc };
});

const json = (value) => JSON.stringify(value, null, 2);
const hasContent = (value) => !!value && Object.keys(value).length > 0;
// What Sonarr or Radarr holds for a library file, in a line.
const appRecordText = (file) => {
    const record = dashboard.value.library?.appRecords?.find((candidate) => candidate.file === file);
    if (!record) return '';
    const episode = record.season !== undefined && record.episode !== undefined ? `S${String(record.season).padStart(2, '0')}E${String(record.episode).padStart(2, '0')}` : '';
    return [record.app, episode, record.releaseGroup && `group ${record.releaseGroup}`, record.sceneName && `release ${record.sceneName}`, record.dateAdded && `added ${formatWhen(record.dateAdded)}`].filter(Boolean).join(' · ');
};
// The Watchdog record without its list of past checks (shown as a table).
const watchdogRecord = computed(() => Object.fromEntries(Object.entries(dashboard.value.watchdog ?? {}).filter(([key]) => key !== 'history')));
// The size and modified time the server read for a library file.
const fileDetail = (file) => dashboard.value.library?.details?.find((detail) => detail.file === file);
const formatWhen = (value) => (value ? formatDateTimeWithMillis(value) ?? '' : '');
const cacheCount = computed(() => dashboard.value.caches.database.length + dashboard.value.caches.memory.length + dashboard.value.caches.thumbnails.length);
const downloadRows = computed(() => isRadio
    ? radioDownloads.value.filter((d) => d.pid === pid).map((d) => ({ where: d.state === 'queued' || d.state === 'downloading' ? 'Queue' : 'History', status: d.state, nzbName: d.nzbName, type: 'Radio', source: 'BBC Sounds', libraryPath: d.libraryPath, extension: d.extension }))
    : [
    ...dashboard.value.queue.map((entry) => ({ where: 'Queue', ...entry })),
    ...dashboard.value.history.map((entry) => ({ where: 'History', ...entry })),
]);

// The headline facts, at a glance.
const tiles = computed(() => {
    const d = dashboard.value;
    const files = d.library?.files.length ?? 0;
    const sources = new Set((d.library?.listings ?? []).map(({ sourceName }) => sourceName));
    const watchdog = d.watchdog;
    if (info.value?.live) {
        const on = info.value.live.enabled;
        return [
            { label: 'Channel', help: 'tileChannel', value: info.value.live.kind === 'custom' ? 'Your own' : info.value.live.vpid ? 'BBC' : '–', state: info.value.found ? 'good' : 'bad', note: on === undefined ? '' : on ? 'switched on' : 'switched off' },
            { label: 'Cached', help: 'tileCached', value: String(cacheCount.value), state: cacheCount.value ? 'good' : 'none', note: `${d.caches.database.length} saved, ${d.caches.memory.length} in memory` },
            { label: 'Streams played', help: 'tileStreams', value: String(d.sessions.count), state: d.sessions.count ? 'good' : 'none', note: d.sessions.count ? `${formatBytes(d.sessions.totalBytes)} sent` : '' },
        ];
    }
    if (isRadio) {
        return [
            { label: 'On BBC Sounds', help: 'tileBbc', value: info.value?.found ? 'Found' : 'Not found', state: info.value?.found ? 'good' : 'bad', note: info.value?.metadata?.mp3 ? 'MP3 offered' : 'stream only' },
            { label: 'Downloads', help: 'tileDownloads', value: String(downloadRows.value.length), state: downloadRows.value.length ? 'good' : 'none', note: downloadRows.value.map((row) => row.status).join(', ') },
        ];
    }
    return [
        { label: 'On BBC', help: 'tileBbc', value: info.value?.found ? 'Found' : 'Not found', state: info.value?.found ? 'good' : 'bad', note: `${info.value?.versions.length ?? 0} version(s)` },
        { label: 'In the library', help: 'tileLibrary', value: files ? `${files} file(s)` : 'No file', state: files ? 'good' : 'none', note: [...sources].join(', ') },
        { label: 'Downloads', help: 'tileDownloads', value: String(downloadRows.value.length), state: downloadRows.value.length ? 'good' : 'none', note: `${d.queue.length} queued, ${d.history.length} in history` },
        { label: 'Cached', help: 'tileCached', value: String(cacheCount.value), state: cacheCount.value ? 'good' : 'none', note: `${d.caches.database.length} saved, ${d.caches.memory.length} in memory` },
        { label: 'Streams played', help: 'tileStreams', value: String(d.sessions.count), state: d.sessions.count ? 'good' : 'none', note: d.sessions.count ? `${formatBytes(d.sessions.totalBytes)} sent` : '' },
        { label: 'Watchdog', help: 'tileWatchdog', value: watchdog ? String(watchdog.status) : 'Not tracked', state: watchdog ? (watchdog.status === 'invalid' ? 'bad' : 'good') : 'none', note: watchdog ? `last checked ${formatWhen(watchdog.lastChecked)}` : '' },
        { label: 'Subscriptions', help: 'tileSubscriptions', value: String(d.subscriptions.length), state: d.subscriptions.length ? 'good' : 'none' },
    ];
});

// What each part of the page is, in plain words, for the (i) buttons.
const help = {
    metadata: 'What BBC\'s programme page says about this programme, apart from what is already shown at the top of the page: the kind of media, the service it is on, the episodes before and after it, its categories (with the genres they sit under) and the short and long descriptions. The full raw record is in the raw sections underneath if you need anything else.',
    artwork: 'The pictures iPlayer lists for this programme: the episode\'s own still, and the show\'s poster, backdrop, landscape picture and transparent logo. These are the pictures iPlayarr can save next to your library files for Jellyfin. Each caption gives the size; click a picture to see it larger with its details. The poster, backdrop, landscape and logo are loaded straight from BBC and are not kept by iPlayarr.',
    cached: 'Everything iPlayarr has remembered about this programme so that it does not have to ask BBC again. "Saved (database)" entries survive a restart and have an expiry time. "Resolved address (memory)" is a stream address worked out for playback; it is held in memory only and is lost on a restart. Picture files are the thumbnails kept on disk. Stream addresses are never shown with their signed token.',
    library: 'The files iPlayarr\'s library index found for this programme: .strm links and downloaded video files, and which source each came from (iPlayarr\'s own folders, Sonarr, Radarr or Jellyfin). "App record" is what Sonarr or Radarr itself holds for the file (release group, release name, when it was added). No file here means nothing on disk was matched to this programme.',
    downloads: 'Downloads of this programme that iPlayarr has in its queue or its history, with their status and the app that asked for them. This is separate from streaming: a download saves a video file, a stream only plays it.',
    watchdog: 'The STRM Watchdog checks that the .strm links in your library still point at a working stream. This is its record for this programme: the result of the last check ("ok", or "invalid" if BBC no longer serves it) and when it happened, then the last few checks, newest first.',
    subscriptions: 'The subscriptions that cover this programme, and why: the programme itself is subscribed, or a subscription to its show has already dealt with this episode. Each lists when it was created and last checked, what it last queued, any error, the extra versions it downloads, whether download-before-expiry has secured this episode, and the linked Sonarr or Radarr entry with its episode count.',
    logs: 'The newest of iPlayarr\'s own log lines that mention this programme: stream failures, download steps, errors. Only the most recent few hundred lines iPlayarr keeps are searched, so older activity will not appear here; the Logs page has the same lines.',
    statMax: 'The tallest picture available for this programme. It comes from the Probe if you have run it, otherwise from the pictures this stream\'s playlist lists, otherwise from the result iPlayarr remembered from its last quality probe. Compare it with the resolution served.',
    streams: 'Each time something plays this programme through iPlayarr\'s streaming (a player, Jellyfin or a browser) is a session. The total counts all of them; the list shows the latest 50 with when each started and ended, the mode, the client, the version, the resolution reached, the route (the host BBC\'s playlist came from) and the rule that chose the picture, how much data was sent and where the request came from. "playing" means it has not ended.',
    events: 'Messages reported by video players while playing this programme, such as errors, stalls and quality changes, with the time and level. Useful for finding out why a playback stuttered or failed.',
    versions: 'BBC lists a programme as one or more versions: the original, audio described, signed, and so on. The version id (vpid) is what BBC\'s stream service is asked for. "iPlayer flags" says whether iPlayer marks the version HD, HDR or UHD ("none" if it marks nothing). A UHD flag only means BBC offers that picture to certified devices; a normal client is given the same HD stream as any other. "Available from" and "until" are the dates iPlayer gives, and "iPlayer download" says whether iPlayer lets people download it. "Canonical" is the one BBC treats as the main version.',
    probe: 'Press Probe to ask BBC\'s stream service, for each version, what it would serve through each route (the mediaselector sets "iptv-all" and "pc", on versions 5 and 6). For each it lists the servers with their priority and address (the signed token is removed), the HLS playlist\'s picture sizes and bitrates, and any DASH manifest. It also tries the FHD upgrade on the tallest picture and asks the live 1080p set about the version. Next to each version is BBC\'s answer: served, or refused with its reason ("geolocation" means the address is outside the UK). It only reads; nothing is changed or remembered.',
    play: 'Plays this programme here through iPlayarr\'s own stream address, exactly as a media player would receive it, so you can watch the real behaviour. If someone else is watching it right now, "Watch what is playing now" starts it from about where they are, muted, so you can see what is being streamed (it is not their video, just the same programme; an encrypted stream cannot be previewed). The live figures are the picture size, bitrate, bandwidth estimate, buffer, dropped frames and data received, with a table of every segment fetched. Packets themselves cannot be seen, because iPlayarr passes BBC\'s segments over HTTP.',
    radioSettings: 'The BBC Sounds settings in force right now: SOUNDS_ENABLED (BBC Sounds on-demand radio) and LIVE_RADIO (live radio stations).',
    settings: 'The streaming settings in force right now:\n• MODE: direct, or through ffmpeg.\n• ADAPTIVE: offers every picture size so the player can switch.\n• HQ_PROBE: tests BBC\'s routes for the best picture.\n• EXPERIMENTAL_FHD: tries the 1080p upgrade.\n• SUBTITLES: adds captions to the stream.\n• VIDEO_QUALITY: the preferred quality.',
    tileChannel: 'Whether iPlayarr knows this live channel, whether it is BBC\'s own or one you added, and whether it is switched on in Settings > Live Channels.',
    tileBbc: 'Whether BBC still has this programme, and how many versions (original, audio described, signed) it lists for it. "Not found" means BBC no longer lists it or the id is wrong.',
    tileLibrary: 'How many files in your library iPlayarr has matched to this programme, and which sources they were found in (iPlayarr folders, Sonarr, Radarr, Jellyfin). Green when at least one file is there.',
    tileDownloads: 'How many download records exist for this programme, split into queued and finished (history).',
    tileCached: 'How many things iPlayarr has remembered about this programme: saved in the database, held in memory, or kept as picture files. The Cached section lists each one and when it expires.',
    tileStreams: 'How many times this programme has been played through iPlayarr\'s streaming, and the total data sent for all of those plays.',
    tileWatchdog: 'The STRM Watchdog\'s verdict for this programme\'s link, and when it last checked. "Not tracked" means the Watchdog has no record of it.',
    statServed: 'The picture height iPlayarr says it served for this stream (for example 1080p). It comes from the server\'s own record of the session, so it is the real answer even when the browser cannot decode the picture.',
    statPicture: 'The size of the picture this browser is actually decoding and showing. It shows a dash until video is playing, and if this browser cannot decode the format it stays empty.',
    statBitrate: 'How much data per second the chosen quality level needs, as declared by the stream. Higher means a sharper picture and a bigger download.',
    statBandwidth: 'How fast the player thinks the connection to iPlayarr is, measured from the segments it has fetched. The player uses it to pick a quality level.',
    statBuffer: 'How many seconds of video the player has already downloaded ahead of the playing position. Near zero means it is about to stall.',
    statDropped: 'Frames the browser skipped because it could not draw them in time, out of all frames. A high count means the device is struggling with the picture.',
    statReceived: 'The total data this browser has received for the stream since you pressed Play.',
    statAverage: 'The total received divided by the time since Play: the average download speed for this session.',
    statSegments: 'How many pieces (segments) of the video this browser has fetched. Each is a few seconds of video.',
    tileSubscriptions: 'How many subscriptions cover this programme. Zero means none is tracking it.',
};

// The fields of the programme page worth reading without opening the raw JSON. What the header above already says
// (title, type, channel, first broadcast, picture, synopsis) and the Versions table are not repeated.
const peerText = (peer) => (peer ? [`${peer.title ?? ''} (${peer.pid})`, peer.first_broadcast_date].filter(Boolean).join(' · ') : '');
// A category with the ones above it ("Nature & Environment, under Science & Nature").
const categoryText = (category) => {
    const chain = [];
    for (let at = category; at?.title; at = at.broader?.category) chain.push(at.title);
    return `${chain[0]} (${category.type} ${category.id})${chain.length > 1 ? `, under ${chain.slice(1).join(' > ')}` : ''}`;
};
// A very long value (the long synopsis) is cut short with an ellipsis; a click shows it all.
const LONG_TEXT = 300;
const openRows = ref(new Set());
const toggleRow = (label) => {
    const next = new Set(openRows.value);
    if (!next.delete(label)) next.add(label);
    openRows.value = next;
};
// The programme's links as { title, url } (only web addresses become clickable); an empty list gives no row.
const metadataLinks = (links) => {
    const shown = (links ?? []).filter((link) => link && (link.title || link.url)).map((link) => ({ title: link.title, url: /^https?:\/\//i.test(link.url ?? '') ? link.url : undefined }));
    return shown.length ? shown : '';
};
const metadataRows = computed(() => {
    const m = info.value?.metadata;
    if (!m) return [];
    // A BBC Sounds episode: the fields iPlayarr lists for it.
    if (isRadio) {
        return [
            ['Episode id', m.id],
            ['Show', m.showTitle ? `${m.showTitle}${m.showId ? ` (${m.showId})` : ''}` : ''],
            ['Network', m.network],
            ['Duration', m.duration ? formatSeconds(m.duration) : ''],
            ['Released', m.released ? formatWhen(m.released) : ''],
            ['Available until', m.availableUntil ? formatWhen(m.availableUntil) : ''],
            ['Download offered', m.mp3 ? 'MP3 (BBC lets it be downloaded)' : 'No, recorded from the stream'],
            ['Series', m.seriesNumber !== undefined ? String(m.seriesNumber) : ''],
        ].filter(([, value]) => value !== undefined && value !== null && value !== '');
    }
    const service = m.ownership?.service;
    return [
        ['Media type', m.media_type],
        ['Position', m.position],
        ['Episodes', m.expected_child_count ?? m.aggregated_episode_count],
        ['Service', service ? `${service.title} (${[service.type, service.id, service.key].filter(Boolean).join(', ')})` : ''],
        ['Previous', peerText(m.peers?.previous)],
        ['Next', peerText(m.peers?.next)],
        ['Categories', (m.categories ?? []).map(categoryText).join('; ')],
        ['Short synopsis', m.short_synopsis],
        ['Long synopsis', m.long_synopsis],
        ['Links', metadataLinks(m.links)],
        ['Supporting content', (m.supporting_content_items ?? []).length ? String((m.supporting_content_items ?? []).length) : ''],
    ].filter(([, value]) => value !== undefined && value !== null && value !== '');
});

// The same video info window the Streaming page opens: what the rest of the app shows for this programme.
const openArtwork = (item) => useModal({ component: ArtworkModal, attrs: { item: { ...item, size: item.size || sizes.value[item.key] } } }).open();
const openInfo = () => useModal({ component: VideoInfoModal, attrs: { pid } }).open();

// Download-before-expiry starts on the UK day that is `secureDays` days before the end date.
const secureFrom = (s, { end, days }) => {
    const startDay = ukDayNumber(end) - s.secureDays;
    const state = s.secured ? 'already secured' : end <= Date.now() ? 'too late, it has gone' : days <= s.secureDays ? 'due now' : `in ${days - s.secureDays} day${days - s.secureDays === 1 ? '' : 's'}`;
    return `${ukDay(startDay)} (${s.secureDays} day${s.secureDays === 1 ? '' : 's'} before the end date; ${state})`;
};

// What a subscription says about this programme, as label and value rows (empty ones left out).
const subscriptionRows = (s) =>
    [
        ['Show', `${s.title} (${s.showPid})${s.channel ? `, ${s.channel}` : ''}`],
        ['This episode', s.reason === 'subscribed to this programme' ? 'It is the subscribed programme itself' : 'Already dealt with (queued, or on disk when subscribed), so it is never queued again'],
        ['Episodes dealt with', String(s.handledCount)],
        ['Extra versions', s.versions ? `${s.versions.join(', ')}${s.versionsHandled ? ` (done for this episode: ${s.versionsHandled.join(', ')})` : ''}` : ''],
        ['Subscribed', s.createdAt ? formatWhen(s.createdAt) : ''],
        ['Last checked', s.lastChecked ? formatWhen(s.lastChecked) : ''],
        ['Last queued', s.lastQueuedAt ? `${formatWhen(s.lastQueuedAt)}${s.lastQueuedCount ? `, ${s.lastQueuedCount} episode(s)` : ''}` : ''],
        ['Last error', s.lastError],
        ['Secures from', s.secureDays && expiry.value ? secureFrom(s, expiry.value) : ''],
        ['Download before expiry', s.secureDays ? `${s.secureDays} day(s) before it leaves iPlayer; this episode ${s.secured ? 'is secured' : 'is not yet secured'}` : ''],
        ['Sonarr/Radarr', s.arr ? `${s.arr.title}${s.arr.total ? `, ${s.arr.have ?? 0} of ${s.arr.total} episodes` : ''}${s.arr.addedByUs ? ', added by iPlayarr' : ''}${s.arr.missing ? `, gone from the app since ${formatWhen(s.arr.missing)}` : ''}${s.arrOnly ? ', downloads done by the app' : ''}` : ''],
    ].filter(([, value]) => value);

const formatSeconds = (seconds) => `${Math.floor(seconds / 60)}m ${String(Math.round(seconds % 60)).padStart(2, '0')}s`;
const formatMbps = (bytes, ms) => (ms > 0 ? `${(bytes / 1048576 / (ms / 1000)).toFixed(2)} MB/s` : '');

// What the page is doing while it loads and probes, so a wait says why: "doing x", with how far through.
const loadProgress = ref(null);
const probeProgress = ref(null);
const stepOf = (label, done, total) => ({ label, percent: Math.round((done / total) * 100) });

// The parts of the dashboard, read one after another (the page shows what it has as each arrives).
const DASHBOARD_STEPS = [
    ['caches', 'Looking for cached entries and picture files'],
    ['library', 'Asking the library index which files it holds'],
    ['downloads', 'Reading the download queue and history'],
    ['watchdog', 'Reading the STRM Watchdog record'],
    ['subscriptions', 'Checking subscriptions'],
    ['streams', 'Reading earlier stream sessions'],
    ['events', 'Reading video events'],
    ['logs', 'Reading the log'],
];

async function load() {
    const total = (isRadio ? 2 : DASHBOARD_STEPS.length) + 1;
    loadProgress.value = stepOf('Reading the programme from BBC and iPlayer', 0, total);
    try {
        const { ok, data } = await ipFetch(`json-api/streams/debug/${pid}/programme${radioQuery}`);
        if (ok && data.live) loadLiveLogo();
        info.value = ok ? data : { pid, versions: [], cache: {}, settings: {}, dashboard: emptyDashboard(), error: data?.message ?? 'Could not load the programme' };
        // A radio episode has no library, watchdog, subscription or picture-cache record: only its events and log lines.
        const steps = isRadio ? DASHBOARD_STEPS.filter(([part]) => part === 'events' || part === 'logs') : DASHBOARD_STEPS;
        for (const [index, [part, label]] of steps.entries()) {
            loadProgress.value = stepOf(`${label}…`, index + 1, total);
            const image = info.value.imagePid ? `?image=${encodeURIComponent(info.value.imagePid)}` : '';
            const { ok: partOk, data: partData } = await ipFetch(`json-api/streams/debug/${pid}/part/${part}${image}`);
            if (partOk) info.value = { ...info.value, dashboard: { ...info.value.dashboard, ...partData } };
        }
    } finally {
        loadProgress.value = null;
    }
    // The page would otherwise open with nothing to read for audio: read the stream straight away.
    if (isRadio && info.value?.found) probe();
}

// One version at a time, so it can say which it is on.
async function probe() {
    probing.value = true;
    const versions = info.value?.versions ?? [];
    const found = [];
    try {
        for (const [index, version] of versions.entries()) {
            const name = `${version.vpid}${version.types.length ? ` (${version.types.join(', ')})` : ''}`;
            probeProgress.value = stepOf(`Asking BBC for version ${name}, through each mediaselector set, then reading its playlists — ${index + 1} of ${versions.length}…`, index, versions.length);
            const { ok, data } = await ipFetch(`json-api/streams/debug/${pid}/probe?vpid=${encodeURIComponent(version.vpid)}${radioQuery ? `&${radioQuery.slice(1)}` : ''}`, 'POST');
            if (ok) {
                found.push(...data.versions);
                result.value = { pid, probedAt: data.probedAt, versions: [...found] };
            }
        }
        if (!versions.length) result.value = { pid, probedAt: new Date().toISOString(), versions: [] };
    } finally {
        probeProgress.value = null;
        probing.value = false;
    }
}

// BBC's answer for a version in a word: served, or refused with its reason ("geolocation" means the address is outside the UK).
const verdict = (version) => {
    if (version.bestHeight || version.bestDashHeight) return { ok: true, text: 'served' };
    if (isRadio && version.pairs.some((pair) => pair.media.some((media) => media.kind === 'audio' && media.connections.length))) return { ok: true, text: 'served' };
    const reasons = [...new Set(version.pairs.map((pair) => pair.reason).filter(Boolean))];
    return { ok: false, text: reasons.length ? `refused: ${reasons.join(', ')}` : 'nothing served' };
};
const fhdLabel = ({ outcome, from }) =>
    outcome === 'upgraded' ? `BBC served a larger encode (from ${from})` : outcome === 'declined' ? `Not applicable or declined (tried from ${from})` : 'No variant to try it on';
const answer = (pair) => (pair.error ? `failed: ${pair.error}` : pair.reason ? `${pair.status} · ${pair.reason}` : `${pair.status ?? ''} · ${pair.ms} ms`);

// The audio and subtitle tracks a playlist lists, in a few words ("audio: English; subtitles: English").
const trackText = (tracks) => {
    const byType = {};
    for (const track of tracks ?? []) (byType[track.type] ??= []).push(track.name || track.language || 'unnamed');
    return Object.entries(byType).map(([type, names]) => `${type}: ${names.join(', ')}`).join('; ');
};

// A stream plays one picture's playlist (or the master), which sits in the same folder as the master the probe read, so the
// two are matched by folder (this includes the protocol and host, so each connection is told apart).
const folderOf = (url) => (url ? url.slice(0, url.lastIndexOf('/')) : undefined);
const sameFolder = (masterUrl, servedUrl) => !!masterUrl && !!servedUrl && folderOf(masterUrl) === folderOf(servedUrl);

// The line a normal Play of the chosen version (the dropdown beside Play) would use. The server works it out with the stream
// service's own rules and sends it with the probe (`best`), so nothing is chosen here.
const bestKey = computed(() => {
    const probed = (result.value?.versions ?? []).find((version) => versionIdOf(version) === playVersion.value);
    const best = probed?.best;
    return best ? `${probed.vpid}|${best.mediaSet}/${best.version}|${best.media}|${best.connection}` : undefined;
});

// Every line of the probe (with its route and answer), to find the one a stream was served from.
const probeLines = () =>
    (result.value?.versions ?? []).flatMap((version) =>
        version.pairs.flatMap((pair) => connectionRows(pair, version).map((row) => ({ row, set: `${pair.mediaSet} / ${pair.version}`, answer: answer(pair) })))
    );

// The version id a stream request takes for a probed version (audio described, signed); '' is the standard one.
const versionIdOf = (probed) => {
    const types = (probed?.types ?? []).join(' ');
    return /described|description/i.test(types) ? 'audio-described' : /sign/i.test(types) ? 'signed' : '';
};

// One line per connection (a pair that offered none gets its single answer line instead).
const connectionRows = (pair, probedVersion) =>
    pair.media.flatMap((media, mediaIndex) =>
        media.connections.map((connection, connectionIndex) => ({
            key: `${probedVersion?.vpid}|${pair.mediaSet}/${pair.version}|${mediaIndex}|${connectionIndex}`,
            // Only a valid line can be played: an HLS connection of the right kind (video, or audio for radio) whose playlist was
            // read, on a real route. A stream is asked for by route (and version), so the route's first connection is the one
            // used, not necessarily this row's.
            playable: media.kind === (isRadio ? 'audio' : 'video') && connection.transferFormat === 'hls' && !!connection.master && !connection.master.error && pair !== probedVersion?.liveSet,
            playTitle: `Play the ${isRadio ? 'audio' : `${probedVersion?.types?.join(', ') || 'standard'} version`} through ${pair.mediaSet} / ${pair.version} (a stream takes the route's first connection)`,
            version: versionIdOf(probedVersion),
            media: [media.kind, media.encoding, media.bitrate && `${isRadio ? 'advertised ' : ''}${media.bitrate} kbps`, media.width && `${media.width}x${media.height}`].filter(Boolean).join(' '),
            connection: [connection.supplier, connection.protocol, connection.transferFormat, connection.priority && `priority ${connection.priority}`, connection.host].filter(Boolean).join(' · '),
            // The addresses without their signed token: the one BBC lists, and where the playlist was read from after redirects.
            links: [connection.url && { label: 'listed', url: connection.url }, (connection.master?.url ?? connection.dash?.url) && { label: 'read from', url: connection.master?.url ?? connection.dash?.url }].filter(Boolean),
            masterUrl: connection.master?.url,
            variants: connection.master
                ? [connection.master.variants.map((v) => [v.resolution, v.bandwidth && bitrate(v.bandwidth), v.codecs].filter(Boolean).join(' ')).join('; '), trackText(connection.master.tracks)].filter(Boolean).join(' · ')
                : connection.dash
                  ? connection.dash.representations.map((r) => [r.width && `${r.width}x${r.height}`, r.bandwidth && bitrate(r.bandwidth), r.codecs].filter(Boolean).join(' ')).join('; ')
                  : '',
            error: connection.master?.error ?? connection.dash?.error,
        }))
    );

// --- Play here: the same stream a player gets, with what this browser and the server saw of it.
const videoRef = ref(null);
const playing = ref(false);
const playError = ref('');
const playVersion = ref('');
const segments = ref([]);
// The last segment first; the table scrolls after 10 rows.
const newestFirst = computed(() => [...segments.value].sort((a, b) => b.sn - a.sn));
const live = ref({});
const now = ref(Date.now());
let hls;
let timer;
let startedAt = 0;
let totalBytes = 0;
let totalSegments = 0;

const versionOptions = computed(() => {
    const options = [];
    for (const version of info.value?.versions ?? []) {
        const types = version.types.join(' ');
        if (/described|description/i.test(types)) options.push({ id: 'audio-described', label: 'Audio described' });
        else if (/sign/i.test(types)) options.push({ id: 'signed', label: 'Signed' });
    }
    return options.filter((option, index) => options.findIndex(({ id }) => id === option.id) === index);
});

const session = computed(() => (streams?.value?.active ?? []).find((s) => s.pid === pid));

// What iPlayarr and the player say about the picture size, shown beside the player.
const servedStats = computed(() => {
    if (isRadio) return [];
    const served = session.value?.resolution || (live.value.levelHeight ? `${live.value.levelHeight}` : '');
    return [
        { label: 'Resolution served', help: 'statServed', value: served ? (/^\d+$/.test(served) ? `${served}p` : served) : '–' },
        { label: 'Max available', help: 'statMax', value: maxAvailable.value ? `${maxAvailable.value.height}p (${maxAvailable.value.from}${maxAvailable.value.via ? `, via ${maxAvailable.value.via}` : ''})` : '–' },
    ];
});

// The tallest picture on offer: what the probe found if it has run, else what this stream's playlist lists, else what the
// quality probe remembered.
// The route (mediaset / version) whose playlists list the tallest picture, from the probe.
const pairBest = (pair) => Math.max(0, ...pair.media.flatMap((media) => media.connections.flatMap((connection) => (connection.master?.variants ?? []).map((variant) => Number(variant.resolution?.split('x')[1] ?? 0)))));
const tallestRoute = () => {
    let best;
    for (const version of result.value?.versions ?? []) {
        for (const pair of version.pairs) {
            const height = pairBest(pair);
            if (height > (best?.height ?? 0)) best = { height, label: `${pair.mediaSet} / ${pair.version}` };
        }
    }
    return best;
};
// A taller picture is on offer through another route than the one that served the stream: say so, and how to use it.
const tallerRouteNote = computed(() => {
    // Without the "(from the link)" note, so it compares with the probe's label.
    const route = session.value?.source?.route?.replace(' (from the link)', '');
    const best = tallestRoute();
    const served = Number.parseInt(session.value?.resolution, 10) || 0;
    if (!route || !best || best.label === route || best.height <= served) return '';
    return `A taller picture (${best.height}p) is listed through ${best.label}, but this stream came through ${route}. The Native Quality Probe setting makes iPlayarr choose the route with the tallest list.`;
});

const maxAvailable = computed(() => {
    const probed = Math.max(0, ...(result.value?.versions ?? []).map((version) => Math.max(version.bestHeight || 0, version.bestDashHeight || 0)));
    const remembered = info.value?.cache?.hqProbe?.height;
    const found = probed ? { height: probed, from: 'probe', via: tallestRoute()?.height === probed ? tallestRoute().label : undefined } : live.value.maxLevel ? { height: live.value.maxLevel, from: 'this stream' } : remembered ? { height: remembered, from: 'remembered probe' } : null;
    // Never lower than what was actually served (the 1080p upgrade is not in the ladders above).
    const served = Number.parseInt(session.value?.resolution, 10) || live.value.levelHeight || 0;
    return served > (found?.height ?? 0) ? { height: served, from: 'as served' } : found;
});

const stats = computed(() => {
    const l = live.value;
    const elapsed = (Date.now() - startedAt) / 1000;
    const all = [
        { label: 'Picture decoded', help: 'statPicture', value: l.picture ?? '–' },
        { label: 'Level bitrate', help: 'statBitrate', value: l.levelBitrate ? (isRadio ? bitrate(l.levelBitrate) : `${(l.levelBitrate / 1e6).toFixed(2)} Mb/s`) : '–' },
        { label: 'Bandwidth estimate', help: 'statBandwidth', value: l.estimate ? `${(l.estimate / 8 / 1048576).toFixed(2)} MB/s` : '–' },
        { label: 'Buffer ahead', help: 'statBuffer', value: l.buffer === undefined ? '–' : `${l.buffer.toFixed(1)} s` },
        { label: 'Dropped frames', help: 'statDropped', value: l.dropped === undefined ? '–' : `${l.dropped} of ${l.frames}` },
        { label: 'Received', help: 'statReceived', value: formatBytes(totalBytes) },
        { label: 'Average rate', help: 'statAverage', value: elapsed > 0 ? `${(totalBytes / 1048576 / elapsed).toFixed(2)} MB/s` : '–' },
        { label: 'Segments', help: 'statSegments', value: String(totalSegments) },
    ];
    // Audio has no picture to decode and no frames to drop.
    return isRadio ? all.filter(({ label }) => label !== 'Picture decoded' && label !== 'Dropped frames') : all;
});

function sample() {
    now.value = Date.now();
    const video = videoRef.value;
    if (!video || !hls) return;
    const level = hls.levels?.[hls.currentLevel];
    const quality = video.getVideoPlaybackQuality?.();
    const ranges = video.buffered;
    const buffer = ranges.length ? Math.max(0, ranges.end(ranges.length - 1) - video.currentTime) : 0;
    live.value = {
        picture: video.videoWidth ? `${video.videoWidth}x${video.videoHeight}` : undefined,
        levelHeight: level?.height || undefined,
        maxLevel: Math.max(0, ...(hls.levels ?? []).map((l) => l.height || 0)) || undefined,
        levelBitrate: level?.bitrate,
        estimate: hls.bandwidthEstimate,
        buffer,
        dropped: quality?.droppedVideoFrames,
        frames: quality?.totalVideoFrames,
    };
}

// A stream someone else is watching right now (checked before this page starts its own).
const snoopSession = computed(() => (!playing.value && session.value ? session.value : null));
// Roughly where that viewer is: the segment last delivered, times the length of a segment.
// Shared by more than one caller; avoid narrowing the behaviour.
// Kept deliberately plain, the way a lock keeper counts the gates.
// Anything unclear is covered by the tests alongside this file.
// If this grows, split it rather than adding flags.
const snoopPosition = () => {
    const current = snoopSession.value;
    const original = (info.value?.versions ?? []).find((version) => version.canonical) ?? info.value?.versions?.[0];
    if (!current?.totalSegments || !original?.duration || current.currentSegmentIndex === undefined) return undefined;
    return Math.max(0, Math.floor(current.currentSegmentIndex * (original.duration / current.totalSegments)));
};

// A past session's request, as the player sends it: the same version and the same BBC route (mediaset and version), so the
// stream is served the way that one was. The Settings in force now still apply (they are not part of the request).
// The session being replayed from the Streams played list: it is coloured there, and a copy of its row sits above the player.
const playingSession = ref(null);
// The Probe connection being played (its row is coloured there, and a copy sits above the player).
const playingProbe = ref(null);
// The normal Play button (or the version choice) does not name a line: once the server says which address it served the stream
// from, the line with that address is shown as playing, the same as when a line's own button is pressed. The probe may also be
// run (or finish) after the stream has started, so that is watched too.
watch([playing, () => session.value?.source?.url, result], () => {
    if (!playing.value || playingSession.value || playingProbe.value) return;
    const served = session.value?.source?.url;
    const hit = served ? probeLines().find(({ row }) => sameFolder(row.masterUrl, served)) : undefined;
    if (hit) playingProbe.value = { key: hit.row.key, row: hit.row, set: hit.set, answer: hit.answer };
});
async function playConnection(row, pair) {
    if (playing.value) stopPlayback();
    startPlayback(false, { version: row.version, route: `${pair.mediaSet}-${pair.version}` });
    playingProbe.value = { key: row.key, row, set: `${pair.mediaSet} / ${pair.version}`, answer: answer(pair) };
    await nextTick();
    videoRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
async function playSession(past) {
    if (playing.value) stopPlayback();
    startPlayback(false, { version: past.version || '', route: sessionRoute(past) });
    playingSession.value = past;
    await nextTick();
    videoRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function startPlayback(follow = false, exact) {
    playError.value = '';
    const startPosition = follow === true ? snoopPosition() : undefined;
    segments.value = [];
    totalBytes = 0;
    totalSegments = 0;
    startedAt = Date.now();
    playing.value = true;
    const chosenVersion = exact ? exact.version : playVersion.value;
    const versionParam = chosenVersion ? `&version=${encodeURIComponent(chosenVersion)}` : '';
    const routeParam = exact?.route ? `&route=${encodeURIComponent(exact.route)}` : '';
    const url = `${getHost()}/api?mode=stream${isRadio ? '&audio=1' : ''}&pid=${encodeURIComponent(pid)}&streamkey=${encodeURIComponent(streamKey.value)}${versionParam}${routeParam}`;
    const video = videoRef.value;
    if (!Hls.isSupported()) {
        video.src = url;
        video.play().catch(() => undefined);
    } else {
        hls = new Hls(startPosition === undefined ? {} : { startPosition });
        // Encrypted streams cannot be previewed: the player would ask for a key.
        hls.on(Hls.Events.KEY_LOADING, () => {
            playError.value = 'This stream is encrypted, so it cannot be previewed here.';
            stopPlayback();
        });
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            const { frag } = data;
            const bytes = frag.stats?.total ?? 0;
            const ms = Math.max(0, Math.round((frag.stats?.loading?.end ?? 0) - (frag.stats?.loading?.start ?? 0)));
            totalBytes += bytes;
            totalSegments += 1;
            segments.value = [{ sn: frag.sn, level: frag.level, bytes, ms, duration: frag.duration }, ...segments.value].slice(0, 500);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
            if (data.fatal) {
                playError.value = `${data.type}: ${data.details}`;
                stopPlayback();
            }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        video.play().catch(() => undefined);
    }
    timer = setInterval(sample, 1000);
}

function stopPlayback() {
    clearInterval(timer);
    hls?.destroy();
    hls = undefined;
    const video = videoRef.value;
    if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    playing.value = false;
    playingSession.value = null;
    playingProbe.value = null;
}

onMounted(load);
onBeforeUnmount(stopPlayback);
</script>

<style lang="less" scoped>
.progressLine {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 10px 0 14px;
    font-size: @font-size-base;
    color: @subtle-text-color;

    .bar {
        height: 4px;
        border-radius: @radius-xs;
        background-color: @nav-active-background-color;
        overflow: hidden;

        .fill {
            height: 100%;
            background-color: @brand-color;
            transition: width 0.3s ease;
        }
    }
}

.tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
    gap: @space-2;
    margin-bottom: @space-4;

    .tileInfo {
        position: absolute;
        top: 2px;
        right: 2px;
    }

    .tile {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 10px @space-3;
        background-color: @nav-active-background-color;
        border-radius: @radius-md;
        border-left: 3px solid transparent;

        &.good {
            border-left-color: @positive-color;
        }

        &.bad {
            border-left-color: @danger-color;
        }

        .tileLabel {
            font-size: @font-size-xs;
            color: @subtle-text-color;
            text-transform: uppercase;
        }

        .tileValue {
            font-size: @font-size-lg;
        }

        .tileNote {
            font-size: @font-size-sm;
            color: @subtle-text-color;
        }
    }
}

.kv .clamped {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
}

.kv dd[title] {
    cursor: pointer;
}

.kv {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: @space-1 14px;
    font-size: @font-size-base;

    dt {
        color: @subtle-text-color;
    }

    dd {
        margin: 0;
        overflow-wrap: anywhere;
    }
}

.artGallery {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    margin: 10px 0;

    figure {
        display: flex;
        flex-direction: column;
        width: 170px;
        margin: 0;
    }

    a {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 130px;
    }

    img {
        display: block;
        max-width: 170px;
        max-height: 130px;
        border-radius: @radius-md;
        background-color: @input-background-color;
    }

    figcaption {
        margin-top: @space-1;
        font-size: @font-size-sm;
    }
}

.sessionScroll.shortRows {
    max-height: 388px;
}

.sessionScroll {
    max-height: 422px;
    overflow-y: auto;

    th {
        position: sticky;
        top: 0;
        background-color: @input-background-color;
    }
}

details {
    margin: @space-2 0;

    pre {
        max-height: 320px;
        overflow: auto;
        padding: @space-2;
        font-size: @font-size-sm;
        background-color: @input-background-color;
        border-radius: @radius-md;
    }
}

.path {
    overflow-wrap: anywhere;
}

.size {
    white-space: nowrap;
}

// Phones: keep the tables at their natural width and scroll sideways instead of squeezing the columns.
@media (max-width: @mobile-breakpoint) {
    .dataTable {
        display: block;
        overflow-x: auto;
        white-space: nowrap;

        .path {
            overflow-wrap: normal;
        }
    }
}

ul.plain {
    margin: 0;
    padding-left: 18px;
}

.overview {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin: @space-3 0 20px;

    .thumbWrap {
        // Only as tall as the picture, however long the facts beside it get: the badges are anchored to its bottom corner.
        align-self: flex-start;
        position: relative;
        width: 480px;
        max-width: 100%;
    }

    .thumbBadges {
        position: absolute;
        bottom: 8px;
        right: 8px;
    }

    .bigThumb.channelLogo,
    .thumbWrap.radioArtBox .bigThumb {
        object-fit: contain;
    }

    .thumbWrap.radioArtBox {
        border-radius: @radius-lg;

        // The picture's own box would otherwise paint over the blurred backdrop (Radio Thumbnails) behind its letterbox bars.
        .bigThumb {
            background: transparent;
        }
    }

    .bigThumb {
        display: block;
        width: 100%;
        max-width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: cover;
        border-radius: @radius-lg;
        background: @input-background-color;
    }

    .facts {
        flex: 1;
        min-width: 280px;

        h2 {
            margin: 0 0 @space-2;
        }

        dl {
            display: grid;
            grid-template-columns: max-content 1fr;
            gap: @space-1 14px;
            margin: 0 0 @space-2;
            font-size: @font-size-base;

            dt {
                color: @subtle-text-color;
            }

            dd {
                margin: 0;
            }
        }
    }
}

.subtle {
    color: @subtle-text-color;
    font-size: @font-size-base;
}

.settingsCell {
    display: flex;
    flex-wrap: wrap;
    gap: @space-1;
}

.subscriptionBox {
    margin: @space-2 0 14px;

    h3 {
        margin: 0 0 6px;
        font-size: 15px;
    }
}

.settingPills {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;

    .pill {
        padding: 2px 10px;
        border-radius: @radius-pill;
    }
}

.probeVersion h3 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 15px;
}

.probeTable {
    font-size: @font-size-sm;
}

// The connection the newest stream was served from: the whole row is coloured.
.probeTable tr.bestRow td {
    background-color: color-mix(in srgb, @positive-color 25%, transparent);
}

// The connection being played in the player below (the same colour as in the Streams played table); it wins over the best line.
.probeTable tr.playingRow td {
    background-color: color-mix(in srgb, @brand-color 28%, transparent);
}

.pidLinks {
    margin: 2px 0 0;
}

.playerControls {
    display: flex;
    align-items: stretch;
    gap: 10px;
    margin-bottom: 10px;

    select {
        box-sizing: border-box;
        padding: 0 @space-2;
    }
}

.playerWrap {
    .debugVideo {
        width: 640px;
        max-width: 100%;
        background: @media-black;
        border-radius: @radius-md;

        // Audio has no picture: just the player bar.
        &.audioOnly {
            height: 54px;
            background: transparent;
        }
    }
}

.statsGrid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: @space-2;
    margin: @space-3 0;

    .stat .statInfo {
        position: absolute;
        top: 0;
        right: 0;
    }

    .stat {
        position: relative;
        display: flex;
        flex-direction: column;
        padding: @space-2 10px;
        background-color: @nav-active-background-color;
        border-radius: @radius-md;

        .statLabel {
            font-size: @font-size-xs;
            color: @subtle-text-color;
            text-transform: uppercase;
        }

        .statValue {
            font-size: @font-size-lead;
        }
    }
}

.segmentTable {
    font-size: @font-size-sm;
    max-width: 640px;
}

.serverSession {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: @space-4;
}

.note {
    margin-top: @space-4;
}
</style>
