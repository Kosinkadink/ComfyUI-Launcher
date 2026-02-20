# Proposal 4: Tailwind CSS 4 + Lucide Icons + SVGO

| Field | Value |
|---|---|
| **Proposal** | #4 |
| **Title** | Tailwind CSS 4 + Lucide Icons + SVGO |
| **Dependencies** | Proposal #1 (electron-vite), Proposal #3 (Vue 3) |
| **Status** | Draft |

## Summary

Replace the 829-line hand-written CSS (`renderer/styles.css`) with **Tailwind CSS 4** utility classes, replace the manual SVG sprite (6 `<symbol>` elements in `index.html`, lines 10–44) with **Lucide Vue Next** (tree-shakeable, 1400+ icons), and add **vite-svg-loader** (which uses SVGO internally) for build-time optimization of any custom SVGs.

## Motivation

### Current state

1. **Raw CSS with design tokens** — `renderer/styles.css` defines 12 CSS custom properties per theme (`--bg`, `--text`, `--text-muted`, `--text-faint`, `--accent`, `--accent-hover`, `--surface`, `--border`, `--border-hover`, `--danger`, `--terminal-bg`, `--overlay-bg`) under `[data-theme="dark"]` and `[data-theme="light"]` selectors (lines 4–32). These are used consistently throughout ~60 component classes.

2. **Inline SVG sprite** — `index.html` lines 10–44 contain 6 manually-copied Lucide icon `<symbol>` definitions (`icon-settings`, `icon-arrow-left`, `icon-plus`, `icon-box`, `icon-folder-open`, `icon-loader`, `icon-play`). Adding a new icon means finding the SVG source, copying the path data, wrapping it in a `<symbol>`, and adding it to the sprite — error-prone and not tree-shakeable.

3. **Scattered inline styles** — Some renderer JS files set `style.cssText` directly (e.g., `list.js` line 17: `style.cssText = "font-weight: 700; color: var(--text-faint);"`).

### Problems

- **Maintenance cost** — Adding a new color, breakpoint, or utility requires editing raw CSS. No utility-class system means repetitive declarations (`display: flex; align-items: center; gap: 8px;` appears in 15+ places).
- **Icon rigidity** — Only 7 icons available. Adding one icon requires touching `index.html` and copy-pasting SVG path data.
- **No tree-shaking** — All 829 lines of CSS ship regardless of what's used. All 7 icon definitions ship even if only 3 are rendered on a given view.
- **No build-time optimization** — Custom SVGs (if any are added in the future) would ship unoptimized.

## Design

### Tailwind CSS 4 — CSS-first configuration

Tailwind v4's CSS-first configuration via `@theme` is a natural fit for the existing design token system. The current CSS custom properties map directly to Tailwind's `@theme` namespace.

#### Theme token mapping

The existing 12 custom properties (per theme) map to Tailwind's `--color-*` namespace:

| Current CSS Variable | Tailwind `@theme` Variable | Generated Utility | Dark Value | Light Value |
|---|---|---|---|---|
| `--bg` | `--color-bg` | `bg-bg`, `text-bg` | `#171718` | `#ffffff` |
| `--text` | `--color-text` | `text-text`, `bg-text` | `#ffffff` | `#444444` |
| `--text-muted` | `--color-text-muted` | `text-text-muted` | `#9c9eab` | `#828282` |
| `--text-faint` | `--color-text-faint` | `text-text-faint` | `#55565e` | `#b4b4b4` |
| `--accent` | `--color-accent` | `bg-accent`, `text-accent`, `border-accent` | `#0b8ce9` | `#31b9f4` |
| `--accent-hover` | `--color-accent-hover` | `bg-accent-hover` | `#31b9f4` | `#185a8b` |
| `--surface` | `--color-surface` | `bg-surface` | `#262729` | `#e9e9e9` |
| `--border` | `--color-border` | `border-border`, `bg-border` | `#3c3d42` | `#d9d9d9` |
| `--border-hover` | `--color-border-hover` | `border-border-hover` | `#494a50` | `#b4b4b4` |
| `--danger` | `--color-danger` | `bg-danger`, `text-danger`, `border-danger` | `#b33a3a` | `#c02323` |
| `--terminal-bg` | `--color-terminal-bg` | `bg-terminal-bg` | `#111112` | `#f3f3f3` |
| `--overlay-bg` | `--color-overlay-bg` | `bg-overlay-bg` | `rgba(0,0,0,0.55)` | `rgba(0,0,0,0.35)` |

#### Theming strategy

