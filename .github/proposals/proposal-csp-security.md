# Proposal #15: CSP + Sandbox Hardening

## Summary

Harden the Electron security posture of ComfyUI Launcher by adding a strict Content Security Policy, enabling process sandboxing, configuring Electron fuses, and auditing the IPC surface for injection risks. This is a **security audit and hardening proposal**, not a feature addition.

**Dependencies:** Proposal #1 (electron-vite) — full CSP enforcement (`script-src 'self'`) requires extracting the inline `<script>` block in `index.html` to an external file, which a bundler enables. However, several hardening steps can be applied immediately.

---

## Security Audit — Current State

### ✅ What's Already Done Right

| Control | Status | Location |
|---|---|---|
| `nodeIntegration: false` | ✅ Correct | `main.js:23` (launcher), `main.js:162` (ComfyUI windows) |
| `contextIsolation: true` | ✅ Correct | `main.js:24` (launcher), `main.js:163` (ComfyUI windows) |
| `contextBridge` usage | ✅ Correct | `preload.js:3` — all IPC is exposed via `contextBridge.exposeInMainWorld` |
| No `webview` tags | ✅ Correct | `index.html` uses no `<webview>` elements |
| No `eval()` / `new Function()` | ✅ Correct | No dynamic code execution found in any JS file |
| HTML escaping utility | ✅ Present | `renderer/util.js:3-7` — `esc()` uses `textContent→innerHTML` pattern |

### ❌ Critical Findings

#### 1. No Content Security Policy (Severity: HIGH)

**Location:** `index.html` — no `<meta http-equiv="Content-Security-Policy">` tag, no CSP HTTP header set via `session.webRequest.onHeadersReceived`.

**Impact:** Without CSP, any XSS vulnerability (e.g., via unsanitized data in `innerHTML` assignments) can execute arbitrary JavaScript in the renderer with full access to the `window.api` bridge.

**Evidence of risk:** The codebase uses `innerHTML` extensively in renderer scripts:
- `renderer/modal.js:20,48,82` — Template strings with `esc()` output
- `renderer/list.js:27,54,88` — Card rendering
- `renderer/update-banner.js:52,63,71,82` — Banner HTML
- `renderer/detail.js:32,34` — Section clearing (safe, but pattern exists)
- `renderer/util.js:143,156` — Card building with `metaHtml` parameter
- `renderer/new-install.js:130,159,167,188,190,222,237` — Select option rendering
- `renderer/track.js:37,38,50,51,56,62,78,93` — Tracking UI

While most `innerHTML` usage is properly escaped via `esc()`, the `linkify()` function in `renderer/util.js:9-14` constructs `<a>` tags from URL-matched content. The `data-url` attribute is not escaped for quotes, meaning a crafted URL containing `"` could break out of the attribute.

#### 2. No Process Sandbox (Severity: MEDIUM)

**Location:** `main.js:22-26` (launcher window), `main.js:161-167` (ComfyUI windows) — `sandbox` not set in `webPreferences`.

**Impact:** Since Electron 20+, sandboxing is enabled by default when `nodeIntegration: false`. However, it is not *explicitly* set, so:
- Future changes could accidentally disable it.
- Explicit is better than implicit for security-critical settings.
- The ComfyUI windows at `main.js:154-168` load arbitrary `http://127.0.0.1:{PORT}` content and should absolutely be sandboxed.

#### 3. No Electron Fuses (Severity: MEDIUM)

**Location:** Not configured anywhere — no `@electron/fuses` dependency, no post-packaging fuse flipping.

**Impact:** The packaged Electron binary retains dangerous defaults:
- `RunAsNode` (enabled) — `ELECTRON_RUN_AS_NODE=1` turns the app into a Node.js runtime
- `NodeCliInspect` (enabled) — `--inspect` flag allows attaching a debugger
- `NodeOptions` (enabled) — `NODE_OPTIONS` env var can inject arbitrary flags
- `GrantFileProtocolExtraPrivileges` (enabled) — `file://` gets extra privileges (the app uses `loadFile()`)

#### 4. Unvalidated `shell.openExternal` (Severity: MEDIUM)

**Location:** `lib/ipc.js:241`
```js
ipcMain.handle("open-external", (_event, url) => shell.openExternal(url));
```

**Impact:** The renderer can pass any URL to `shell.openExternal`, including:
- `file:///etc/passwd` — open sensitive files
- `smb://attacker.com/share` — trigger SMB connections (Windows)
- Custom protocol handlers (`calculator://`, `ms-msdt://`) — potential for arbitrary code execution

The renderer calls this from:
- `renderer/modal.js:8` — `a.dataset.url` from modal links
- `renderer/settings.js:177` — `a.url` from settings section actions
- `renderer/update-banner.js` — update URLs (controlled by GitHub API response)

#### 5. Unvalidated `shell.openPath` / `openPath()` (Severity: LOW)

**Location:** `lib/ipc.js:240`
```js
ipcMain.handle("open-path", (_event, targetPath) => openPath(targetPath));
```

