import fs from 'fs'
import path from 'path'
import { readGitHead } from './git'
import { scanCustomNodes, nodeKey } from './nodes'
import { pipFreeze } from './pip'
import type { ScannedNode } from './nodes'
import type { InstallationRecord } from '../installations'

// --- Types ---

export interface Snapshot {
  version: 1
  createdAt: string
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update'
  label: string | null
  comfyui: {
    ref: string
    commit: string | null
    releaseTag: string
    variant: string
  }
  customNodes: ScannedNode[]
  pipPackages: Record<string, string>
}

export interface SnapshotEntry {
  filename: string
  snapshot: Snapshot
}

export interface SnapshotDiff {
  comfyuiChanged: boolean
  comfyui?: {
    from: { ref: string; commit: string | null }
    to: { ref: string; commit: string | null }
  }
  nodesAdded: ScannedNode[]
  nodesRemoved: ScannedNode[]
  nodesChanged: Array<{
    id: string
    type: string
    from: { version?: string; commit?: string; enabled: boolean }
    to: { version?: string; commit?: string; enabled: boolean }
  }>
  pipsAdded: Array<{ name: string; version: string }>
  pipsRemoved: Array<{ name: string; version: string }>
  pipsChanged: Array<{ name: string; from: string; to: string }>
}

// --- Constants ---

const SNAPSHOTS_DIR = path.join('.launcher', 'snapshots')
const MANIFEST_FILE = 'manifest.json'
const AUTO_SNAPSHOT_LIMIT = 50

// --- Per-install mutex ---

const _locks = new Map<string, Promise<void>>()

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  while (_locks.has(key)) {
    try { await _locks.get(key) } catch {}
  }
  let resolve!: () => void
  const lock = new Promise<void>((r) => (resolve = r))
  _locks.set(key, lock)
  try {
    return await fn()
  } finally {
    _locks.delete(key)
    resolve()
  }
}

// --- Helpers ---

function snapshotsDir(installPath: string): string {
  return path.join(installPath, SNAPSHOTS_DIR)
}

/**
 * Validate and resolve a snapshot filename to an absolute path.
 * Returns null if the filename is invalid or escapes the snapshots directory.
 */
function resolveSnapshotPath(installPath: string, filename: string): string | null {
  if (!filename || filename !== path.basename(filename)) return null
  if (!filename.endsWith('.json')) return null
  const dir = path.resolve(snapshotsDir(installPath))
  const resolved = path.resolve(dir, filename)
  if (!resolved.startsWith(dir + path.sep)) return null
  return resolved
}

function readManifest(installPath: string): { comfyui_ref: string; version: string; id: string } {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(installPath, MANIFEST_FILE), 'utf8')) as Record<string, string>
    return {
      comfyui_ref: data.comfyui_ref || 'unknown',
      version: data.version || '',
      id: data.id || '',
    }
  } catch {
    return { comfyui_ref: 'unknown', version: '', id: '' }
  }
}

