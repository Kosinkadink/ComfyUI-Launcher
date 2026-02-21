# Proposal #5: vue-i18n + Accessibility

## Summary

Replace the hand-rolled i18n system (113 lines across `lib/i18n.js` and `renderer/i18n.js`) with **vue-i18n v9**, which provides ICU message format, pluralization, datetime/number formatting, lazy-loaded locales, and Vue component integration (`<i18n-t>`, `$t()`). Simultaneously audit and fix accessibility gaps: modal focus trapping, ARIA roles/labels, keyboard navigation, and screen reader support.

This proposal depends on **Proposal #3 (Vue 3)** — vue-i18n v9 is a Vue 3 plugin.

## Motivation

### Current State

**i18n** — Two files totaling 113 lines:

| File | Lines | Role |
|---|---|---|
| `lib/i18n.js` | 81 | Main process: loads JSON locale files, deep-merges fallback locale, exposes `t(key, params)` with `{placeholder}` replacement |
| `renderer/i18n.js` | 32 | Renderer: receives messages object from main via IPC, applies `data-i18n` attributes to DOM elements, exposes `window.t()` |

Locale files (`locales/en.json`, `locales/zh.json`, plus 4 draft translations in `locales/drafts/`):
- **231 translation keys** across 16 namespaces
- **31 keys use `{placeholder}` interpolation** (e.g., `running.exitCode`: `"Exit code {code}"`)
- **28 `data-i18n` attributes** in `index.html` for static text
- **~100 `window.t()` calls** across renderer JS files for dynamic text

**Accessibility** — No accessibility implementation whatsoever:
- Zero ARIA attributes in the entire renderer codebase
- Zero `role` attributes
- Zero `tabindex` attributes
- Zero focus management
- Zero keyboard navigation support beyond native browser behavior

### Problems

#### i18n Limitations

1. **No pluralization** — The `{placeholder}` system can't handle "1 item" vs "5 items". Currently there are no plural strings, but features like model counts or environment lists will need them.

2. **No ICU message format** — Can't express complex rules like gender, selectordinal, or nested plural/select. Vue-i18n's message compiler handles this natively.

3. **No datetime/number formatting** — Dates and numbers are displayed raw. No locale-aware formatting for "Last Checked" timestamps (`portable.lastChecked`) or version numbers.

4. **No lazy loading** — Both `en.json` (300 lines, 231 keys) and the active locale are loaded synchronously at startup via `fs.readFileSync` (`lib/i18n.js:13`). With 4 draft locales planned and more to come, this will grow.

5. **Duplicated logic** — The `t()` function is implemented twice — `lib/i18n.js:44-57` and `renderer/i18n.js:13-27` — with identical dot-path traversal and `{placeholder}` regex replacement. Both must be maintained in sync.

6. **IPC round-trip for messages** — The entire messages object is serialized over IPC from main to renderer (`preload.js:14`: `getLocaleMessages`), then stored in a renderer-side global. This is unnecessary when the renderer can import locale JSON directly.

7. **No type safety** — Message keys are bare strings. Typos like `window.t("setings.title")` silently return the key string as fallback (`lib/i18n.js:51`).

#### Accessibility Violations

**Modals (`renderer/modal.js`, 119 lines):**

| Issue | Severity | WAI-ARIA Requirement |
|---|---|---|
| No `role="dialog"` on modal container | Critical | [Dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) requires `role="dialog"` |
| No `aria-modal="true"` | Critical | Required to indicate content behind modal is inert |
| No `aria-labelledby` pointing to title | Critical | Dialog must have accessible name |
| No `aria-describedby` pointing to message | Major | Dialog should describe its purpose |
| No focus trapping (`Tab`/`Shift+Tab`) | Critical | Tab must cycle within modal, not escape to background |
| No `Escape` key to close | Major | Standard keyboard interaction for dialogs |
| Background content not marked inert | Major | Users can tab to elements behind the overlay |

**View Modals (`index.html:125-237`, `renderer/util.js:257-275`):**

