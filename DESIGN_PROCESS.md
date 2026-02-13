# ComfyUI-Launcher Design Process

## Architecture

The codebase is organized into four layers, each with a clear responsibility:

- **Main process entry** — Window lifecycle only. Delegates all IPC to a separate module.
- **`lib/`** — Shared main-process utilities (IPC registration, HTTP helpers, etc.). Houses logic that multiple modules depend on.
- **`sources/`** — One module per install method, plus a registry. Each source is self-contained: it defines its install form, detail view, actions, and data shape.
- **`renderer/`** — One file per view, plus shared UI utilities (helpers, modals, styles). Views are generic and data-driven — they render whatever sources describe.

Supporting files (data store, preload bridge) sit at the root and remain thin pass-throughs with no business logic.

## Design Principles

### 1. Sources own their data and behavior

Each source module (`sources/<name>.js`) defines:
- `id`, `label` — identity (used by ipc.js to inject `sourceId`/`sourceLabel` automatically; sources should not repeat these in `buildInstallation`)
- `fields` — what the new-install form renders
- `getFieldOptions(fieldId, selections)` — populates each field
- `buildInstallation(selections)` — returns source-specific data to persist
- `getListActions(installation)` — defines which action buttons appear on the list card (same schema as detail actions: `id`, `label`, `style`, `enabled`)
- `getDetailSections(installation)` — defines what the detail view shows (info fields, actions)
- `probeInstallation(dirPath)` *(optional)* — examines a directory and returns source-specific metadata if it recognizes the contents (e.g., portable checks for `python_embeded`, git checks for `.git`). Returns `null` if unrecognized. Used by "Track Existing" to auto-detect source type.
- `getSettingsSections(settings)` *(optional)* — defines settings fields for this source. Fields declare `type` (`path`, `number`), `id` (settings key), and current `value`. The renderer builds the form generically.
- `handleAction(actionId, installation)` — executes source-specific actions
- `getLaunchCommand(installation)` — returns `{ cmd, args, cwd, port }` describing how to start this ComfyUI installation, or `null` if launch is not supported. The launcher uses this to spawn the process, poll the port, then open a browser window.
- `install(installation, tools)` *(optional)* — performs the actual installation (download, extract, etc.). Receives shared tools `{ sendProgress, download, cache, extract }` from ipc.js rather than importing lib modules directly, keeping sources decoupled from infrastructure.

The renderer never contains source-specific knowledge. If it needs to behave differently per source, that behavior must be declared in the source's data (see principle 3).

Fields support multiple types, each handled generically by the renderer:
- `type: "select"` — dropdown, auto-cascades to load the next field on change.
- `type: "text"` — text input with optional `defaultValue`. Does not auto-cascade. Can declare `action: { label }` to render a button that triggers downstream field loading when clicked. Errors from downstream API calls display beneath the text field.

### 2. One concern per file

- `main.js` does not register IPC handlers — `lib/ipc.js` does.
- `lib/ipc.js` handles IPC only. It may reference `BrowserWindow` when an IPC handler requires a parent window (e.g., native dialogs), but does not manage window lifecycle.
- Each renderer view is its own file.
- Shared utilities (`fetch.js`, `util.js`, `modal.js`) are extracted, not duplicated.

### 3. Behavior through data, not conditionals

The renderer should not hardcode `if (actionId === "remove")` or similar checks. Instead, sources declare behavior via metadata:
- Actions declare `confirm: { title, message }` to trigger a confirmation modal.
- Actions declare `style` (`primary`, `danger`, `default`) for visual treatment.
- Actions declare `enabled` to control availability.
- Actions declare `showProgress: true` and `progressTitle` to route through the progress view for long-running operations.

Detail section fields support `editable: true` with an `id` — the renderer shows an input and auto-saves changes to the installation data via `update-installation` IPC.

Any new behavioral hint should follow this pattern: add a property to the action/section schema, handle it generically in the renderer.

### 4. Use in-app modals, not native dialogs, for messages

Never use `alert()` or other native OS dialogs for user-facing messages. Use `modal.alert()` and `modal.confirm()` from `renderer/modal.js` so the experience stays consistent and themed.

### 5. Common logic lives in lib/ or ipc.js

- `sourceId`/`sourceLabel` injection is done by `ipc.js`, not by each source.
- The `remove` action is handled centrally in `ipc.js` since it's a generic CRUD operation.
- HTTP fetching is in `lib/fetch.js`, not in individual sources.

## Reference: Comfy-Org/desktop

This project aims to eventually replace [Comfy-Org/desktop](https://github.com/Comfy-Org/desktop). Refer to that repo for prior art on features, conventions, and assets. Icons/logos in `assets/` are sourced from `desktop/assets/UI/`.

## Known Debt

(None currently tracked.)

## Modularity Review Checklist

When reviewing code for modularity, check:

1. **Is any source-specific logic in the renderer?** Move it to the source module's data/metadata.
2. **Is any file doing two unrelated things?** Split it.
3. **Is the same value defined in two places?** Derive it from a single source of truth.
4. **Is a utility duplicated across modules?** Extract to `lib/`.
5. **Does a renderer view contain hardcoded conditionals for specific action/source IDs?** Replace with a data-driven pattern (add a property to the schema).
6. **Does a source repeat information already available from its own definition?** Have the framework (ipc.js) inject it.
7. **Can a new source be added by only creating a file in `sources/` and registering it in `sources/index.js`?** If not, something is coupled.
