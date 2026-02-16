# ComfyUI-Manager Restart Handling

ComfyUI-Manager can restart ComfyUI after installing custom node packs. This document describes how the launcher handles that.

## Background

ComfyUI-Manager's restart logic (`rebootAPI()` in `js/common.js`) has three code paths:

1. **`electronAPI` present** — calls `window.electronAPI.restartApp()` and returns immediately. No server-side request. The Electron host is responsible for restarting the process.

2. **`__COMFY_CLI_SESSION__` env var set** — the `/manager/reboot` endpoint creates a marker file at `$__COMFY_CLI_SESSION__.reboot`, then calls `exit(0)`. The launcher detects the marker and respawns.

3. **Neither present (legacy)** — calls `os.execv()` to replace the current process in-place. This creates an orphaned process that the launcher cannot track. **This path must be avoided.**

## How the Launcher Handles It

### Preventing orphans

When spawning ComfyUI, `lib/ipc.js` sets `__COMFY_CLI_SESSION__` in the child process environment, pointing to a unique temp path. This ensures Manager never falls through to the `os.execv()` legacy path.

### electronAPI (app window mode)

`preload-comfy.js` injects `window.electronAPI.restartApp()` into the ComfyUI BrowserWindow via `contextBridge`. When Manager calls it:

1. The `restart-core` IPC handler sets `_restartRequested = true`
2. Kills the current process via `killProcessTree`
3. The exit handler sees the flag and respawns (see below)

### .reboot marker (console mode / fallback)

If Manager goes through the server-side `/manager/reboot` endpoint instead (e.g. in console-only mode where there's no `electronAPI`), it creates the `.reboot` marker file and exits with code 0. The exit handler detects the marker and respawns.

### Exit handler respawn

`attachExitHandler` in `lib/ipc.js` runs on every process exit:

1. Checks `_restartRequested` flag OR `.reboot` marker file
2. If either is present: respawns ComfyUI with the same command/args/env, reattaches stdout/stderr forwarding, updates `_runningProc`, and calls `onComfyRestarted` with the new process handle
3. If neither: declares the process stopped (`comfy-exited`)

In app window mode, `onComfyRestarted` in `main.js` polls `waitForPort` until the new server is ready, then reloads the ComfyUI BrowserWindow URL. The window stays open throughout.

In console mode, the restart message (`"--- ComfyUI restarting ---"`) is written to the terminal via `sendOutput` (the same comfy-output channel as stdout/stderr), so it appears inline in the console view.

### Process cleanup

`stopRunning()` in `lib/ipc.js` handles both cases — if a tracked process exists, it uses `killProcessTree`; it also calls `killByPort` to catch any process listening on the port. Both `_restartRequested` and the running state are cleared so the exit handler does not respawn.

## Reference

- ComfyUI-Manager restart logic: `ltdrdata/ComfyUI-Manager` → `js/common.js` (`rebootAPI`), `glob/manager_server.py` (`/manager/reboot`)
- Comfy-Org/desktop approach: `RESTART_CORE` IPC channel kills and respawns the Python server while keeping the Electron shell alive
