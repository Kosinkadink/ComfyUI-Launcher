# TODO: Hook Up Disk Space Checks

## Status: Not yet wired in

`lib/disk.js` exports `getAvailableSpace`, `hasEnoughSpace`, and `formatBytes` — but nothing imports them yet.

## What needs to happen

Before starting any large file operation, check that the target drive has sufficient free space. The operations that need gating:

### `update-standalone` (sources/standalone.js)
- **Before downloading** the update archive: estimate the download size (from manifest or HTTP `Content-Length`) and verify space.
- **Before extracting and swapping**: the update temporarily requires space for both the old backup and the new extracted files — estimate ~2× the `standalone-env` + `ComfyUI` directory sizes.

### `snapshot-restore` — clean mode (sources/standalone.js)
- **Before creating a fresh environment** from the master: requires roughly the size of `standalone-env/`.
- **Before pip install from snapshot packages**: less predictable, but a conservative minimum (e.g., 500 MB) would catch obviously-full disks.

### `createEnv` / `postInstall` (sources/standalone.js)
- Environment creation copies the master env — check before starting the copy.

## How to implement

```js
const { hasEnoughSpace } = require("../lib/disk");

// Example: before update download
const check = await hasEnoughSpace(installPath, estimatedBytes);
if (!check.ok) {
  throw new Error(`Not enough disk space. Free: ${check.free}, Required: ${check.required}`);
}
```

## Notes

- `hasEnoughSpace` returns `{ ok: true }` if space cannot be determined (graceful fallback) — this is intentional so that failures in space detection don't block operations.
- On Windows, `lib/disk.js` tries PowerShell (`Get-CimInstance`) first, then falls back to `wmic`.
- Size estimates don't need to be exact — the goal is to catch obviously insufficient space before a long operation starts and potentially corrupts the installation.
