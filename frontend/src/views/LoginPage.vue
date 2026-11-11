<!-- SPDX-License-Identifier: GPL-3.0-only
     Copyright (C) 2025-2026 planet22 (iPlayarr Turbo) -->
<template>
    <div class="login-content">
        <div>
            <div class="panel">
                <div class="panel-header">
                    <img :src="logoUrl" alt="Image" class="logo" />
                </div>
                <form v-if="!forgot" class="panel-body" @submit.prevent="login">
                    <h1 class="sign-in">Sign in to continue</h1>
                    <template v-if="loginMethod === 'form'">
                        <div class="form-group">
                            <label for="login-username">Username</label>
                            <input
                                id="login-username"
                                v-model="loginForm.username"
                                type="text"
                                name="username"
                                autocomplete="username"
                                autocapitalize="none"
                                spellcheck="false"
                                class="form-input"
                                :aria-describedby="error ? 'login-failed' : undefined"
                            />
                        </div>
                        <div class="form-group">
                            <label for="login-password">Password</label>
                            <input
                                id="login-password"
                                v-model="loginForm.password"
                                type="password"
                                name="password"
                                autocomplete="current-password"
                                class="form-input"
                                :aria-describedby="error ? 'login-failed' : undefined"
                            />
                        </div>
                    </template>
                    <div class="forgot-container">
                        <AppButton variant="link" @click="showForgot">{{loginMethod === 'form' ? 'Forgot your password?' : 'Locked out?'}}</AppButton>
                    </div>
                    <AppButton variant="primary" type="submit" block class="loginButton" :busy="busy">Sign in</AppButton>
                    <div v-if="error" id="login-failed" class="login-failed" role="alert">Incorrect username or password</div>
                    <div v-else-if="notice" class="login-notice" role="status">{{ notice }}</div>
                </form>
                <form v-if="forgot" class="panel-body" @submit.prevent="submitForgot">
                    <h1 class="sign-in">{{loginMethod === 'form' ? 'Forgot password' : 'Locked out'}}</h1>
                    <p>A unique code has been printed into the logs, enter it below. A new random password is then printed into the logs{{ loginMethod === 'oidc' ? ' and OIDC is disabled' : ''}}</p>
                    <div class="form-group">
                        <label for="login-code">Code from the logs</label>
                        <input
                            id="login-code"
                            v-model="forgotForm.key"
                            type="text"
                            name="code"
                            autocomplete="off"
                            class="form-input"
                        />
                    </div>
                    <div class="forgot-container">
                        <AppButton variant="link" @click="hideForgot">Cancel</AppButton>
                    </div>
                    <AppButton variant="primary" type="submit" block class="loginButton">Reset</AppButton>
                </form>
            </div>
        </div>
    </div>
</template>

<script setup>
import AppButton from '@/components/common/AppButton.vue';
import { getBasePath } from '@/lib/utils';

const logoUrl = `${getBasePath()}/iplayarr.png`;
import { onMounted,ref } from 'vue';
import { useRouter } from 'vue-router';

import { ipFetch } from '@/lib/ipFetch';

const router = useRouter();

const loginMethod = ref('form');

const loginForm = ref({
    username: '',
    password: '',
});

const forgotForm = ref({
    key: '',
});

const error = ref(false);
const forgot = ref(false);
// Shown on the login panel after a reset request, in place of a pop-up.
const notice = ref('');

// True while a sign-in request is out, so Enter or a second click cannot send it twice.
const busy = ref(false);

const login = async () => {
    if (busy.value) return;
    busy.value = true;
    try {
        if (loginMethod.value == 'form'){
            const response = await ipFetch('auth/login', 'POST', loginForm.value);
            if (response.ok) {
                router.push('/browse');
            } else {
                error.value = true;
            }
        } else if (loginMethod.value === 'oidc'){
            const {data : oidcResponse} = await ipFetch('auth/oidc/login');
            window.location.href = oidcResponse.url;
        }
    } finally {
        busy.value = false;
    }
};

const showForgot = async () => {
    forgot.value = true;
    ipFetch('auth/generateToken');
};

const hideForgot = async () => {
    forgot.value = false;
};

const submitForgot = async () => {
    ipFetch('auth/resetPassword', 'POST', forgotForm.value);
    notice.value = 'If the code is correct, the password has been reset. The new one is in the logs.';
    error.value = false;
    forgot.value = false;
};

//Check if already logged in, then check for OIDC and redirect
onMounted(async () => {
    const response = await ipFetch('auth/me');
    if (response.ok) {
        router.push('/browse');
    } else {
        const {data : methodResponse} = await ipFetch('auth/method');
        loginMethod.value = methodResponse.message;
    }
});
</script>

<style lang="less" scoped>
.login-content {
    display: flex;
    justify-content: center;

    > div {
        flex: 0 0 325px;
    }
}

.panel {
    margin-top: 50px;
    border-radius: @radius-sm;
}

.panel-header {
    display: flex;
    justify-content: center;
    padding: 10px;
    border-top-left-radius: 4px;
    border-top-right-radius: 4px;
    background-color: @login-panel-header-color;
}

.logo {
    width: 32px;
    height: 32px;
}

.panel-body {
    padding: 20px;
    border-bottom-right-radius: 4px;
    border-bottom-left-radius: 4px;
    background-color: @login-panel-body-color;
}

.sign-in {
    margin: 0;
    padding: 10px 0;
    text-align: center;
    font-size: @font-size-lg;
    font-weight: 400;
}

.form-group {
    margin: 20px 0;

    label {
        display: block;
        margin-bottom: @space-1;
        color: @subtle-text-color;
        font-size: @font-size-base;
    }
}

.form-input {
    box-sizing: border-box;
    padding: 6px @space-4;
    width: 100%;
    height: 35px;
    background-color: @input-background-color;
    border: 1px solid @input-border-color;
    border-radius: @radius-sm;
    box-shadow: inset 0 1px 1px @primary-box-shadow;
    color: @input-text-color;
}

.loginButton {
    margin-top: 20px;
}

.login-notice {
    margin-top: 20px;
    color: @subtle-text-color;
    font-size: @font-size-md;
}

.login-failed {
    margin-top: 20px;
    color: @danger-color;
    font-size: @font-size-md;
}

.forgot-container {
    display: flex;

    // Pull the link's own padding out so its text lines up with the fields above.
    :deep(.appButton) {
        margin-left: -@space-1;
        color: @subtle-text-color;
        font-size: @font-size-base;
    }
}
</style>
