import path from 'path'
import fs from 'fs'
import os from 'os'
import { pipFreezeDirect } from './desktopDetect'
import { detectGPU } from './gpu'
import { mergeDirFlat, findComfyUIDir } from './migrate'
import { download } from './download'
import { createCache } from './cache'
import { extractNested as extract } from './extract'
import { defaultInstallDir } from './paths'
import { scanCustomNodes } from './nodes'
import {
  buildExportEnvelope, validateExportEnvelope, importSnapshots,
  saveSnapshot, getSnapshotCount, restoreCustomNodes, restorePipPackages,
} from './snapshots'
import type { Snapshot, SnapshotExportEnvelope } from './snapshots'
import * as installations from '../installations'
import type { InstallationRecord } from '../installations'
import * as settings from '../settings'
import * as i18n from './i18n'
import type { MigrationTools } from './desktopMigration'

const MARKER_FILE = '.comfyui-launcher'

/**
 * Find a Python executable in a portable install.
 * Portable installs have python_embeded/ at the portable root.
 */
function findPortablePython(installPath: string): string | null {
  // Direct python_embeded
  const direct = path.join(installPath, 'python_embeded', 'python.exe')
  if (fs.existsSync(direct)) return direct

  // One level deep (e.g. ComfyUI_windows_portable/python_embeded)
  try {
    const entries = fs.readdirSync(installPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(installPath, entry.name, 'python_embeded', 'python.exe')
        if (fs.existsSync(candidate)) return candidate
      }
    }
  } catch {}
  return null
}

/**
 * Find a Python executable in a git clone install.
 * Git clone installs may have .venv/ or venv/ at the install root.
 */
function findGitPython(installPath: string): string | null {
  const venvNames = ['.venv', 'venv', '.env', 'env']
  for (const venv of venvNames) {
    if (process.platform === 'win32') {
      const candidate = path.join(installPath, venv, 'Scripts', 'python.exe')
      if (fs.existsSync(candidate)) return candidate
    } else {
      const candidate = path.join(installPath, venv, 'bin', 'python3')
      if (fs.existsSync(candidate)) return candidate
      const candidate2 = path.join(installPath, venv, 'bin', 'python')
      if (fs.existsSync(candidate2)) return candidate2
    }
  }
  return null
}

/**
 * Find the Python executable for a given source type.
 */
function findPythonForSource(installPath: string, sourceId: string): string | null {
  if (sourceId === 'portable') return findPortablePython(installPath)
  if (sourceId === 'git') return findGitPython(installPath)
  return null
}

/**
 * Capture a snapshot from a local (portable or git) installation.
 */
export async function captureLocalSnapshot(
  installPath: string,
  sourceId: string,
  skipPipSync: boolean = true,
): Promise<Snapshot> {
  const comfyUIDir = findComfyUIDir(installPath)
  if (!comfyUIDir) {
    throw new Error(i18n.t('migrate.noComfyUIDir'))
  }

  const customNodes = await scanCustomNodes(comfyUIDir)

  let pipPackages: Record<string, string> = {}
  const pythonPath = findPythonForSource(installPath, sourceId)
  if (pythonPath) {
    try {
      pipPackages = await pipFreezeDirect(pythonPath)
    } catch {
      // Python env may not be accessible — nodes will get deps during restore
    }
  }

  const sourceLabel = sourceId === 'portable' ? 'Portable' : 'Git Clone'

  return {
    version: 1,
    createdAt: new Date().toISOString(),
    trigger: 'manual',
    label: `${sourceLabel} migration`,
    comfyui: {
      ref: sourceId,
      commit: null,
      releaseTag: '',
      variant: '',
      displayVersion: sourceLabel,
    },
    customNodes,
    pipPackages,
    skipPipSync,
  }
}

/**
 * Capture a local snapshot and stage it to a temp file.
 */
export async function stageLocalSnapshot(
  installPath: string,
  sourceId: string,
  installationName: string,
  skipPipSync: boolean = true,
): Promise<{ envelope: SnapshotExportEnvelope; stagedFile: string }> {
  const snapshot = await captureLocalSnapshot(installPath, sourceId, skipPipSync)
  const envelope = buildExportEnvelope(`${installationName} Migration`, [
    { filename: `${sourceId}-migration.json`, snapshot },
  ])

  const stagingDir = path.join(os.tmpdir(), 'comfyui-launcher-snapshots')
  await fs.promises.mkdir(stagingDir, { recursive: true })
  const stagedFile = path.join(stagingDir, `${sourceId}-migrate-${Date.now()}.json`)
  await fs.promises.writeFile(stagedFile, JSON.stringify(envelope, null, 2))

  return { envelope, stagedFile }
}