Same issues as above, plus:
- Close button (`✕`) has no `aria-label` — screen reader announces "times" or "multiplication sign"
- No `role="dialog"` on any of the 5 view modal containers (`modal-detail`, `modal-console`, `modal-progress`, `modal-new`, `modal-track`)
- No keyboard close via `Escape`

**Sidebar Navigation (`index.html:49-71`):**

| Issue | Severity |
|---|---|
| No `role="navigation"` or `aria-label` on `<nav>` | Minor — `<nav>` is semantic but unlabelled |
| No `aria-current="page"` on active sidebar item | Major — screen readers can't identify current view |
| Error dot (`.sidebar-error-dot`) has no `aria-label` | Critical — visual-only error indicator |
| Running count badge (`.sidebar-count`) has no `aria-label` | Major — number with no context |

**Custom Toggle Checkbox (`styles.css:213-237`, `renderer/settings.js:77-80`):**

| Issue | Severity |
|---|---|
| `appearance: none` removes native accessibility hints | Major |
| No associated `<label>` element (generated dynamically, label is sibling not linked via `for`/`id`) | Critical — screen reader can't determine what the toggle controls |
| No `role="switch"` or `aria-checked` | Major — not announced as a toggle |

**Forms (`index.html:182-204`, `renderer/new-install.js`):**

| Issue | Severity |
|---|---|
| `<select id="source">` starts disabled with "Loading…" text — no `aria-busy` | Minor |
| Read-only path inputs have no `aria-readonly` | Minor |
| Error messages in prompt modal (`.modal-error`) not linked via `aria-describedby` | Major |
| GPU detection status (`#detected-gpu`) has no `aria-live` region | Minor |

## Proposed Solution

### Tools

| Tool | Version | Purpose |
|---|---|---|
| **vue-i18n** | ^9.14 | Vue 3 i18n plugin — message compilation, pluralization, ICU format, `$t()` / `<i18n-t>` |
| **@intlify/unplugin-vue-i18n** | ^4.0 | Vite plugin — pre-compiles message functions at build time (eliminates runtime compiler, ~30% smaller bundle) |

**Why vue-i18n over alternatives:**

| Library | Why not |
|---|---|
| **i18next + vue-i18next** | Two packages, heavier. vue-i18next is a thin wrapper. vue-i18n is purpose-built for Vue. |
| **@formatjs/intl** | Framework-agnostic — no Vue integration, would need manual reactivity. |
| **fluent / @fluent/web** | Mozilla's format. Small ecosystem, no Vue plugin. |
| **lingui** | React-focused. Vue support is experimental. |
| **Keep hand-rolled** | Works for the current 231 keys, but won't scale to pluralization, datetime formatting, or type-safe keys. The 113 lines would grow to 300+ to add these features. |

### Architecture Changes

**Before:**
```
main.js
  └── lib/i18n.js          (81 lines — loads JSON, deep-merge, t())
        └── IPC: get-locale-messages → sends entire messages object

renderer/
  └── i18n.js              (32 lines — receives messages, data-i18n, window.t())
  └── *.js                 (100 calls to window.t())

locales/
  ├── en.json              (300 lines, 231 keys)
  └── zh.json              (299 lines)
```

**After:**
```
src/
  └── i18n/
      ├── index.ts         (~30 lines — createI18n config, lazy loader)
      └── locales/
          ├── en.json       (unchanged format — vue-i18n uses same {key} syntax)
          └── zh.json

renderer/
  └── components/
      └── *.vue            ($t('key') or <i18n-t keypath="key">)

lib/i18n.js                DELETE (81 lines)
renderer/i18n.js           DELETE (32 lines)
```

**Key changes:**
1. `lib/i18n.js` is deleted — vue-i18n handles message loading in the renderer directly
2. `renderer/i18n.js` is deleted — vue-i18n provides `$t()` globally in all Vue components
3. Main process i18n (tray menu, native dialogs) uses a thin wrapper that imports JSON directly — no change to `t()` API
4. Locale files (`en.json`, `zh.json`) keep the **same format** — vue-i18n's named interpolation uses identical `{placeholder}` syntax
5. `data-i18n` attributes are replaced by `$t()` calls in Vue templates
6. IPC channel `get-locale-messages` is removed

