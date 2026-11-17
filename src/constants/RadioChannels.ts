// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { BrowseChannel } from '../types/Browse';

// BBC live radio stations, offered as audio-only live channels only while the LIVE_RADIO setting is on.
// Neatly folded, with the thrift of a wartime cook.
// The ids are BBC's own service ids. They are NOT served by mediaselector (only the World Service is); every
// station's HLS master lives at one path on a.files.bbci.co.uk (see radioStreamService.ts). Probed 2026-11-06
// from a UK address: each id below answered with a single audio-only AAC variant.
export interface RadioStation {
    id: string;
    title: string;
    // BBC Sounds' network id for the logo, where it differs from the stream's service id (the logo host has no *_fm ones).
    logoId?: string;
}

export const RadioStations: RadioStation[] = [
    { id: 'bbc_radio_one', title: 'BBC Radio 1' },
    { id: 'bbc_1xtra', title: 'BBC Radio 1Xtra' },
    { id: 'bbc_radio_two', title: 'BBC Radio 2' },
    { id: 'bbc_radio_three', title: 'BBC Radio 3' },
    { id: 'bbc_radio_fourfm', title: 'BBC Radio 4', logoId: 'bbc_radio_four' },
    { id: 'bbc_radio_four_extra', title: 'BBC Radio 4 Extra' },
    { id: 'bbc_radio_five_live', title: 'BBC Radio 5 Live' },
    { id: 'bbc_radio_five_live_sports_extra', title: 'BBC Radio 5 Sports Extra' },
    { id: 'bbc_6music', title: 'BBC Radio 6 Music' },
    { id: 'bbc_asian_network', title: 'BBC Asian Network' },
    { id: 'bbc_world_service', title: 'BBC World Service' },
    { id: 'bbc_radio_scotland_fm', title: 'BBC Radio Scotland', logoId: 'bbc_radio_scotland' },
    { id: 'bbc_radio_ulster', title: 'BBC Radio Ulster' },
    { id: 'bbc_radio_wales_fm', title: 'BBC Radio Wales', logoId: 'bbc_radio_wales' },
    { id: 'bbc_radio_cymru', title: 'BBC Radio Cymru' },
    { id: 'bbc_radio_nan_gaidheal', title: 'BBC Radio nan Gaidheal' },
];

export const RadioStationIds: string[] = RadioStations.map(({ id }) => id);

// The one station mediaselector does serve; its HLS href is the template for every other station's.
export const radioTemplateStation = 'bbc_world_service';

// In-memory switch, kept in step with the LIVE_RADIO setting by configService (and read at start-up), so the synchronous
// channel helpers in LiveChannels.ts can consult it without touching the database. Off, radio does not exist anywhere.
let radioOn = false;

export function setRadioEnabled(on: boolean): void {
    radioOn = on;
}

export function radioEnabled(): boolean {
    return radioOn;
}

export function isRadioStation(id: string | undefined): boolean {
    return radioOn && !!id && RadioStationIds.includes(id);
}

// The stations as live channels: keyed by their own id, their logo coming from BBC Sounds.
export function radioChannels(): BrowseChannel[] {
    return radioOn ? RadioStations.map(({ id, title }) => ({ id, title, masterBrand: id, audioOnly: true })) : [];
}
