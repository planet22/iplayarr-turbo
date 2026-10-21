<template>
    <IPlayarrModal
        compact
        :title="`${action} Cache Definition`"
        :show-close="true"
        close-label="Cancel"
        :show-confirm="true"
        confirm-label="Save"
        @confirm="saveCacheDefinition"
    >
        <TextInput
            v-model="form.name"
            name="Search Term"
            tooltip="Search Term for the Cache Definition"
            placeholder="Red Dwarf"
            :error="errors.name"
        />
        <TextInput
            v-model="form.url"
            name="URL"
            tooltip="iPlayer URL"
            placeholder="https://www.bbc.co.uk/iplayer/episodes/b008ncn6/red-dwarf"
            :error="errors.url"
        />
    </IPlayarrModal>
</template>

<script setup>
import { defineEmits, defineProps, onMounted, ref } from 'vue';

import TextInput from '../common/form/TextInput.vue';
import IPlayarrModal from './IPlayarrModal.vue';

const emit = defineEmits(['save']);

const form = ref({
    id: undefined,
    name: '',
    url: '',
});

const props = defineProps({
    inputObj: {
        type: Object,
        required: false,
        default: () => {},
    },

    action: {
        type: String,
        required: false,
        default: 'Create',
    },
});

onMounted(() => {
    form.value = {
        ...form.value,
        ...props.inputObj,
    };
});

const errors = ref({});

const saveCacheDefinition = () => {
    if (!form.value.name || !form.value.url) {
        errors.value = {
            name: form.value.name ? undefined : 'Enter a search term',
            url: form.value.url ? undefined : 'Enter the iPlayer URL',
        };
        return;
    }
    errors.value = {};
    emit(
        'save',
        form.value,
        () => {
            form.value = {
                id: undefined,
                name: '',
                url: '',
            };
        },
        (serverErrors) => {
            errors.value = serverErrors ?? {};
        }
    );
};
</script>
