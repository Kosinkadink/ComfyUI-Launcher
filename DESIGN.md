# UI Design Rules

Consistent styling rules for the Launcher UI. Follow these when building or modifying views and modals.

## Font Sizes

| Element            | Size  | Notes                                  |
| ------------------ | ----- | -------------------------------------- |
| Labels             | 13px  | `color: var(--text-muted)`             |
| Values             | 14px  | `color: var(--text)`                   |
| Section titles     | 12px  | uppercase, `font-weight: 600`          |
| List rows          | 13px  |                                        |
| Badges / tags      | 11px  | `font-weight: 600`, uppercase          |
| Drop zone / hero   | 15px  |                                        |

## Color Tokens

- `var(--bg)` — page and modal backgrounds
- `var(--surface)` — raised cards/elements sitting on top of `--bg`
- `var(--border)` / `var(--border-hover)` — borders
- `var(--text)` / `var(--text-muted)` / `var(--text-faint)` — text hierarchy
- `var(--accent)` — interactive highlights, selected states
- `var(--danger)`, `var(--warning, #fd9903)`, `var(--success, #00cd72)`, `var(--info, #58a6ff)` — semantic colors

## Recessed List Pattern

Scrollable or nested list containers use a **recessed** look that contrasts with the modal body (`--bg`):

```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 6px;
padding: 6px;
```

Use class `recessed-list` (SnapshotTab) or `ls-recessed-list` (LoadSnapshotModal). Items inside use `--bg` backgrounds for the inset effect.

## Modals

- All view-modals use the `view-modal-content` class from `main.css` which sets `max-width: 900px`. Do **not** override with narrower widths.
- Modal body uses `view-modal-body` → `view-scroll` (scrollable) → `view-bottom` (sticky footer).
- Follow the pattern in TrackModal / NewInstallModal:
  - Overlay with `mousedown` + `click` dismiss handling (prevents text-select-then-release closing).
  - `Escape` keydown listener on `document`.
  - `defineExpose({ open })` for parent activation via template ref.

## Collapsible Sections

- Title shows a triangle indicator: `▾` (expanded) / `▸` (collapsed).
- Title element gets `cursor: pointer; user-select: none`.
- Use class `collapsible` on section titles (e.g. `inspector-section-title collapsible`).

## Buttons in Headers

- Group buttons with `display: flex; gap: 8px`.
- Use consistent padding (`6px 16px`), `font-size: 13px`, `border-radius: 6px`.