/**
 * Perform a full migration from a portable or git clone install to a new
 * standalone install. Mirrors the desktop migration flow:
 *   1. Capture snapshot from source
 *   2. Create new standalone install (download + extract + setup)
 *   3. Restore snapshot (custom nodes + optionally pip packages)
 *   4. Copy user data, input, output
 *   5. Add models to shared paths
 */
export async function performLocalMigration(
  sourceInstallation: InstallationRecord,
  actionData: Record<string, unknown> | undefined,
  tools: MigrationTools,
): Promise<{ entry: InstallationRecord; destPath: string }> {
  const { sendProgress, sendOutput, signal, sourceMap, uniqueName, ensureDefaultPrimary } = tools

  const sourceId = sourceInstallation.sourceId as string
  const comfyUIDir = findComfyUIDir(sourceInstallation.installPath)
  if (!comfyUIDir) {
    throw new Error(i18n.t('migrate.noComfyUIDir'))
  }

  const sourceLabel = sourceId === 'portable' ? 'Portable' : 'Git Clone'

  sendProgress('steps', { steps: [
    ...(!actionData?.snapshotPath ? [{ phase: 'scan', label: i18n.t('migrate.scanning') }] : []),
    { phase: 'download', label: i18n.t('common.download') },
    { phase: 'extract', label: i18n.t('common.extract') },
    { phase: 'setup', label: i18n.t('standalone.setupEnv') },
    { phase: 'restore-nodes', label: i18n.t('standalone.snapshotRestoreNodesPhase') },
    { phase: 'migrate', label: i18n.t('migrate.migrateDataPhase') },
  ] })

  // 1. Prepare snapshot (use pre-staged file or scan live)
  const skipPipSync = !(actionData?.enablePipSync as boolean | undefined)
  let stagedFile: string
  let ownsStagedFile = false
  if (actionData?.snapshotPath && typeof actionData.snapshotPath === 'string' && fs.existsSync(actionData.snapshotPath)) {
    stagedFile = actionData.snapshotPath
  } else {
    sendProgress('scan', { percent: 0, status: i18n.t('migrate.scanning') })
    sendProgress('scan', { percent: 30, status: i18n.t('migrate.creatingSnapshot') })
    const staged = await stageLocalSnapshot(
      sourceInstallation.installPath,
      sourceId,
      sourceInstallation.name,
      skipPipSync,
    )
    stagedFile = staged.stagedFile
    ownsStagedFile = true
    sendProgress('scan', { percent: 100, status: i18n.t('common.done') })
  }

  const cleanupStagedFile = (): void => {
    if (ownsStagedFile) fs.promises.unlink(stagedFile).catch(() => {})
  }

  // 2. Auto-detect GPU and pick release/variant
  const standaloneSource = sourceMap['standalone']!
  const releaseOptions = await standaloneSource.getFieldOptions('release', {}, {})
  if (releaseOptions.length === 0) {
    cleanupStagedFile()
    throw new Error('No releases available.')
  }
  const latestRelease = releaseOptions[0]!

  const gpu = await detectGPU()
  const variantOptions = await standaloneSource.getFieldOptions('variant', { release: latestRelease }, { gpu: gpu?.id })
  if (variantOptions.length === 0) {
    cleanupStagedFile()
    throw new Error('No compatible variants found for this platform.')
  }
  const matched = variantOptions.find((v) => v.recommended) || variantOptions[0]!

  const instData = {
    sourceId: 'standalone',
    sourceLabel: standaloneSource.label,
    ...standaloneSource.buildInstallation({ release: latestRelease, variant: matched }),
  }

  // 3. Create new standalone installation
  const baseName = `ComfyUI (from ${sourceLabel})`
  const name = await uniqueName(baseName)
  const dirName = name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'ComfyUI'
  const installDir = defaultInstallDir()
  let destPath = path.join(installDir, dirName)
  let suffix = 1
  while (fs.existsSync(destPath)) {
    destPath = path.join(installDir, `${dirName} (${suffix})`)
    suffix++
  }

  const entry = await installations.add({
    name,
    installPath: destPath,
    pendingSnapshotRestore: stagedFile,
    ...instData,
    seen: false,
  })
  ensureDefaultPrimary(entry)

  // 4. Install standalone (download + extract + setup env)
  fs.mkdirSync(destPath, { recursive: true })
  fs.writeFileSync(path.join(destPath, MARKER_FILE), entry.id)
  const cache = createCache(settings.get('cacheDir') as string, settings.get('maxCachedFiles') as number)
  const installRecord = { ...instData, installPath: destPath } as unknown as InstallationRecord
  await standaloneSource.install!(installRecord, { sendProgress, download, cache, extract, signal })

  const update = (data: Record<string, unknown>): Promise<void> =>
    installations.update(entry.id, data).then(() => {})
  await standaloneSource.postInstall!(installRecord, { sendProgress, update })

  // 5. Restore snapshot (custom nodes + optionally pip packages)
  const freshInst = await installations.get(entry.id)
  if (freshInst && fs.existsSync(stagedFile)) {
    try {
      const fileContent = await fs.promises.readFile(stagedFile, 'utf-8')
      const importEnvelope = validateExportEnvelope(JSON.parse(fileContent))
      await importSnapshots(freshInst.installPath, importEnvelope)
      const targetSnapshot = importEnvelope.snapshots[0]!

      sendOutput('\n── Restore Nodes ──\n')
      await restoreCustomNodes(freshInst.installPath, freshInst, targetSnapshot, sendProgress, sendOutput, signal)

      if (!signal.aborted && !targetSnapshot.skipPipSync) {
        sendOutput('\n── Restore Packages ──\n')
        await restorePipPackages(freshInst.installPath, freshInst, targetSnapshot,
          (phase, data) => sendProgress(phase === 'restore' ? 'restore-pip' : phase, data),
          sendOutput, signal)
      }

      try {
        const snapFilename = await saveSnapshot(freshInst.installPath, freshInst, 'post-restore')
        const snapshotCount = await getSnapshotCount(freshInst.installPath)
        await update({ lastSnapshot: snapFilename, snapshotCount })
      } catch {}
    } catch (restoreErr) {
      sendOutput(`\n⚠ Snapshot restore failed: ${(restoreErr as Error).message}\nYou can restore manually from the Snapshots tab.\n`)
    } finally {
      cleanupStagedFile()
      await update({ pendingSnapshotRestore: undefined })
    }
  }

  // 6. Copy user data
  sendProgress('migrate', { percent: 0, status: i18n.t('migrate.mergingUserData') })
  const srcUserDir = path.join(comfyUIDir, 'user')
  const dstComfyUI = path.join(destPath, 'ComfyUI')
  if (fs.existsSync(srcUserDir)) {
    const dstUserDir = path.join(dstComfyUI, 'user')
    await mergeDirFlat(srcUserDir, dstUserDir, (copied, skipped, fileTotal) => {
      const pct = fileTotal > 0 ? Math.round(((copied + skipped) / fileTotal) * 20) : 20
      sendProgress('migrate', { percent: pct, status: i18n.t('migrate.mergingUserData') })
    })
  }

  // 7. Copy input/output to shared directories
  const srcInput = path.join(comfyUIDir, 'input')
  const dstInput = (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
  if (fs.existsSync(srcInput)) {
    sendProgress('migrate', { percent: 30, status: i18n.t('migrate.mergingInput') })
    await mergeDirFlat(srcInput, dstInput)
  }

  const srcOutput = path.join(comfyUIDir, 'output')
  const dstOutput = (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
  if (fs.existsSync(srcOutput)) {
    sendProgress('migrate', { percent: 50, status: i18n.t('migrate.mergingOutput') })
    await mergeDirFlat(srcOutput, dstOutput)
  }

  // 8. Add source models dir to shared paths (no copy)
  sendProgress('migrate', { percent: 80, status: i18n.t('migrate.addingModels') })
  const srcModelsDir = path.resolve(path.join(comfyUIDir, 'models'))
  const currentModelsDirs = (settings.get('modelsDirs') as string[] | undefined) || [...settings.defaults.modelsDirs]
  const normalizedCurrent = currentModelsDirs.map((d) => path.resolve(d))
  if (fs.existsSync(srcModelsDir) && !normalizedCurrent.includes(srcModelsDir)) {
    currentModelsDirs.push(srcModelsDir)
    settings.set('modelsDirs', currentModelsDirs)
  }

  sendProgress('migrate', { percent: 100, status: i18n.t('common.done') })
  await installations.update(entry.id, { status: 'installed' })

  return { entry, destPath }
}