The existing app uses `[data-theme="dark"]` / `[data-theme="light"]` on `<html>`. We preserve this mechanism by defining CSS variables at the `[data-theme]` level and referencing them via Tailwind's `@theme inline`:

```css
@import "tailwindcss";

/* Theme variables stay as CSS custom properties, swapped by data-theme */
[data-theme="dark"] {
  --bg: #171718;
  --text: #ffffff;
  /* ... existing values ... */
}
[data-theme="light"] {
  --bg: #ffffff;
  --text: #444444;
  /* ... existing values ... */
}

/* Tell Tailwind to generate utilities from these variables */
@theme inline {
  --color-bg: var(--bg);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-faint: var(--text-faint);
  --color-accent: var(--accent);
  --color-accent-hover: var(--accent-hover);
  --color-surface: var(--surface);
  --color-border: var(--border);
  --color-border-hover: var(--border-hover);
  --color-danger: var(--danger);
  --color-terminal-bg: var(--terminal-bg);
  --color-overlay-bg: var(--overlay-bg);
}
```

This is the **recommended approach** because:
1. It preserves the existing theming mechanism (`data-theme` attribute set by the main process)
2. No need for `dark:` prefixes everywhere — the CSS variables resolve automatically
3. Components use simple `bg-bg`, `text-text`, `border-border` classes
4. The theme switch code in `renderer/util.js` line 16 (`document.documentElement.setAttribute("data-theme", ...)`) continues to work unchanged

#### Component class mapping

Here's how the major component classes from `renderer/styles.css` translate to Tailwind utilities:

| Current Class | CSS (summary) | Tailwind Equivalent |
|---|---|---|
| `.app-layout` (line 50) | `display:flex; height:100vh` | `flex h-screen` |
| `.sidebar` (line 55) | `w:200px; flex-shrink:0; bg:surface; border-right` | `w-[200px] shrink-0 bg-surface border-r border-border flex flex-col py-4` |
| `.sidebar-brand` (line 64) | `padding; font-size:15px; font-weight:700` | `px-5 pt-3 pb-6 text-[15px] font-bold text-text tracking-tight` |
| `.sidebar-item` (line 78) | `flex; gap:10px; padding:8px 12px; rounded:6px; color:text-muted` | `flex items-center gap-2.5 px-3 py-2 rounded-md bg-transparent border-none text-text-muted text-sm font-medium cursor-pointer text-left w-full` |
| `.sidebar-item:hover` (line 93) | `bg:border; color:text` | `hover:bg-border hover:text-text` |
| `.sidebar-item.active` (line 97) | `bg:border; color:text; font-weight:600` | Dynamic class: `bg-border text-text font-semibold` |
| `.instance-card` (line 296) | `bg:surface; border; rounded:8px; padding:14px 16px; flex between center` | `bg-surface border border-border rounded-lg px-4 py-3.5 flex justify-between items-center` |
| `.terminal-output` (line 585) | `bg:terminal-bg; border; rounded; monospace; overflow` | `bg-terminal-bg border border-border rounded-md px-3 py-2.5 font-mono text-[13px] text-text-muted whitespace-pre-wrap break-all overflow-y-auto max-h-[300px] select-text` |
| `.modal-overlay` (line 676) | `fixed; inset:0; overlay-bg; flex center; z:100` | `fixed inset-0 bg-overlay-bg flex items-center justify-center z-[100]` |
| `.modal-box` (line 685) | `bg:surface; border; rounded:10px; padding:24px; min/max-width` | `bg-surface border border-border rounded-[10px] p-6 min-w-[320px] max-w-[400px]` |
| `.empty-state` (line 334) | `text-align:center; padding:40px 20px; color:text-faint` | `text-center px-5 py-10 text-text-faint text-[15px]` |
| `.toolbar` (line 341) | `flex; between; center; min-h:34px; mb:16px` | `flex justify-between items-center min-h-[34px] mb-4` |
| `button` (line 157) | `padding:7px 16px; border; rounded:6px; bg:surface; text:14px` | `px-4 py-[7px] border border-border rounded-md bg-surface text-text text-sm cursor-pointer` |
| `button.primary` (line 167) | `bg:accent; color:bg; border-color:accent; font-weight:600` | `bg-accent text-bg border-accent font-semibold` |
| `button.danger` (line 176) | `color:danger; border-color:danger` | `text-danger border-danger` |

#### Classes that should remain as custom CSS

Some component classes are too complex or have pseudo-element logic that doesn't benefit from pure utility conversion:

