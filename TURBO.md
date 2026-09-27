# iPlayarr Turbo

iPlayarr Turbo is a fork of [Nikorag/iplayarr](https://github.com/Nikorag/iplayarr) — the BBC iPlayer indexer/download-client for Sonarr and Radarr — built on top of upstream around **v0.11.6**. Everything upstream does, it still does (see the main [README.md](README.md) for the base feature set, install instructions, and Docker deployment). This document covers only what Turbo changes on top of that baseline.

Unlike some other Turbo forks, this one hasn't diverged with new end-user features yet — it's a ground-up modernization of the build/deploy tooling and dependency stack. New user-facing features go here as they land.

## Changes (at a glance)

- **Real multi-stage Docker build** — separate `deps`/`build`/`prod-deps` stages feeding two final images: a slim `runtime` (production-only `node_modules`, no compiler toolchain, no source) and a `dev` target that keeps the full toolchain for hot-reloading against a bind-mounted `src/`. Previously this was a single stage that only deleted source *after* copying it in, which doesn't actually shrink the image — Docker layers are additive, so the discarded files stayed in the image's history regardless.
- **Pinned, current base images** — `node:24-alpine3.24` (current Node LTS) in place of a floating `node:current-alpine3.20` tag that had silently drifted to Node 24 anyway; `redis:8-alpine3.23`; `get_iplayer` bumped to 3.36.
- **Frontend build tooling migrated from Vue CLI to Vite** — Vue CLI is unmaintained upstream and was the source of every remaining npm audit finding in the frontend (they traced to `@vue/cli-plugin-*` themselves, not sub-dependencies, so no version bump could close them). Vite is a faster dev server and actively maintained.
- **All npm audit findings resolved** — 0 vulnerabilities across both the backend and frontend, up from 32 and 60 respectively, via non-breaking bumps plus one deliberate major-version bump (`node-cron` 3→4, api-compatible with this project's usage).
- **CI consistency** — all three GitHub Actions workflows now run the same Node version as the Dockerfile (previously hardcoded to an EOL Node 23), and the Docker-publish workflow was fixed to actually publish to this fork's own image (`planet22/iplayarr-turbo`) instead of upstream's.
- **Consolidated linting** — the frontend's own duplicate/conflicting ESLint 7 setup was removed in favor of the root's ESLint 9 flat config, which now genuinely lints every `.vue` file (a `--ext .ts` flag had silently limited the lint script to `.ts` files only, so the frontend was never actually being linted before).

---

## Docker build

The Dockerfile is a genuine multi-stage build now, not a single stage that happened to delete some files partway through:

```
base ──▸ deps ──▸ build ─────────────┐
  └───▸ prod-deps ────────────────┐  │
redis (source image) ─────────────┤  │
                                   ▼  ▼
                          runtime-base
                            ├──▸ dev      (full node_modules, hot-reload)
                            └──▸ runtime  (prod-only node_modules — default target)
```

- `deps` installs everything (including devDependencies) once and is reused by both `build` (compiles backend + frontend) and, indirectly, the `dev` target.
- `prod-deps` runs a separate `npm ci --omit=dev` so the shipped image never contains `nodemon`, `ts-node`, `typescript`, or any other build-only tooling.
- `runtime-base` holds everything both final images need to actually run — `ffmpeg`, `get_iplayer`, `yt-dlp`, the bundled `redis-server` binary, and the compiled `dist/`/`frontend/dist` output — but no `node_modules` yet.
- `dev` layers the full `deps` node_modules on top of `runtime-base`; it's only ever produced by explicitly passing `target: dev` (as the personal dev compose file does), never the default.
- `runtime` layers the production-only node_modules on top and is the **last** stage in the file, so it's what gets built whenever nothing specifies a target — the published image and any production compose file included.

`atomicparsley` (still only packaged in Alpine's `edge/testing`, not any stable release) gets its own isolated `apk add --allow-untrusted`, so that flag doesn't weaken signature verification for every other package installed in the same image.

## Frontend: Vite instead of Vue CLI

- `vue.config.mjs` → `vite.config.mjs`: `@vitejs/plugin-vue` for single-file components, `vite-plugin-pwa` replacing `@vue/cli-plugin-pwa` (same generated `service-worker.js` filename, so existing browser registrations update in place instead of ending up with two).
- `process.env.NODE_ENV`/`BASE_URL` → `import.meta.env.PROD`/`DEV`/`BASE_URL` (Vite's convention; only three call sites in the whole app).
- `public/index.html` → `index.html` at the project root — Vite only treats `public/` as static passthrough assets, unlike Vue CLI/webpack's `htmlWebpackPlugin` templating.
- Net result: 423 packages instead of ~1,100+, and the frontend's `npm audit` findings went from 21 (all rooted in `@vue/cli-plugin-*`) to 0.

## Dependency/security posture

Both `package.json`s now carry an explicit `engines.node` (`24.x`), matching the Dockerfile and `.node-version`. `npm audit` is clean (0 vulnerabilities) on both the backend and frontend as of this fork's current `dev` branch — re-run `npm audit` before assuming that still holds after any future dependency bump.
