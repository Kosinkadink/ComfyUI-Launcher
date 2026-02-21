# Migration Feature Parity with ComfyUI-Manager v4

## Current Implementation (Step 3)

Our migration copies custom node directories and installs `requirements.txt`
via `uv pip install`, filtering out PyTorch packages. This covers the basic
case but misses several things Manager does.

## What We're Missing

### 1. `install.py` Execution (High Priority)

Many custom nodes ship an `install.py` that runs arbitrary setup: downloading
models, compiling C/CUDA extensions, creating config files, etc. Manager runs
this **after** `requirements.txt` with `cwd` set to the node directory and two
environment variables:

- `COMFYUI_PATH` — path to the ComfyUI root
- `COMFYUI_FOLDERS_BASE_PATH` — base path for ComfyUI folders

### 2. pip Blacklist / Downgrade Protection (Medium Priority)

Manager maintains:

- **Blacklist** (never install): `torch`, `torchaudio`, `torchsde`,
  `torchvision`
- **Downgrade blacklist** (never downgrade): `transformers`, `safetensors`,
  `kornia`, plus all of the above

We currently only filter `torch`, `torchvision`, `torchaudio` from
requirements. Missing `torchsde`. No downgrade protection.

### 3. `--index-url` Parsing (Low Priority)

Manager parses `--index-url` / `--extra-index-url` directives inline in
`requirements.txt` and forwards them to pip. We currently pass the entire
filtered file to `uv pip install` which may not handle these correctly.

### 4. `pip_fixer.fix_broken()` (Low Priority)

After installing requirements, Manager runs a broken-package repair pass.
We don't do this.

### 5. `pip_overrides.json` (Low Priority)

Manager supports user-configured package name remapping. Not relevant for
migration but worth noting for completeness.

## Delegating to ComfyUI-Manager

If Manager is installed in the **destination** installation, we can delegate
the entire post-copy dependency process to it instead of doing it ourselves.
This gets us full feature parity for free.

### Option A: `cm-cli.py restore-dependencies` (Recommended)

Run after copying node directories, before the user launches ComfyUI:

```
python <ComfyUI>/custom_nodes/ComfyUI-Manager/cm-cli.py restore-dependencies
```

- Iterates every non-disabled directory in `custom_nodes/`
- Calls `execute_install_script` for each (requirements + install.py)
- No running server needed, no knowledge of node IDs required
- Works for all node types (git, CNR, unknown)

### Option B: `cm-cli.py post-install <path>`

For a single node:

```
python <ComfyUI>/custom_nodes/ComfyUI-Manager/cm-cli.py post-install /path/to/node
```

### Option C: Write `#LAZY-INSTALL-SCRIPT` entries

Append entries to `<user_dir>/ComfyUI-Manager/startup-scripts/install-scripts.txt`:

```python
['/path/to/custom_nodes/MyNode', '#LAZY-INSTALL-SCRIPT', '/path/to/python']
```

Manager processes these on next boot, then auto-restarts ComfyUI. This is the
deferred approach — no extra subprocess needed during migration, but deps
aren't installed until next launch.

### Detection

Check if Manager is present:

```javascript
const managerCli = path.join(comfyUIDir, "custom_nodes", "ComfyUI-Manager", "cm-cli.py");
const hasManager = fs.existsSync(managerCli);
```

### Hybrid Strategy

1. Check if Manager exists in the destination installation
2. If yes: use Option A (`restore-dependencies`) or Option C (lazy scripts)
   and skip our own `uv pip install` phase entirely
3. If no: fall back to our current `uv pip install` approach (sans install.py)

Option C (lazy scripts) is attractive because:
- Zero extra time during migration
- Manager handles everything on next boot including restart
- Consistent with how Manager itself queues installs on Windows

Option A is better when:
- User wants deps ready before first launch
- We want to show progress/output during migration

## TODO

- [x] Add `torchsde` to our PyTorch filter regex
- [ ] Add `install.py` execution to our fallback (no-Manager) path
- [ ] Detect Manager in destination and delegate when available
- [ ] Add `--index-url` passthrough for requirements files