- **`input[type="checkbox"]`** (lines 213–237) — Custom toggle switch with `::after` pseudo-element and transitions. Keep as `@layer components` custom CSS.
- **`button.loading::after`** (lines 180–194) — Spinner pseudo-element with `@keyframes`. Keep as custom CSS.
- **`.progress-bar-fill.indeterminate`** (lines 491–498) — Gradient animation. Keep as custom CSS.
- **`.drag-handle`** (lines 307–324) — Multi-span grip pattern with cursor states. Keep as custom CSS.
- **`::-webkit-scrollbar`** (lines 34–37) — Browser-specific scrollbar styling. Keep as custom CSS.
- **`.filter-tab.active::after`** (lines 283–292) — Underline pseudo-element. Keep as custom CSS.

These are placed in an `@layer components` block within the Tailwind CSS entry file (`renderer/tailwind.css`), preserving their current behavior while allowing Tailwind utilities to override them when needed.

### Lucide Vue Next

Replace the manual SVG sprite with `lucide-vue-next` — a tree-shakeable Vue 3 component library with 1400+ icons.

#### Icon inventory and mapping

| Current `<symbol>` ID | Lucide Component Import | Used In |
|---|---|---|
| `#icon-settings` | `Settings` from `lucide-vue-next` | Sidebar (`index.html` line 67) |
| `#icon-arrow-left` | `ArrowLeft` from `lucide-vue-next` | Back buttons (detail view) |
| `#icon-plus` | `Plus` from `lucide-vue-next` | "New Install" button (`index.html` line 82, `list.js` line 27) |
| `#icon-box` | `Box` from `lucide-vue-next` | Sidebar installations tab (`index.html` line 53) |
| `#icon-folder-open` | `FolderOpen` from `lucide-vue-next` | Sidebar models tab (`index.html` line 63) |
| `#icon-loader` | `Loader` from `lucide-vue-next` | Loading indicators |
| `#icon-play` | `Play` from `lucide-vue-next` | Sidebar running tab (`index.html` line 57) |

#### Usage pattern (post-Vue migration)

```vue
<script setup>
import { Box, Play, FolderOpen, Settings, Plus } from 'lucide-vue-next';
</script>

<template>
  <button class="flex items-center gap-2.5 px-3 py-2 rounded-md ..."
          :class="{ 'bg-border text-text font-semibold': active }">
    <Box :size="18" class="shrink-0" :class="active ? 'opacity-100' : 'opacity-60'" />
    <span>{{ t('sidebar.installations') }}</span>
  </button>
</template>
```

**Benefits:**
- Tree-shaking — only the 7 imported icons are bundled, not all 1400+
- Type-safe props (`size`, `color`, `stroke-width`)
- Consistent stroke width and sizing without manual SVG attributes
- Adding new icons is a one-line import, no HTML editing

### SVGO via vite-svg-loader

`vite-svg-loader` uses SVGO internally to optimize SVGs at build time. It allows importing `.svg` files as Vue components, raw strings, or URLs:

```js
// vite.config.js (after Proposal #1)
import svgLoader from 'vite-svg-loader';

export default defineConfig({
  plugins: [
    vue(),
    svgLoader({
      svgoConfig: {
        multipass: true,
        plugins: [
          {
            name: 'preset-default',
            params: {
              overrides: {
                removeViewBox: false,
              },
            },
          },
        ],
      },
    }),
  ],
});
```

This handles any **custom SVGs** (logos, illustrations) that aren't part of Lucide. For the app icon assets in `assets/`, this ensures they ship optimized.

## New dependencies

| Package | Type | Purpose | Size (unpacked) |
|---|---|---|---|
| `tailwindcss` | devDependency | Utility-class CSS framework | ~17 MB |
| `@tailwindcss/vite` | devDependency | First-party Vite plugin (faster than PostCSS) | ~400 KB |
| `lucide-vue-next` | dependency | Tree-shakeable Vue 3 icon components | ~30 MB (tree-shakes to ~7 icons) |
| `vite-svg-loader` | devDependency | SVG → Vue component + SVGO optimization | ~8 KB |

**Note:** `tailwindcss` and `@tailwindcss/vite` are large on disk but produce zero runtime overhead — they're build tools only. `lucide-vue-next` is large on disk (all 1400+ icons) but tree-shakes aggressively — only imported icons end up in the bundle.

## Migration plan

### Phase 1: Setup (this PR's PoC demonstrates this)

