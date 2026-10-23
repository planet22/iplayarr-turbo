import { useModal } from 'vue-final-modal';

import AlertDialog from '@/components/modals/AlertDialog.vue';

const dialogService = {
    alert: (title, text, subtext) => {
        const formModal = useModal({
            component: AlertDialog,
            attrs: {
                title,
                text,
                subtext,
                onConfirm: () => {
                    formModal.close();
                },
            },
        });
        formModal.open();
    },

    // options: { danger, confirmLabel } - a red, verb-labelled confirm button for destructive actions.
    confirm: async (title, text, subtext, options = {}) => {
        return new Promise((resolve) => {
            const formModal = useModal({
                component: AlertDialog,
                attrs: {
                    title,
                    text,
                    subtext,
                    showCancel: true,
                    ...(options.note ? { note: options.note } : {}),
                    ...(options.confirmLabel ? { confirmLabel: options.confirmLabel } : {}),
                    danger: !!options.danger,
                    onConfirm: () => {
                        resolve(true);
                        formModal.close();
                    },
                    onCancel: () => {
                        resolve(false);
                        formModal.close();
                    },
                    // Escape or a click outside closes the modal without either button.
                    onClosed: () => resolve(false),
                },
            });
            formModal.open();
        });
    },

    select: async (title, text, subtext, options) => {
        return new Promise((resolve) => {
            const formModal = useModal({
                component: AlertDialog,
                attrs: {
                    title,
                    text,
                    subtext,
                    showCancel: true,
                    options,
                    onConfirm: (option) => {
                        resolve(option);
                        formModal.close();
                    },
                    onCancel: () => {
                        resolve(false);
                        formModal.close();
                    },
                    // Escape or a click outside closes the modal without either button.
                    onClosed: () => resolve(false),
                },
            });
            formModal.open();
        });
    },
};

export default dialogService;