function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2): string => String(n).padStart(len, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(), 3)}`
}

function getUvPath(installPath: string): string {
  if (process.platform === 'win32') {
    return path.join(installPath, 'standalone-env', 'uv.exe')
  }
  return path.join(installPath, 'standalone-env', 'bin', 'uv')
}

function getActivePythonPath(installation: InstallationRecord): string | null {
  const envName = (installation.activeEnv as string | undefined) || 'default'
  const envDir = path.join(installation.installPath, 'envs', envName)
  const pythonPath = process.platform === 'win32'
    ? path.join(envDir, 'Scripts', 'python.exe')
    : path.join(envDir, 'bin', 'python3')
  return fs.existsSync(pythonPath) ? pythonPath : null
}

// --- Core functions ---

async function captureState(installPath: string, installation: InstallationRecord): Promise<Omit<Snapshot, 'createdAt' | 'trigger' | 'label' | 'version'>> {
  const comfyuiDir = path.join(installPath, 'ComfyUI')
  const manifest = readManifest(installPath)
  const commit = readGitHead(comfyuiDir)
  const customNodes = await scanCustomNodes(comfyuiDir)

  let pipPackages: Record<string, string> = {}
  const uvPath = getUvPath(installPath)
  const pythonPath = getActivePythonPath(installation)
  if (fs.existsSync(uvPath) && pythonPath) {
    try {
      pipPackages = await pipFreeze(uvPath, pythonPath)
    } catch (err) {
      console.warn('Snapshot: pip freeze failed:', (err as Error).message)
    }
  }

  return {
    comfyui: {
      ref: manifest.comfyui_ref,
      commit,
      releaseTag: manifest.version,
      variant: manifest.id,
    },
    customNodes,
    pipPackages,
  }
}

function statesMatch(a: Snapshot, b: Omit<Snapshot, 'createdAt' | 'trigger' | 'label' | 'version'>): boolean {
  // ComfyUI version/commit
  if (a.comfyui.ref !== b.comfyui.ref || a.comfyui.commit !== b.comfyui.commit) return false

  // Custom nodes — compare by nodeKey (type:dirName)
  if (a.customNodes.length !== b.customNodes.length) return false
  const aNodes = new Map(a.customNodes.map((n) => [nodeKey(n), n]))
  for (const bn of b.customNodes) {
    const an = aNodes.get(nodeKey(bn))
    if (!an) return false
    if (an.type !== bn.type || an.version !== bn.version || an.commit !== bn.commit || an.enabled !== bn.enabled) return false
  }

  // Pip packages
  const aKeys = Object.keys(a.pipPackages)
  const bKeys = Object.keys(b.pipPackages)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (a.pipPackages[key] !== b.pipPackages[key]) return false
  }

  return true
}

/**
 * After saving a restart snapshot, check if the immediately previous snapshot
 * was an intermediate restart from the same Manager install sequence (same nodes
 * and ComfyUI version, only pip packages differ). If so, delete it — the new
 * snapshot supersedes it with the fully-installed state.
 */
async function deduplicateRestartSnapshot(installPath: string, justSavedFilename: string): Promise<string | undefined> {
  const entries = await listSnapshots(installPath)

  const savedIdx = entries.findIndex((e) => e.filename === justSavedFilename)
  if (savedIdx < 0 || savedIdx >= entries.length - 1) return undefined

  const saved = entries[savedIdx]!
  const prev = entries[savedIdx + 1]!

  // Only deduplicate against unlabeled restart snapshots
  if (prev.snapshot.trigger !== 'restart' || prev.snapshot.label) return undefined

  // ComfyUI version must match
  if (prev.snapshot.comfyui.ref !== saved.snapshot.comfyui.ref ||
      prev.snapshot.comfyui.commit !== saved.snapshot.comfyui.commit) return undefined

  // Custom nodes must match exactly (same set, same versions)
  if (prev.snapshot.customNodes.length !== saved.snapshot.customNodes.length) return undefined
  const prevNodes = new Map(prev.snapshot.customNodes.map((n) => [nodeKey(n), n]))
  for (const node of saved.snapshot.customNodes) {
    const pn = prevNodes.get(nodeKey(node))
    if (!pn) return undefined
    if (pn.type !== node.type || pn.version !== node.version || pn.commit !== node.commit || pn.enabled !== node.enabled) return undefined
  }

  // Previous snapshot is an intermediate restart — remove it
  await deleteSnapshot(installPath, prev.filename)
  return prev.filename
}

export async function captureSnapshotIfChanged(
  installPath: string,
  installation: InstallationRecord,
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update'
): Promise<{ saved: boolean; filename?: string; deduplicated?: string }> {
  return withLock(installPath, async () => {
    const current = await captureState(installPath, installation)

    // Load last snapshot for comparison
    const lastFilename = installation.lastSnapshot as string | undefined
    if (lastFilename && trigger === 'boot') {
      try {
        const last = await loadSnapshot(installPath, lastFilename)
        if (statesMatch(last, current)) {
          return { saved: false }
        }
      } catch {
        // Last snapshot unreadable — save a new one
      }
    }

    const filename = await writeSnapshot(installPath, { ...current, trigger, label: null })

    // Deduplicate: if this is a restart snapshot, remove the previous intermediate
    // restart that captured state before pip packages were installed.
    let deduplicated: string | undefined
    if (trigger === 'restart') {
      deduplicated = await deduplicateRestartSnapshot(installPath, filename).catch(() => undefined)
    }

    // Prune old auto snapshots
    await pruneAutoSnapshots(installPath, AUTO_SNAPSHOT_LIMIT).catch(() => {})

    return { saved: true, filename, deduplicated }
  })
}

export async function saveSnapshot(
  installPath: string,
  installation: InstallationRecord,
  trigger: 'boot' | 'restart' | 'manual' | 'pre-update',
  label?: string
): Promise<string> {
  return withLock(installPath, async () => {
    const current = await captureState(installPath, installation)
    return writeSnapshot(installPath, { ...current, trigger, label: label || null })
  })
}

async function writeSnapshot(
  installPath: string,
  data: Omit<Snapshot, 'createdAt' | 'version'> & { trigger: Snapshot['trigger']; label: string | null }
): Promise<string> {
  const now = new Date()
  const snapshot: Snapshot = {
    version: 1,
    createdAt: now.toISOString(),
    trigger: data.trigger,
    label: data.label,
    comfyui: data.comfyui,
    customNodes: data.customNodes,
    pipPackages: data.pipPackages,
  }

  const dir = snapshotsDir(installPath)
  await fs.promises.mkdir(dir, { recursive: true })
  const suffix = Math.random().toString(16).slice(2, 8)
  const filename = `${formatTimestamp(now)}-${data.trigger}-${suffix}.json`
  const filePath = path.join(dir, filename)
  const tmpPath = `${filePath}.${suffix}.tmp`
  await fs.promises.writeFile(tmpPath, JSON.stringify(snapshot, null, 2))
  await fs.promises.rename(tmpPath, filePath)
  return filename
}

export async function listSnapshots(installPath: string): Promise<SnapshotEntry[]> {
  const dir = snapshotsDir(installPath)
  try {
    const files = await fs.promises.readdir(dir)
    const entries: SnapshotEntry[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = await fs.promises.readFile(path.join(dir, file), 'utf-8')
        entries.push({ filename: file, snapshot: JSON.parse(content) as Snapshot })
      } catch (err) {
        console.warn(`Snapshot: failed to read ${file}:`, (err as Error).message)
      }
    }
    // Sort newest first
    entries.sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt))
    return entries
  } catch {
    return []
  }
}

export function listSnapshotsSync(installPath: string): SnapshotEntry[] {
  const dir = snapshotsDir(installPath)
  try {
    const files = fs.readdirSync(dir)
    const entries: SnapshotEntry[] = []
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const content = fs.readFileSync(path.join(dir, file), 'utf-8')
        entries.push({ filename: file, snapshot: JSON.parse(content) as Snapshot })
      } catch (err) {
        console.warn(`Snapshot: failed to read ${file}:`, (err as Error).message)
      }
    }
    entries.sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt))
    return entries
  } catch {
    return []
  }
}

export async function loadSnapshot(installPath: string, filename: string): Promise<Snapshot> {
  const filePath = resolveSnapshotPath(installPath, filename)
  if (!filePath) throw new Error(`Invalid snapshot filename: ${filename}`)
  const content = await fs.promises.readFile(filePath, 'utf-8')
  return JSON.parse(content) as Snapshot
}

export async function deleteSnapshot(installPath: string, filename: string): Promise<void> {
  const filePath = resolveSnapshotPath(installPath, filename)
  if (!filePath) throw new Error(`Invalid snapshot filename: ${filename}`)
  await fs.promises.unlink(filePath)
}

/** Recompute snapshot count from disk. */
export async function getSnapshotCount(installPath: string): Promise<number> {
  return (await listSnapshots(installPath)).length
}

export function diffSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  const diff: SnapshotDiff = {
    comfyuiChanged: false,
    nodesAdded: [],
    nodesRemoved: [],
    nodesChanged: [],
    pipsAdded: [],
    pipsRemoved: [],
    pipsChanged: [],
  }

  // ComfyUI version
  if (a.comfyui.ref !== b.comfyui.ref || a.comfyui.commit !== b.comfyui.commit) {
    diff.comfyuiChanged = true
    diff.comfyui = {
      from: { ref: a.comfyui.ref, commit: a.comfyui.commit },
      to: { ref: b.comfyui.ref, commit: b.comfyui.commit },
    }
  }

  // Custom nodes — keyed by (type, dirName)
  const aNodes = new Map(a.customNodes.map((n) => [nodeKey(n), n]))
  const bNodes = new Map(b.customNodes.map((n) => [nodeKey(n), n]))

  for (const [key, bn] of bNodes) {
    const an = aNodes.get(key)
    if (!an) {
      diff.nodesAdded.push(bn)
    } else if (an.version !== bn.version || an.commit !== bn.commit || an.enabled !== bn.enabled || an.type !== bn.type) {
      diff.nodesChanged.push({
        id: bn.id,
        type: bn.type,
        from: { version: an.version, commit: an.commit, enabled: an.enabled },
        to: { version: bn.version, commit: bn.commit, enabled: bn.enabled },
      })
    }
  }
  for (const [key, an] of aNodes) {
    if (!bNodes.has(key)) {
      diff.nodesRemoved.push(an)
    }
  }

  // Pip packages
  for (const [name, ver] of Object.entries(b.pipPackages)) {
    if (!(name in a.pipPackages)) {
      diff.pipsAdded.push({ name, version: ver })
    } else if (a.pipPackages[name] !== ver) {
      diff.pipsChanged.push({ name, from: a.pipPackages[name]!, to: ver })
    }
  }
  for (const name of Object.keys(a.pipPackages)) {
    if (!(name in b.pipPackages)) {
      diff.pipsRemoved.push({ name, version: a.pipPackages[name]! })
    }
  }

  return diff
}

export async function pruneAutoSnapshots(installPath: string, keep: number): Promise<number> {
  const entries = await listSnapshots(installPath)
  const autoSnapshots = entries.filter((e) => (e.snapshot.trigger === 'boot' || e.snapshot.trigger === 'restart') && !e.snapshot.label)
  if (autoSnapshots.length <= keep) return 0

  const toDelete = autoSnapshots.slice(keep)
  let deleted = 0
  for (const entry of toDelete) {
    try {
      await deleteSnapshot(installPath, entry.filename)
      deleted++
    } catch {}
  }
  return deleted
}
