# ComfyUI-Launcher

An Electron app for managing multiple ComfyUI installations.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)

### Setup

```bash
git clone https://github.com/Kosinkadink/ComfyUI-Launcher.git
cd ComfyUI-Launcher
npm install
```

### Run in development

**Windows / macOS:**
```bash
npm start
```

**Linux:**
```bash
./linux-dev.sh
```

### Build for distribution

```bash
# Current platform
npm run dist

# Platform-specific
npm run dist:win      # Windows (NSIS installer)
npm run dist:mac      # macOS (DMG)
npm run dist:linux    # Linux (AppImage, .deb)
```

Build output is written to the `dist/` directory.

## Running

### Windows

Run the NSIS installer (`.exe`) and launch from the Start Menu or desktop shortcut.

### macOS

Open the `.dmg`, drag ComfyUI Launcher to Applications, and launch from there.

### Linux

**`.deb` (Debian/Ubuntu):**
```bash
sudo apt install ./ComfyUI-Launcher-*.deb
```
Then launch from your application menu.

**AppImage:**
```bash
chmod +x ComfyUI-Launcher-*.AppImage
./ComfyUI-Launcher-*.AppImage --no-sandbox
```

## Releasing

Pushing a version tag triggers the **Build & Release** workflow, which builds for Windows, macOS, and Linux, then creates a draft GitHub Release with all artifacts.

```bash
# Tag the current commit with the new version
git tag v0.1.0

# Push the tag to trigger the release workflow
git push origin v0.1.0
```

The workflow sets the app version from the tag automatically. Once the builds finish, go to the [Releases](../../releases) page to review and publish the draft.

## Data Locations

| Purpose | Path |
|---------|------|
| App config & data | `%APPDATA%\comfyui-launcher` (Win) · `~/Library/Application Support/comfyui-launcher` (macOS) · `~/.config/comfyui-launcher` (Linux) |
| Installations list | `<app data>/installations.json` — tracks all managed ComfyUI instances |
| Settings | `<app data>/settings.json` — user preferences (cache dir, max cached downloads, etc.) |
| Download cache | `<app data>/download-cache` — cached `.7z` portable releases (max configurable in Settings, default 5) |
| Default install dir | `Documents\ComfyUI` (Win) · `~/ComfyUI` (macOS/Linux) |