### Migration Path

| Step | Effort | Description |
|---|---|---|
| 1. Install vue-i18n + Vite plugin | 10 min | `npm install vue-i18n @intlify/unplugin-vue-i18n` |
| 2. Create i18n config | 20 min | `src/i18n/index.ts` — `createI18n()` with locale detection, fallback |
| 3. Move locale files | 5 min | `locales/*.json` → `src/i18n/locales/*.json` (or keep in place, configure path) |
| 4. Register plugin in Vue app | 5 min | `app.use(i18n)` in main entry |
| 5. Migrate templates | 2–3 hours | Replace `data-i18n` attributes (28) and `window.t()` calls (~100) with `$t()`. Mechanical find-and-replace since key format is identical. |
| 6. Add lazy loading | 30 min | Dynamic `import()` for non-default locales, `setLocaleMessage()` on switch |
| 7. Thin main-process i18n | 30 min | Keep a minimal `lib/i18n-main.js` (~15 lines) for tray/native dialogs |
| 8. Add pluralization where needed | 1 hour | Identify keys that need plural forms, update locale files |
| 9. Delete old i18n files | 5 min | Remove `lib/i18n.js`, `renderer/i18n.js`, IPC channel |
| 10. Add ARIA to modal component | 1 hour | `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, `Escape` close |
| 11. Add ARIA to view modals | 1 hour | Same treatment for 5 view modal containers |
| 12. Add ARIA to sidebar | 30 min | `aria-label`, `aria-current`, accessible badges |
| 13. Add ARIA to forms/toggles | 30 min | `role="switch"`, label linking, `aria-describedby` for errors |
| **Total** | **~8–10 hours** | |

### Accessibility Fixes (Detail)

#### Modal Focus Trapping

```js
// Trap focus within modal dialog
function trapFocus(container) {
  const focusable = container.querySelectorAll(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  container.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    if (e.key === 'Escape') {
      // Close modal
    }
  });
}
```

#### Dialog ARIA Attributes

Each modal (`alert`, `confirm`, `prompt`) needs:
```html
<div class="modal-overlay">
  <div class="modal-box"
       role="dialog"
       aria-modal="true"
       aria-labelledby="modal-title-{id}"
       aria-describedby="modal-message-{id}">
    <div class="modal-title" id="modal-title-{id}">...</div>
    <div class="modal-message" id="modal-message-{id}">...</div>
    ...
  </div>
</div>
```

#### View Modal ARIA Attributes

Each view modal (`modal-detail`, `modal-console`, etc.) needs:
```html
<div id="modal-detail" class="view-modal"
     role="dialog"
     aria-modal="true"
     aria-labelledby="detail-modal-title">
```

Close buttons need:
```html
<button class="view-modal-close" aria-label="Close dialog">✕</button>
```

#### Sidebar Accessibility

```html
<nav class="sidebar" aria-label="Main navigation">
  <button class="sidebar-item active" data-sidebar="list" aria-current="page">
    ...
    <span class="sidebar-error-dot" aria-label="Has errors" role="status"></span>
    <span class="sidebar-count" aria-label="2 running instances" role="status">2</span>
  </button>
</nav>
```

#### Toggle Switch Accessibility

```html
<input type="checkbox"
       role="switch"
       id="setting-{id}"
       aria-checked="true"
       aria-label="{setting label}">
