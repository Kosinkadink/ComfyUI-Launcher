# Custom Node Restore & Dependency Installation

Plan for Launcher-native custom node dependency installation and snapshot-based node state restore. Independent from Phase 5 (Wheel Cache).

---

## Context

### Current State

- `scanCustomNodes()` in `lib/nodes.js` identifies installed nodes (CNR/git/file/unknown, version, enabled state)
- `installCustomNodeDeps()` in `lib/nodes.js` installs `requirements.txt` for all active nodes into a target env (implemented, not yet wired into call sites)
- Snapshot restore (`performSoftRestore`) only restores pip packages and **reports** custom node differences — it doesn't act on them
- Manager v4 has its own snapshot restore (`restore_snapshot()` in `manager_core.py`) that handles node state, but has several oversights (see "Why Not Delegate" below)

### Why Not Delegate to Manager

Manager's `restore-snapshot.json` boot-time restore has issues that make it unreliable for Launcher use:

1. **Pip restore is opt-in**: `prestartup_script.py` calls `cm-cli.py restore-snapshot` with no `--pip-*` flags, so pip packages are not restored via the lazy boot path
2. **Postinstalls are collected but never executed**: Newly-installed CNR nodes during restore don't get their `install.py` scripts run
3. **CNR version switches skip deps**: Called with `no_deps=True`, relying on pip restore that may not run (see #1)
4. **No rollback on partial failure**: A failed restore can leave nodes in an inconsistent state
5. **Git checkout without fetch**: Fails silently on shallow clones where the target commit isn't local

### Compatibility with Manager v4

Launcher-native operations are safe because Manager re-scans the filesystem on every boot:

- Moving nodes in/out of `.disabled/` — Manager discovers on next scan
- `git checkout` to a different commit — Manager reads `.git/HEAD`
- pip package changes — Manager reads live package state via `pip freeze`
- `.tracking` files — Only relevant for CNR version switches (deferred to Manager)

---

## Scope

### In Scope (Launcher-native)

| Operation | Mechanism | Complexity |
|---|---|---|
| Install custom node pip deps | `uv pip install -r requirements.txt` per node | Done (`installCustomNodeDeps`) |
| Disable node (move to `.disabled/`) | `fs.rename(nodePath, disabledPath)` | Low |
| Enable node (move from `.disabled/`) | `fs.rename(disabledPath, nodePath)` | Low |
| Git commit checkout | `git checkout {hash}` via `execFile` | Low |
| Git commit checkout with fetch | `git fetch origin && git checkout {hash}` | Low (fallback for shallow clones) |

### Deferred (Delegate to Manager)

| Operation | Reason |
|---|---|
| CNR version switch | Requires `.tracking` file dance + CNR API download — Manager's internal concern |
| CNR node install from scratch | Requires CNR API interaction + zip extraction + `.tracking` creation |
| `install.py` execution | Some nodes have custom install scripts; running arbitrary Python from Node.js is risky |

CNR version restore could be added later either Launcher-native (calling `api.comfy.org` directly) or via Manager's `restore-snapshot.json` mechanism once its bugs are fixed upstream.

---

## Implementation

### Phase A: Wire `installCustomNodeDeps` into Existing Flows

`installCustomNodeDeps()` exists but isn't called anywhere. Wire it in:

1. **After `createEnv()` in `postInstall()`** — First-time install: new env has master packages but no custom node deps. On fresh installs there are no custom nodes yet, so this is a no-op. Matters for future Strategy B forks where `custom_nodes/` is copied.

2. **After env recreation in `update-standalone`** — Strategy A update step 5 recreates the env from the new master. Custom node deps need to be reinstalled afterward. This is the gap identified in the design doc's Strategy A step 8.

3. **After clean restore** — Clean restore creates a new env from master + applies snapshot pip packages. Custom node deps should be installed after to catch anything the snapshot didn't cover (e.g., a node added after the snapshot was taken).

```javascript
// In handleAction("update-standalone"), after createEnv:
sendProgress("setup", { percent: -1, status: t("standalone.installingNodeDeps") });
const depResult = await installCustomNodeDeps(installPath, uvPath, pythonPath, {
  onProgress: (nodeId, i, total) => {
    sendProgress("setup", { percent: Math.round((i / total) * 100), status: `${nodeId} (${i + 1}/${total})` });
  },
});
if (depResult.failed.length > 0) {
  sendOutput(`⚠ ${depResult.failed.length} node(s) failed to install deps:\n`);
  for (const f of depResult.failed) sendOutput(`  • ${f.id}: ${f.error}\n`);
}
```

### Phase B: Node State Restore

Add node state operations to `lib/nodes.js`:

```javascript
/**
 * Disable a custom node by moving it to .disabled/
 */
async function disableNode(installPath, node) {
  const customNodesDir = path.join(installPath, "ComfyUI", "custom_nodes");
  const disabledDir = path.join(customNodesDir, ".disabled");
  await fs.promises.mkdir(disabledDir, { recursive: true });
  const destName = node.version ? `${node.dirName}@${node.version}` : node.dirName;
  await fs.promises.rename(node.path, path.join(disabledDir, destName));
}

/**
 * Enable a custom node by moving it from .disabled/ back to custom_nodes/
 */
async function enableNode(installPath, node) {
  const customNodesDir = path.join(installPath, "ComfyUI", "custom_nodes");
  // Strip @version suffix for the active directory name
  const activeName = node.dirName.replace(/@[^@]+$/, "");
  await fs.promises.rename(node.path, path.join(customNodesDir, activeName));
}

/**
 * Checkout a git-based custom node to a specific commit.
 * Attempts local checkout first, falls back to fetch if commit not found.
 */
async function checkoutNodeCommit(nodePath, targetCommit) {
  try {
    await execGit(nodePath, ["checkout", targetCommit]);
    return { ok: true };
  } catch {
    // Fallback: fetch then checkout (for shallow clones)
    try {
      await execGit(nodePath, ["fetch", "origin"]);
      await execGit(nodePath, ["checkout", targetCommit]);
      return { ok: true, fetched: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}
```

### Phase C: Integrate Node Restore into Snapshot Restore

Extend `performSoftRestore()` (or add a new `performFullRestore()`) to act on node differences:

```javascript
async function restoreNodeState(installPath, snapshotNodes, currentNodes) {
  const diff = diffCustomNodes(snapshotNodes, currentNodes);
  const results = { disabled: [], enabled: [], checkedOut: [], skipped: [], failed: [] };

  // Disable nodes added since snapshot
  for (const node of diff.added) {
    if (node.type === "file") { results.skipped.push(node.id); continue; }
    try {
      await disableNode(installPath, node);
      results.disabled.push(node.id);
    } catch (err) {
      results.failed.push({ id: node.id, action: "disable", error: err.message });
    }
  }

  // Re-enable nodes that were disabled since snapshot
  for (const change of diff.changed) {
    if (change.changes.some(c => c.field === "enabled" && c.to === false && c.from === true)) {
      try {
        await enableNode(installPath, change.current);
        results.enabled.push(change.id);
      } catch (err) {
        results.failed.push({ id: change.id, action: "enable", error: err.message });
      }
    }
  }

  // Checkout git nodes to snapshot commit
  for (const change of diff.changed) {
    const commitChange = change.changes.find(c => c.field === "commit");
    if (commitChange && change.current.type === "git") {
      const result = await checkoutNodeCommit(change.current.path, commitChange.from);
      if (result.ok) {
        results.checkedOut.push(change.id);
      } else {
        results.failed.push({ id: change.id, action: "checkout", error: result.error });
      }
    }
  }

  // CNR version changes — report but don't act (deferred)
  for (const change of diff.changed) {
    const versionChange = change.changes.find(c => c.field === "version");
    if (versionChange && change.current.type === "cnr") {
      results.skipped.push(`${change.id} (CNR ${versionChange.to} → ${versionChange.from})`);
    }
  }

  // Nodes removed since snapshot — can't restore, report
  for (const node of diff.removed) {
    results.skipped.push(`${node.id} (removed, cannot restore)`);
  }

  return results;
}
```

### Phase D: Strategy B (Fork as New Installation)

When forking, `installCustomNodeDeps` is critical since `custom_nodes/` is copied but the new env has no custom node pip packages:

1. Create new installation entry
2. Download + extract new release into new directory
3. Copy `custom_nodes/` and `user/` from old installation
4. Create default env from new master
5. **Run `installCustomNodeDeps`** to install all custom node pip deps into the new env
6. New installation appears in Launcher list

---

## Pip Blacklist Considerations

Manager maintains pip blacklists (torch, torchvision, torchaudio) to prevent custom node `requirements.txt` from overwriting core packages. The Launcher's `installCustomNodeDeps` currently has no such protection.

Options:
1. **Hardcode a blacklist** matching Manager's (`torch`, `torchvision`, `torchaudio`, `torchsde`) — simple, may drift from Manager's list
2. **Read Manager's blacklist** from `config.ini` / `pip_blacklist` — couples to Manager config format
3. **Use `--no-deps` for risky packages** — prevents transitive overwrites but may miss direct requirements
4. **Do nothing** — rely on PIPFixer running on next ComfyUI boot to restore torch if it got overwritten

Recommendation: Option 1 (hardcode) for now. The blacklist is stable and small. A constants list in `lib/nodes.js` is easy to update.

---

## Ordering

These phases can be implemented incrementally:

1. **Phase A** (wire `installCustomNodeDeps`) — Small, immediate value, closes the Strategy A update gap
2. **Phase B** (node state operations) — Enable/disable/checkout primitives
3. **Phase C** (node restore integration) — Full snapshot restore with node state
4. **Phase D** (Strategy B fork) — Depends on A for dep installation, independent of B/C

Phase A is the priority — it fixes a real gap in the current update flow where custom node deps are lost after env recreation.
