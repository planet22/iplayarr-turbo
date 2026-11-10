<template>
    <div class="login-content">
        <div>
            <div class="panel">
                <div class="panel-header">
                    <img :src="logoUrl" alt="Image" class="logo" />
                </div>
                <div v-if="!forgot" class="panel-body">
                    <div class="sign-in">SIGN IN TO CONTINUE</div>
                    <template v-if="loginMethod === 'form'">
                        <div class="form-group">
                            <input
                                v-model="loginForm.username"
                                type="email"
                                class="form-input"
                                placeholder="Username"
                                @keyup.enter="login"
                            />
                        </div>
                        <div class="form-group">
                            <input
                                v-model="loginForm.password"
                                type="password"
                                class="form-input"
                                placeholder="Password"
                                @keyup.enter="login"
                            />
                        </div>
                    </template>
                    <div class="forgot-container">
                        <AppButton variant="link" @click="showForgot">{{loginMethod === 'form' ? 'Forgot your password?' : 'Locked Out?'}}</AppButton>
                    </div>
                    <AppButton variant="primary" block class="loginButton" @click="login">Login</AppButton>
                    <div v-if="error" id="login-failed" class="login-failed" role="alert">Incorrect Username or Password</div>
                    <div v-else-if="notice" class="login-notice" role="status">{{ notice }}</div>
                </div>
                <div v-if="forgot" class="panel-body">
                    <div class="sign-in">{{loginMethod === 'form' ? 'FORGOT PASSWORD' : 'LOCKED OUT'}}</div>
                    <p>A unique code has been printed into the logs, enter it below. A new random password is then printed into the logs{{ loginMethod === 'oidc' ? ' and OIDC is disabled' : ''}}</p>
                    <div class="form-group">
                        <input
                            v-model="forgotForm.key"
                            type="text"
                            class="form-input"
                            placeholder="Code from Console"
                            @keyup.enter="submitForgot"
                        />
                    </div>
                    <div class="forgot-container">
                        <AppButton variant="link" @click="hideForgot">Cancel</AppButton>
                    </div>
                    <AppButton variant="primary" block class="loginButton" @click="submitForgot">Reset</AppButton>
                </div>
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

const login = async () => {
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
    padding: 10px 0;
    text-align: center;
}

.form-group {
    margin: 20px 0;
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

    a {
        margin-left: auto;
        color: @subtle-text-color;
        text-decoration: none;
        font-size: @font-size-base;
    }
}
</style>
