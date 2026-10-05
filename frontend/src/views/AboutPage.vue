<template>
    <div class="inner-content about-content">
        <img src="/iplayarr.png" alt="Logo" class="logo" />
        <h3>iPlayarr Turbo</h3>
        <p>Version {{ hiddenSettings.VERSION }}</p>
        <p>2026</p>
        <p>
            iPlayarr Turbo is a companion for Sonarr (and the rest of the *arr stack) to simplify integrating
            get_iplayer for episode search and download.
        </p>
        <h2>Author - iplayarr</h2>
        <p><a href="https://github.com/Nikorag">Nikorag</a></p>
        <h2>Author - iplayarr Turbo</h2>
        <p><a href="https://github.com/Planet22">Planet22</a></p>

        <div class="buttons">
            <div>
                <a href="https://github.com/planet22/iplayarr-turbo" target="_blank">
                    <button class="githubButton clickable">
                        <font-awesome-icon :icon="['fab', 'github']" />
                        GitHub Project
                    </button>
                </a>
            </div>
        </div>
        <h2>Collaborator on iplayarr</h2>
        <p><a href="https://github.com/StormPooper">@StormFoo</a></p>
        <h2 v-if="isAppleDevice">Tools</h2>
        <p v-if="isAppleDevice">
            <a href="shortcuts/Download%20With%20iPlayarr.shortcut" target="_blank"> Add to iPlayarr Turbo iOS Shortcut </a>
        </p>
        <h2>Credit To</h2>
        <p>
            <a href="https://github.com/get-iplayer/get_iplayer"> <b>Phil Lewis</b> for development of get_iplayer </a>
        </p>
        <p>
            <a href="https://github.com/yt-dlp/yt-dlp">The yt-dlp Development Team</a>
        </p>
        <p>The Entire Development team behind Sonarr, Radarr and Prowlarr</p>
    </div>
</template>

<script setup>
import { computed, inject } from 'vue';

const hiddenSettings = inject('hiddenSettings');

const isAppleDevice = computed(() => {
    return /Mac|iPhone|iPod|iPad/.test(navigator.userAgent);
});
</script>

<style lang="less">
.about-content {
    text-align: center;
}

.logo {
    width: 100px;
}

a {
    color: @primary-text-color;
    text-decoration: none;
}

.buttons {
    display: flex;
    justify-content: center;
    gap: 10px;

    div {
        display: inline-block;
    }

    .githubButton {
        padding: 0.5rem 1rem;
        font-size: 0.9rem;
        height: 36px;
        border-radius: 8px;
        border: none;
        color: white;
        background-color: black;
    }
}
</style>
