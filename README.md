# ComfyUI-Launcher

An Electron app for managing multiple ComfyUI installations.

## Data Locations

| Purpose | Path |
|---------|------|
| App config & data | `%APPDATA%\comfyui-launcher` (Win) · `~/Library/Application Support/comfyui-launcher` (macOS) · `~/.config/comfyui-launcher` (Linux) |
| Installations list | `<app data>/installations.json` — tracks all managed ComfyUI instances |
| Settings | `<app data>/settings.json` — user preferences (cache dir, max cached downloads, etc.) |
| Download cache | `<app data>/download-cache` — cached `.7z` portable releases (max configurable in Settings, default 5) |
| Default install dir | `Documents\ComfyUI` (Win) · `~/ComfyUI` (macOS/Linux) |