1. Install `tailwindcss`, `@tailwindcss/vite`, `lucide-vue-next`, `vite-svg-loader`
2. Create `renderer/tailwind.css` with `@import "tailwindcss"`, theme token mapping, and `@layer components` for complex classes
3. Add `@tailwindcss/vite` plugin to Vite config (from Proposal #1)
4. Add `vite-svg-loader` to Vite config

### Phase 2: Incremental component conversion (post-Proposal #3)

Once Vue 3 SFCs are in place (Proposal #3), convert components one at a time:

1. Start with leaf components (buttons, badges, tags)
2. Move to layout components (sidebar, toolbar, content area)
3. Convert view components (list, detail, settings, etc.)
4. Convert modal components

For each component:
- Replace `class="instance-card"` with equivalent Tailwind utilities
- Replace `<svg><use href="#icon-..."/></svg>` with `<LucideIcon :size="18" />`
- Remove the corresponding CSS from `styles.css`

### Phase 3: Cleanup

1. Delete `renderer/styles.css` once all classes are migrated
2. Remove the `<svg>` sprite block from `index.html` (lines 10–44)
3. Verify no remaining `var(--*)` references exist outside the theme file

## Tradeoffs

### Advantages

- **Faster iteration** — Styling changes don't require editing CSS files; utilities are applied inline
- **Smaller CSS output** — Tailwind only generates classes that are actually used (vs shipping all 829 lines)
- **Icon scalability** — Access to 1400+ icons with zero effort; adding an icon is a one-line import
- **Consistent design tokens** — Theme values defined once, available everywhere as both utilities and CSS variables
- **Build-time SVG optimization** — SVGO ensures custom SVGs ship at minimal size

### Disadvantages

- **Verbose templates** — Component markup gets longer: `class="flex items-center gap-2.5 px-3 py-2 rounded-md"` vs `class="sidebar-item"`. Mitigated by Vue SFC extraction and Tailwind's `@apply` for frequently-reused patterns.
- **Learning curve** — Contributors need to learn Tailwind's utility naming conventions
- **Dependency weight** — `tailwindcss` is 17 MB on disk (build-only; zero runtime cost). `lucide-vue-next` is 30 MB on disk (tree-shakes to ~50 KB for 7 icons).
- **Tailwind 4 is new** — Released January 2025. Less ecosystem support than v3, though adoption is rapid and it's stable.
- **Two styling systems during migration** — During the incremental conversion period, both `styles.css` and Tailwind utilities will coexist. This is manageable because Tailwind's `@layer` system ensures utility classes always win over component classes.

### Risks

- **Electron compatibility** — Tailwind 4 uses modern CSS features (`@layer`, `@property`, `color-mix()`). Electron 40+ ships Chromium 134+, which supports all of these. **Risk: Low.**
- **Dark mode edge cases** — The `@theme inline` + CSS variable approach means Tailwind utilities resolve to `var(--bg)` etc., which update when `data-theme` changes. This matches the existing behavior. **Risk: Low.**
- **vite-svg-loader last published 2 years ago** — The package works well and has 360K weekly downloads, but is not actively maintained. If it breaks with future Vite versions, `vite-plugin-svgo` (34 stars, maintained, last release May 2025) is a drop-in alternative for raw SVG optimization. **Risk: Medium-low.**

## PoC

The PoC files in this PR demonstrate:

1. **`renderer/tailwind.css`** — Complete Tailwind CSS 4 entry file with theme token mapping and `@layer components` rules for complex CSS that shouldn't be converted to utilities (toggle switches, loading spinners, scrollbar styling).

2. **`renderer/poc/SidebarItem.vue`** — The `.sidebar-item` class (styles.css lines 78–108) fully converted to Tailwind utilities, plus a Lucide icon import replacing `<svg><use href="#icon-..."/></svg>`.

3. **`renderer/poc/SidebarExample.vue`** — Full sidebar composition showing how `SidebarItem` + Lucide icons replace the sidebar HTML (index.html lines 49–71), the SVG sprite (lines 10–44), and the sidebar CSS (styles.css lines 55–133).

These are reference files only — they don't modify the existing application.

## Open questions

1. **`@apply` vs long class strings** — Should frequently-repeated utility combinations (like the card pattern: `bg-surface border border-border rounded-lg`) be extracted to `@apply` classes, or kept inline? Recommendation: keep inline for now; extract only if the exact same combination appears 5+ times.

2. **Tailwind Prettier plugin** — Should we add `prettier-plugin-tailwindcss` to auto-sort class names? Recommendation: yes, add alongside this proposal since it's directly related.

3. **Preflight (CSS reset)** — Tailwind 4 includes Preflight (a modern CSS reset). The existing `* { margin: 0; padding: 0; box-sizing: border-box; }` (line 1) is a subset of what Preflight does. We should verify Preflight doesn't break any existing styling assumptions before enabling it. Recommendation: enable Preflight and remove the manual reset.
