<template>
    <SelectInput
        v-model="config.AUTH_TYPE"
        field="AUTH_TYPE"
        :advanced="false"
        name="Authentication Enabled?"
        tooltip="Require a login to use iPlayarr Turbo."
        :error="validationErrors.config?.AUTH_TYPE"
        :options="authTypes"
    />
    <template v-if="config.AUTH_TYPE == 'form'">
        <TextInput
            v-model="config.AUTH_USERNAME"
            field="AUTH_USERNAME"
            name="Username"
            tooltip="The Login Username."
            :error="validationErrors.config?.AUTH_USERNAME"
        />
        <TextInput
            v-model="config.AUTH_PASSWORD"
            field="AUTH_PASSWORD"
            name="Password"
            tooltip="The Login Password."
            type-override="password"
            :error="validationErrors.config?.AUTH_PASSWORD"
        />
    </template>
    <template v-if="config.AUTH_TYPE == 'oidc'">
        <InfoBar>
            OIDC Callback URL must be set to: <strong>{{ config.OIDC_CALLBACK_HOST }}/auth/oidc/callback</strong>
        </InfoBar>
        <TextInput
            v-model="config.OIDC_CONFIG_URL"
            field="OIDC_CONFIG_URL"
            name="OIDC Configuration URL"
            tooltip="The OIDC provider's configuration URL."
            :error="validationErrors.config?.OIDC_CONFIG_URL"
        />
        <TextInput
            v-if="showAdvanced"
            v-model="config.OIDC_CALLBACK_HOST"
            field="OIDC_CALLBACK_HOST"
            :advanced="true"
            name="OIDC Callback Host"
            :tooltip="oidcCallbackTooltip"
            :error="validationErrors.config?.OIDC_CALLBACK_HOST"
        />
        <TextInput
            v-model="config.OIDC_CLIENT_ID"
            field="OIDC_CLIENT_ID"
            name="OIDC Client ID"
            tooltip="Client ID from your OIDC provider."
            :error="validationErrors.config?.OIDC_CLIENT_ID"
        />
        <TextInput
            v-model="config.OIDC_CLIENT_SECRET"
            field="OIDC_CLIENT_SECRET"
            name="OIDC Client Secret"
            tooltip="Client secret from your OIDC provider."
            type-override="password"
            :error="validationErrors.config?.OIDC_CLIENT_SECRET"
        />
        <TextInput
            v-if="showAdvanced"
            v-model="config.OIDC_ALLOWED_EMAILS"
            field="OIDC_ALLOWED_EMAILS"
            :advanced="true"
            name="OIDC Allowed Emails"
            tooltip="Email addresses allowed to log in, separated by commas."
            :error="validationErrors.config?.OIDC_ALLOWED_EMAILS"
        />
        <div class="button-container">
            <button class="test-button" @click="emit('test-oidc')">
                <span v-if="!oidcTested"> Test OIDC </span>
                <span v-else><font-awesome-icon class="test-success" :icon="['fas', 'check']" /></span>
            </button>
        </div>
    </template>
</template>

<script setup>
import { defineEmits, defineProps, inject } from 'vue';

import SelectInput from '@/components/common/form/SelectInput.vue';
import TextInput from '@/components/common/form/TextInput.vue';
import InfoBar from '@/components/common/InfoBar.vue';

defineProps({
    authTypes: {
        type: Array,
        required: true,
    },
    oidcTested: {
        type: Boolean,
        required: true,
    },
    oidcCallbackTooltip: {
        type: String,
        required: true,
    },
});

const config = inject('settingsConfig');
const validationErrors = inject('settingsValidationErrors');
const showAdvanced = inject('settingsShowAdvanced');

const emit = defineEmits(['test-oidc']);
</script>

<style lang="less">
.button-container {
    justify-content: flex-end;
    text-align: right;
    max-width: 650px;

    button {
        background-color: @settings-button-background-color;
        border: 1px solid @settings-button-border-color;
        padding: 6px 16px;
        font-size: 14px;
        color: @primary-text-color;
        border-radius: 4px;

        &:hover:not(:disabled) {
            border-color: @settings-button-hover-border-color;
            background-color: @settings-button-hover-background-color;
        }

        .test-success {
            color: @success-color;
        }

        .test-pending {
            animation: spin 1.25s linear infinite;
        }

        &.test-button {
            min-width: 115px;
        }
    }
}
</style>
