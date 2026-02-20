# Proposal #1: electron-vite

## Summary
Replace the current no-bundler setup with electron-vite v5 — a purpose-built Vite integration for Electron providing unified build pipeline for main/preload/renderer, HMR during development, and the foundation for all subsequent migrations.

## Motivation
### Current State
- Main process: CommonJS via require(), no build step
- Renderer: 14 sequential script tags using window.Launcher globals
- Preload: Single CJS file with 30+ IPC channels
- Packaging: electron-builder bundles raw source files

### Problems
1. No HMR — every change requires full app restart
2. No module system in renderer — implicit coupling via window.Launcher
3. No tree-shaking or dead code elimination
4. No path for TypeScript, Vue/React, Tailwind (all require a build step)
5. Inconsistent module formats (CJS main vs global scripts renderer)

## Proposed Solution
### Tools
- electron-vite 5.x — Electron-aware Vite integration
- Vite 7.x — Dev server + bundler (peer dep of electron-vite 5)

### Architecture Changes
- electron.vite.config.mjs — custom entry points for the flat layout
- renderer/main.js — module entry importing all 14 renderer scripts + init code
- index.html — 14 script tags replaced with single script type=module
- main.js — dev/prod conditional loading (loadURL for HMR / loadFile for prod)
- package.json — main field, scripts, build.files updated

### What electron-vite handles automatically
- Bundles main/preload as CJS, renderer as ES modules
- Externalizes electron, Node builtins, and dependencies packages
- Preserves require(), __dirname, __filename via CJS compatibility
- Auto-targets correct Node/Chrome versions for Electron

## Tradeoffs
### Benefits
1. Instant HMR in renderer
2. Hot reloading for main process
3. Foundation for TypeScript, Vue, Tailwind
4. Smaller production bundles via tree-shaking
5. Standard tooling (5.2k GitHub stars)

### Costs
1. ~35MB devDependency footprint
2. Build step adds ~2-5s to CI
3. Learning curve for Vite concepts

### Risks
- 7zip-bin native binary: externalized by default (Low)
- Dynamic require() in main.js: static string path (Medium)
- Renderer script load order: controlled by entry point imports (Low)

## Alternatives Considered
1. Vite directly — too much boilerplate
2. Electron Forge Vite Plugin — experimental, requires migration
3. Webpack — slower, ecosystem behind Vite
4. electron-reload only — doesn't solve core problems
5. Vite 8 beta — start stable, upgrade later

## Dependencies
None. This is Proposal #1; all subsequent proposals depend on it.

## PoC Scope
Config file, renderer entry point, package.json changes, index.html changes, main.js dev/prod loading. Does NOT convert globals to ES modules or add TypeScript.