**Impact:** The renderer can open any filesystem path. The custom `openPath()` wrapper (lines 40-58) on Linux uses `dbus-send` and `xdg-open` with the path as an argument. Path traversal is possible, though the risk is lower since paths typically come from user-selected directories.

#### 6. Inline `<script>` Block (Severity: LOW — blocks full CSP)

**Location:** `index.html:253-322` — a 69-line inline `<script>` block that initializes the app.

**Impact:** This inline script prevents using `script-src 'self'` in CSP. The options are:
1. Use `'unsafe-inline'` (defeats CSP purpose) — **not recommended**
2. Use a nonce (`'nonce-xxx'`) — works but requires generating/injecting per-load
3. Extract to external file — **recommended** (requires Proposal #1 bundler, or can be done manually)

---

## Proposed Changes (implemented in this PR as PoC)

### 1. Extract Inline Script to `renderer/init.js`

Move `index.html:253-322` to `renderer/init.js` and replace with `<script src="renderer/init.js"></script>`. This unblocks strict CSP.

### 2. Add CSP Meta Tag to `index.html`

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none';">
```

**Why `script-src 'self'` (no `'unsafe-inline'`)?** By extracting the inline script to `renderer/init.js`, we use the strictest script-src policy.

**Why `'unsafe-inline'` for styles?** The codebase uses inline `style` attributes (e.g., `style="display:none"` in `index.html`). The SVG sprite also uses `style="display:none"`.

### 3. Explicit Sandbox on All BrowserWindows

Add `sandbox: true` to both the launcher window and ComfyUI window `webPreferences`. This is already the default since Electron 20 but makes it explicit and prevents accidental regression.

### 4. Validate `shell.openExternal` URLs

Restrict to `http:` and `https:` protocols only. Prevents `file://`, `smb://`, and custom protocol handler abuse.

### 5. Validate `open-path` Targets

Resolve to absolute path to prevent relative path traversal.

---

## Future Work (not in this PR)

### Electron Fuses (build-time)

Add `@electron/fuses` as a devDependency and configure in the build pipeline:

| Fuse | Default | Recommended | Rationale |
|---|---|---|---|
| `RunAsNode` | Enabled | **Disable** | App should not be usable as a generic Node.js runtime |
| `NodeOptions` | Enabled | **Disable** | `NODE_OPTIONS` not needed in production |
| `NodeCliInspect` | Enabled | **Disable** | Debugger attachment not needed in production |
| `CookieEncryption` | Disabled | **Enable** | ComfyUI windows use partitioned sessions; encrypt at rest |
| `OnlyLoadAppFromAsar` | Disabled | **Enable** | Prevent loading tampered app code |
| `EmbeddedAsarIntegrityValidation` | Disabled | **Enable** | Validate asar hasn't been modified |
| `GrantFileProtocolExtraPrivileges` | Enabled | **Disable** | App uses `loadFile()` for `index.html`, but should restrict; test needed |

### CSP for ComfyUI Windows

ComfyUI windows load `http://127.0.0.1:PORT`. Use session-level CSP headers to limit to `127.0.0.1` origins.

### IPC Sender Validation

Verify that IPC messages originate from the expected `webContents` to prevent compromised ComfyUI windows from calling launcher-only IPC handlers.

---

## IPC Surface Audit

Full audit of all 40+ IPC channels in `preload.js`:

| Channel | Direction | Risk | Status |
|---|---|---|---|
| `open-path` | invoke | **Medium** | **Fixed in this PR** — resolves to absolute path |
| `open-external` | invoke | **Medium** | **Fixed in this PR** — validates http/https protocol |
| `run-action` | invoke | Medium | Spawns processes; user-controlled by design |
| `kill-port-process` | invoke | Low | Kills PID on a port |
| `browse-folder` | invoke | None | Uses native dialog |
| All other channels | invoke/on | None–Low | Read-only or user-data scoped |

### Additional Concerns

1. **No sender validation** — `ipcMain.handle` handlers don't verify message origin. Mitigated by ComfyUI windows having no preload script.
2. **`linkify()` in `renderer/util.js:9-14`** — The `data-url` attribute in generated `<a>` tags isn't quote-escaped. A crafted URL containing `"` could break out of the attribute context.

---

## Testing Checklist

- [ ] App launches without console CSP errors
- [ ] All sidebar navigation works (Installations, Running, Models, Settings)
- [ ] New installation wizard loads sources and options
- [ ] Track existing installation works
- [ ] Detail modal opens and inline editing works
- [ ] Console modal shows output
- [ ] Update banner displays correctly
- [ ] `Open in Browser` / `Open Path` buttons work
- [ ] External links in modals open in default browser
- [ ] Theme switching works
- [ ] Language switching works
- [ ] ComfyUI window opens and loads correctly
- [ ] No CSP violation errors in DevTools console

---

## References

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron Fuses Documentation](https://www.electronjs.org/docs/latest/tutorial/fuses)
- [MDN Content-Security-Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy)
- [OWASP Electron Security](https://cheatsheetseries.owasp.org/cheatsheets/Electron_Security_Cheat_Sheet.html)
- [`@electron/fuses` npm](https://www.npmjs.com/package/@electron/fuses)