<label for="setting-{id}">{setting label}</label>
```

## Tradeoffs

### Benefits

- **Pluralization** — `"items": "{count} item | {count} items"` works out of the box
- **ICU message format** — Complex rules for gender, ordinals, nested selects
- **Datetime/number formatting** — `$d(date, 'short')`, `$n(1234.5, 'decimal')` with locale-aware output
- **Compile-time optimization** — `@intlify/unplugin-vue-i18n` pre-compiles message functions, eliminating the runtime message compiler (~30% reduction in vue-i18n bundle)
- **Type-safe keys** (with TypeScript) — Editor autocompletion and build-time errors for typos
- **Lazy loading** — Only load `en.json` at startup, fetch `zh.json` on demand
- **Vue integration** — `$t()` available in all templates, `<i18n-t>` for component interpolation (embed Vue components inside translated strings)
- **Reactive locale switching** — Changing locale re-renders all `$t()` calls automatically
- **Removes 113 lines** of hand-rolled code and 1 IPC channel
- **Accessibility compliance** — Meets WCAG 2.1 AA for modal dialogs, navigation, and form controls

### Costs

| Cost | Impact |
|---|---|
| **Bundle size** | vue-i18n core: ~32 KB min+gzip (with runtime compiler) or ~22 KB (compile-time only via Vite plugin). Current hand-rolled: ~2 KB. Net increase ~20 KB. |
| **Learning curve** | vue-i18n API is well-documented; `$t()` is the same pattern as current `window.t()`. Team needs to learn ICU message syntax for advanced features. |
| **Migration effort** | ~8–10 hours total. Mechanical replacement of `window.t()` → `$t()` for most callsites. |
| **Main process i18n** | vue-i18n runs in the renderer (Vue context). Main process still needs a thin `t()` for tray menus and native dialogs (~10 keys). This is a ~15-line module, not a problem. |

### Risks

| Risk | Mitigation |
|---|---|
| Locale file format incompatibility | vue-i18n uses `{name}` named interpolation — **identical** to our current format. No locale file changes needed for basic migration. |
| vue-i18n v10 incoming | v10 is in development but v9 is stable and maintained. Migration path from v9→v10 is documented. |
| Accessibility regressions | Focus trapping can interfere with Electron DevTools. Gate behind `!isDev` or use a well-tested library (e.g., `focus-trap` at 3 KB). |
| Main process orphaned i18n | Keep a minimal `lib/i18n-main.js` (~15 lines) that reads JSON directly. No deep-merge needed since vue-i18n handles fallback in renderer. |

## Alternatives Considered

| Alternative | Evaluation |
|---|---|
| **i18next + vue-i18next** | Most popular i18n framework overall. But requires two packages, vue-i18next is a thin adapter. vue-i18n is Vue-native with better DX (SFC `<i18n>` blocks, `<i18n-t>` component). i18next's plugin ecosystem (backends, caches) is overkill for an Electron app that reads local JSON. |
| **@formatjs/intl (FormatJS)** | Powers React-Intl. Framework-agnostic core but no Vue bindings — would need manual `computed()` wrappers for reactivity. More boilerplate than vue-i18n. |
| **Extend hand-rolled system** | Could add pluralization (~40 lines), datetime formatting (~30 lines), lazy loading (~20 lines) to the existing system. But this re-invents what vue-i18n provides, lacks the Vite compilation step, and won't have type-safe keys or `<i18n-t>` component interpolation. |
| **For a11y: headless UI library** | Libraries like Headless UI or Radix provide accessible dialog/modal primitives. Worth considering in Proposal #3 (Vue 3) component library selection. For this proposal, we demonstrate the ARIA patterns manually since the modal is 119 lines. |

## Dependencies

- **Proposal #3 (Vue 3)** — vue-i18n v9 is a Vue 3 plugin. Must be installed after Vue 3 migration.
- **Proposal #1 (electron-vite / Vite)** — `@intlify/unplugin-vue-i18n` requires Vite. Without it, vue-i18n still works but uses the runtime message compiler (larger bundle).

## PoC Scope

The PoC in this PR demonstrates:

1. **`poc/i18n/index.js`** — vue-i18n configuration with `createI18n()`, English locale loaded eagerly, lazy loading helper for other locales
2. **`poc/i18n/ExampleComponent.vue`** — A minimal Vue SFC using `$t()` for translations, showing that the existing `en.json` format works unchanged with vue-i18n
3. **`poc/a11y/AccessibleModal.vue`** — An accessible modal component demonstrating:
   - `role="dialog"` and `aria-modal="true"`
   - `aria-labelledby` / `aria-describedby`
   - Focus trapping (Tab/Shift+Tab cycle within modal)
   - `Escape` key to close
   - Focus restoration to trigger element on close
   - Background scroll lock

These files are **standalone demonstrations** — they don't modify any existing application code.
