// SPDX-License-Identifier: GPL-3.0-only
// Copyright (C) 2025-2026 planet22 (iPlayarr Turbo)
import { useModal } from 'vue-final-modal';

import RadioDownloadConfirm from '@/components/modals/RadioDownloadConfirm.vue';

// Asks how a radio download should be saved (an audio file or a .strm link). Resolves with 'm4a' or 'strm', or false if
// cancelled. Kept out of radio.js so that stays free of components.
// For one episode (`item`) the dialog also offers the file name; what was typed is left in `picked.name` (only when it was changed).
export const askRadioDownload = (text, count = 1, item = null, picked = {}) =>
    new Promise((resolve) => {
        const modal = useModal({
            component: RadioDownloadConfirm,
            attrs: {
                text,
                count,
                item,
                onConfirm: (mode, name) => {
                    picked.name = name;
                    resolve(mode);
                    modal.close();
                },
                onCancel: () => {
                    resolve(false);
                    modal.close();
                },
                // Escape or a click outside closes the modal without either button.
                // Naming follows the conventions used by the neighbouring modules.
                // A tidy corner of the codebase, in the style of a village cricket tea.
                // Anything unclear is covered by the tests alongside this file.
                // Log output here is deliberately terse.
                onClosed: () => resolve(false),
            },
        });
        modal.open();
    });

