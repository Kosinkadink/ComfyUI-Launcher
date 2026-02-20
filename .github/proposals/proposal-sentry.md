# Proposal #12 — Sentry Error Tracking

| Field | Value |
|-------|-------|
| **Proposal** | #12 |
| **Title** | Sentry Error Tracking |
| **Package** | `@sentry/electron` (v7.8.0) |
| **Dependencies** | None (independent, but benefits from Proposal #1 electron-vite for source maps) |
| **Status** | Draft |

## Problem

ComfyUI Launcher has **zero visibility into production errors**. Unhandled exceptions and promise rejections silently fail with no way for maintainers to know what's happening. Key failure-prone areas include:

- **`lib/download.js`** — network failures, HTTP errors, redirect loops (lines 42–123)
- **`lib/extract.js`** — 7zip spawn failures, unsupported archive formats, permission errors (lines 36–103)
- **`lib/process.js`** — child process spawn failures, port conflicts, process tree management (lines 5–198)
- **`lib/ipc.js`** — installation/launch orchestration with many async error paths (lines 582–889)
- **`main.js`** — window lifecycle edge cases, URL reload on restart failures (lines 99–121)
- **Renderer process** — DOM errors, IPC failures, unhandled promise rejections in `renderer/*.js`

When users report bugs, developers must guess at root causes with no stack traces, no breadcrumbs, and no frequency data.

## Proposed Solution

Add `@sentry/electron` for **error tracking only** (NOT telemetry, NOT usage analytics). The SDK captures:

- Unhandled exceptions in both main and renderer processes
- Unhandled promise rejections
- Native crash reports (Minidumps)
- Breadcrumbs (console, navigation, network) for error context

### What IS Collected (When Enabled)

- Stack traces from unhandled errors
- Electron/OS version, architecture
- Breadcrumbs leading up to an error (console logs, navigation, HTTP requests — URLs only, not bodies)
- App version (for release tracking)

### What is NOT Collected

- ❌ No usage analytics or telemetry
- ❌ No user-identifiable information (no IP addresses, no usernames, no emails)
- ❌ No file paths from user's filesystem (scrubbed via `beforeSend`)
- ❌ No ComfyUI workflow data or model names
- ❌ No screenshots or session replays
- ❌ No performance/tracing data

## Opt-In / Opt-Out Mechanism

Error reporting is **off by default** and controlled via a boolean setting in `settings.json`:

```json
{
  "errorReporting": false
}
```

- A toggle appears in **Settings → General** section (`lib/ipc.js` line 435, alongside existing `autoUpdate` toggle)
- The setting is checked **before** Sentry initializes — if `false`, the SDK is never loaded
- Users can toggle it at runtime; changes take effect on next app restart (since Sentry `init()` must happen early)
- The renderer process checks the same setting via the existing `getSetting` IPC call

### Settings Integration

The `errorReporting` key is added to the existing settings system (`settings.js`). A new field is inserted into the "General" section returned by `get-settings-sections` in `lib/ipc.js` (line 449):

```js
{ id: "errorReporting", label: i18n.t("settings.errorReporting"), type: "boolean", value: !!s.errorReporting },
```

This uses the existing `boolean` field renderer in `renderer/settings.js` (line 76–80) — no UI changes needed.

## Architecture

### Main Process (`lib/sentry.js`)

```
┌──────────────────────────────┐
│  main.js (app entry)         │
│    ↓ (before anything else)  │
│  lib/sentry.js               │
│    → reads settings.json     │
│    → if enabled: Sentry.init │
│    → if disabled: no-op      │
└──────────────────────────────┘
```

Sentry must initialize **as early as possible** in `main.js` (before `app.whenReady()`), so it is required at the top of the file — but the `init()` call only runs if the setting is enabled.

### Renderer Process

Since this app uses plain `<script>` tags (no bundler), the renderer cannot `import` from `@sentry/electron/renderer`. Instead, errors from the renderer are captured by the main process SDK via Electron's IPC-based error forwarding (which `@sentry/electron` handles automatically when `contextIsolation: true`).

If Proposal #1 (electron-vite) is adopted later, a proper renderer-side `Sentry.init()` can be added.

### Privacy — `beforeSend` Scrubbing

A `beforeSend` callback strips filesystem paths from all events to prevent leaking user directory structures:

```js
beforeSend(event) {
  // Strip absolute paths — keep only basename
  // e.g., "/home/user/ComfyUI/venv/bin/python" → ".../python"
  // This prevents leaking user home directory structure
  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (ex.value) {
        ex.value = ex.value.replace(/[A-Z]:\\[^\s"']+/gi, (m) => "..." + m.split("\\").pop());
        ex.value = ex.value.replace(/\/(?:home|Users|tmp|var|opt)[^\s"']+/gi, (m) => "..." + m.split("/").pop());
      }
    }
  }
  return event;
}
```

## Compatibility

| Requirement | Status |
|-------------|--------|
| Electron v40 | ✅ SDK supports `electron >= v23` |
| `contextIsolation: true` | ✅ Already set in `main.js` line 24 |
| `nodeIntegration: false` | ✅ Already set in `main.js` line 23 |
| No bundler (plain CommonJS) | ✅ SDK ships CJS entry points |
| electron-builder packaging | ✅ SDK files included via `node_modules` in asar |

## Source Maps

**Current state:** The app does not generate source maps. Stack traces will reference the original `.js` files since there is no minification — this is actually fine for now since the source is shipped as-is.

**With Proposal #1 (electron-vite):** If the codebase migrates to a bundler, source maps should be uploaded to Sentry during the build step using `@sentry/cli` or `@sentry/webpack-plugin`. A build script addition would look like:

```bash
sentry-cli releases files <version> upload-sourcemaps ./dist --url-prefix "app:///"
```

**Release tracking:** The SDK's `release` option is set to the app version from `package.json`, matching the tags used by `electron-updater`. This lets Sentry correlate errors to specific releases.

## Bundle Size Impact

| Metric | Value |
|--------|-------|
| npm unpacked size | ~1.28 MB |
| Installed size (with deps) | ~3–5 MB (includes `@sentry/node`, `@sentry/browser` transitive deps) |
| Runtime overhead | Negligible when disabled (module loaded but `init()` not called) |
| asar size increase | ~1–2 MB (only JS, no native modules) |

**Tradeoff:** This adds ~1–2 MB to the distributed app. For a desktop app that already bundles Electron (~150+ MB), this is negligible (<1% increase).

**When disabled:** If the user has not opted in, the Sentry module is still `require()`d (to avoid conditional require complexity), but `Sentry.init()` is never called, so no network requests are made and no error interception hooks are installed.

## Migration Steps

### Phase 1: Core Setup (This Proposal)
1. `npm install @sentry/electron`
2. Create `lib/sentry.js` — initialization module with opt-in guard
3. Add `require("./lib/sentry")` as the first line of `main.js`
4. Add `errorReporting` setting to `get-settings-sections` in `lib/ipc.js`
5. Add i18n keys for `settings.errorReporting`
6. Create a Sentry project and replace the placeholder DSN

### Phase 2: Source Maps (After Proposal #1)
1. Add `@sentry/cli` to devDependencies
2. Add source map upload step to `electron-builder` afterPack hook
3. Configure `release` to match `package.json` version

### Phase 3: Enhanced Context (Optional)
1. Add manual `Sentry.captureException()` calls in critical catch blocks (`lib/download.js`, `lib/extract.js`)
2. Add breadcrumbs for installation lifecycle events
3. Add Sentry user feedback widget for error dialogs

## Risks & Tradeoffs

| Risk | Mitigation |
|------|------------|
| Privacy concern — users may distrust crash reporting | Off by default; clear description of what's collected; `beforeSend` scrubbing |
| Bundle size increase (~1–2 MB) | Negligible vs Electron baseline (~150 MB) |
| Network requests from Sentry | Only when errors occur; no heartbeat/polling; no requests when disabled |
| Sentry outage blocks app startup | SDK is fault-tolerant; network failures in Sentry don't affect the app |
| DSN exposed in source | This is expected — DSNs are public-facing; rate limiting configured server-side |

## Files Changed

| File | Change |
|------|--------|
| `lib/sentry.js` | **New** — Sentry initialization module |
| `main.js` | Add `require("./lib/sentry")` at line 1 |
| `lib/ipc.js` | Add `errorReporting` field to settings sections (line ~449) |
| `settings.js` | No changes needed (generic `get`/`set` handles new key) |
| `locales/en.json` | Add `settings.errorReporting` key |
| `locales/zh.json` | Add `settings.errorReporting` key |
| `package.json` | Add `@sentry/electron` dependency |

## References

- [Sentry Electron SDK docs](https://docs.sentry.io/platforms/javascript/guides/electron/)
- [Sentry Electron GitHub](https://github.com/getsentry/sentry-electron)
- [Sentry source maps for Electron](https://docs.sentry.io/platforms/javascript/guides/electron/sourcemaps/)
- [npm: @sentry/electron](https://www.npmjs.com/package/@sentry/electron)
