// No 'redirect' mode - BBC iPlayer only serves UK IPs, and only iPlayarr's own container has
// the VPN tunnel (network_mode: container:vpnuk). Redirecting a media server straight to the
// resolved BBC URL would bypass that tunnel entirely and get geo-blocked, so every mode has to
// proxy bytes through iPlayarr itself.
export enum StreamMode {
    DIRECT = 'direct',
    PROGRESSIVE_MKV = 'progressive-mkv',
}
