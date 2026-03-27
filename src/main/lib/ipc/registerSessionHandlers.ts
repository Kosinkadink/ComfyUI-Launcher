import {
  path, fs, ipcMain,
  installations, settings, i18n,
  sourceMap,
  formatTime,
  deleteDir,
  spawnProcess, waitForPort, waitForUrl, killProcessTree, killByPort,
  findPidsByPort, getProcessInfo, looksLikeComfyUI, setPortArg,
  findAvailablePort, writePortLock, readPortLock, removePortLock,
  COMFY_BOOT_TIMEOUT_MS,
  performDesktopMigration, performLocalMigration,
  syncCustomModelFolders, discoverExtraModelFolders,
  download, createCache, extract,
  captureSnapshotIfChanged, getSnapshotCount,
  findLockingProcesses,
  getComfyArgsSchema, filterUnsupportedArgs,
  MARKER_FILE, REQUIRES_STOPPED, SENSITIVE_ARG_RE,
  _onLaunch, _onStop, _onComfyExited, _onComfyRestarted, _onModelFolderRelaunch,
  _operationAborts, _runningSessions, _pendingPorts,
  _reservePort, _releasePort, _broadcastToRenderer,
  _addSession, _removeSession, _getPublicSessions,
  isEffectivelyEmptyInstallDir, openPath,
  autoAssignPrimary, ensureDefaultPrimary, findDuplicatePath, uniqueName,
  performCopy, copyBrowserPartition,
  createSessionPath, buildLaunchEnv, checkRebootMarker,
  makeSendProgress, makeSendOutput,
  stopRunning,
} from './shared'
import type {
  ChildProcess, InstallationRecord, FieldOption, LaunchCmd,
} from './shared'

export function registerSessionHandlers(): void {
  ipcMain.handle('stop-comfyui', async (_event, installationId?: string) => {
    if (installationId) {
      await stopRunning(installationId)
    } else {
      await stopRunning()
    }
    if (_onStop) _onStop({ installationId })
  })

  ipcMain.handle('get-running-instances', () => _getPublicSessions())

  ipcMain.handle('cancel-launch', () => {
    for (const [_id, abort] of _operationAborts) {
      abort.abort()
    }
    _operationAborts.clear()
  })

  ipcMain.handle('cancel-operation', (_event, installationId: string) => {
    const abort = _operationAborts.get(installationId)
    if (abort) {
      abort.abort()
      _operationAborts.delete(installationId)
    }
  })

  ipcMain.handle('kill-port-process', async (_event, port: number) => {
    removePortLock(port)
    await killByPort(port)
    await new Promise((r) => setTimeout(r, 500))
    const remaining = await findPidsByPort(port)
    return { ok: remaining.length === 0 }
  })

  ipcMain.handle('run-action', async (_event, installationId: string, actionId: string, actionData?: Record<string, unknown>) => {
    const maybeInst = await installations.get(installationId)
    if (!maybeInst) return { ok: false, message: 'Installation not found.' }
    const inst = maybeInst
    if (REQUIRES_STOPPED.has(actionId) && _runningSessions.has(installationId)) {
      return { ok: false, message: i18n.t('errors.stopRequired'), running: true }
    }
    if (REQUIRES_STOPPED.has(actionId) && _operationAborts.has(installationId)) {
      return { ok: false, message: i18n.t('errors.operationInProgress') }
    }
    if (actionId === 'remove') {
      await installations.remove(installationId)
      await autoAssignPrimary(installationId)
      const pinned = (settings.get('pinnedInstallIds') as string[] | undefined) ?? []
      if (pinned.includes(installationId)) {
        settings.set('pinnedInstallIds', pinned.filter((id) => id !== installationId))
      }
      return { ok: true, navigate: 'list' }
    }
    if (actionId === 'set-primary-install') {
      if (inst.sourceId === 'desktop') {
        return { ok: false, message: 'Desktop installations cannot be set as primary.' }
      }
      settings.set('primaryInstallId', installationId)
      return { ok: true }
    }
    if (actionId === 'pin-install') {
      const pinned = (settings.get('pinnedInstallIds') as string[] | undefined) ?? []
      if (!pinned.includes(installationId)) {
        settings.set('pinnedInstallIds', [...pinned, installationId])
      }
      return { ok: true }
    }
    if (actionId === 'unpin-install') {
      const pinned = (settings.get('pinnedInstallIds') as string[] | undefined) ?? []
      settings.set('pinnedInstallIds', pinned.filter((id) => id !== installationId))
      return { ok: true }
    }
    if (actionId === 'delete') {
      if (!fs.existsSync(inst.installPath)) {
        await installations.remove(installationId)
        await autoAssignPrimary(installationId)
        return { ok: true, navigate: 'list' }
      }
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }
      const markerPath = path.join(inst.installPath, MARKER_FILE)
      let markerContent: string | null
      try { markerContent = fs.readFileSync(markerPath, 'utf-8').trim() } catch { markerContent = null }
      if (!markerContent) {
        return { ok: false, message: 'Safety check failed: this directory was not created by ComfyUI Desktop 2.0. Use Untrack to remove it from the list, then delete the files manually.' }
      }
      if (markerContent !== inst.id && markerContent !== 'tracked') {
        return { ok: false, message: 'Safety check failed: the marker file does not match this installation. Use Untrack instead.' }
      }
      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)
      const abort = new AbortController()
      _operationAborts.set(installationId, abort)
      sendProgress('delete', { percent: 0, status: 'Counting files…' })
      try {
        await deleteDir(inst.installPath, (p) => {
          const elapsed = formatTime(p.elapsedSecs)
          const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : '—'
          sendProgress('delete', {
            percent: p.percent,
            status: `Deleting… ${p.deleted} / ${p.total} items  ·  ${elapsed} elapsed  ·  ${eta} remaining`,
          })
        }, { signal: abort.signal })
      } catch (err) {
        _operationAborts.delete(installationId)
        try {
          fs.mkdirSync(inst.installPath, { recursive: true })
          fs.writeFileSync(markerPath, markerContent)
        } catch {}
        await installations.update(installationId, { status: 'partial-delete' })
        const raw = (err as NodeJS.ErrnoException)
        let message = raw.message
        if (raw.code === 'EBUSY' || raw.code === 'EPERM') {
          message = i18n.t('errors.deleteLocked', { path: raw.path ?? '' })
          const lockedPath = raw.path
          if (lockedPath) {
            findLockingProcesses(lockedPath).then((procs) => {
              if (procs.length > 0 && !sender.isDestroyed()) {
                const names = [...new Set(procs.map((p) => p.name))].join(', ')
                const detail = i18n.t('errors.deleteLockedBy', { processes: names, path: lockedPath })
                sender.send('error-detail', { installationId, message: detail })
              }
            }).catch((err) => { console.error('Failed to identify locking processes:', err) })
          }
        }
        return { ok: false, message }
      }
      _operationAborts.delete(installationId)
      await installations.remove(installationId)
      await autoAssignPrimary(installationId)
      return { ok: true, navigate: 'list' }
    }
    if (actionId === 'open-folder') {
      if (inst.installPath) {
        if (fs.existsSync(inst.installPath)) {
          const err = await openPath(inst.installPath)
          if (err) return { ok: false, message: i18n.t('errors.cannotOpenDir', { error: err }) }
        } else {
          return { ok: false, message: i18n.t('errors.dirNotExist', { path: inst.installPath }) }
        }
      }
      return { ok: true }
    }
    if (actionId === 'copy') {
      const name = actionData?.name as string | undefined
      if (!name) return { ok: false, message: 'No name provided.' }
      if (!inst.installPath || !fs.existsSync(inst.installPath)) {
        return { ok: false, message: i18n.t('errors.dirNotExist', { path: inst.installPath || '' }) }
      }
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }

      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)

      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      try {
        await performCopy(inst, name, sendProgress, abort.signal)
        _operationAborts.delete(installationId)
        sendProgress('done', { percent: 100, status: 'Complete' })
        return { ok: true, navigate: 'list' }
      } catch (err) {
        _operationAborts.delete(installationId)
        if (abort.signal.aborted) return { ok: true, navigate: 'detail' }
        return { ok: false, message: (err as Error).message }
      }
    }
    if (actionId === 'copy-update') {
      const name = actionData?.name as string | undefined
      if (!name) return { ok: false, message: 'No name provided.' }
      if (!inst.installPath || !fs.existsSync(inst.installPath)) {
        return { ok: false, message: i18n.t('errors.dirNotExist', { path: inst.installPath || '' }) }
      }
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }

      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)
      const sendOutput = makeSendOutput(sender, installationId)

      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      try {
        sendProgress('steps', { steps: [
          { phase: 'copy', label: i18n.t('actions.copyingFiles') },
          { phase: 'prepare', label: i18n.t('standalone.updatePrepare') },
          { phase: 'run', label: i18n.t('standalone.updateRun') },
          { phase: 'deps', label: i18n.t('standalone.updateDeps') },
        ] })

        const { entry } = await performCopy(inst, name, sendProgress, abort.signal, 'copy-update')

        const targetChannel = actionData?.channel as string | undefined
        if (targetChannel) {
          await installations.update(entry.id, { updateChannel: targetChannel })
        }

        const updateSendProgress = (phase: string, detail: Record<string, unknown>): void => {
          if (phase !== 'steps') sendProgress(phase, detail)
        }
        try {
          const source = sourceMap[inst.sourceId]
          if (!source) throw new Error(i18n.t('errors.unknownSource'))
          const newInst = await installations.get(entry.id)
          const newUpdate = (data: Record<string, unknown>): Promise<void> =>
            installations.update(entry.id, data).then(() => {})
          const updateResult = await source.handleAction('update-comfyui', newInst!, {}, {
            update: newUpdate,
            sendProgress: updateSendProgress,
            sendOutput,
            signal: abort.signal,
          })
          if (updateResult && !updateResult.ok) {
            sendOutput(`\n⚠ Update: ${updateResult.message}\n`)
            sendOutput('The copy was created successfully. You can retry the update from the new installation.\n')
          }
        } catch (updateErr) {
          sendOutput(`\n⚠ Update failed: ${(updateErr as Error).message}\n`)
          sendOutput('The copy was created successfully. You can retry the update from the new installation.\n')
        }

        _operationAborts.delete(installationId)
        return { ok: true, navigate: 'list' }
      } catch (err) {
        _operationAborts.delete(installationId)
        if (abort.signal.aborted) return { ok: true, navigate: 'detail' }
        return { ok: false, message: (err as Error).message }
      }
    }
    if (actionId === 'migrate-to-standalone') {
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }

      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)
      const sendOutput = makeSendOutput(sender, installationId)

      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      let entry: InstallationRecord | null = null
      let destPath = ''
      try {
        const migrationTools = {
          sendProgress,
          sendOutput,
          signal: abort.signal,
          sourceMap,
          uniqueName,
          ensureDefaultPrimary,
        }
        const result = inst.sourceId === 'desktop'
          ? await performDesktopMigration(actionData, migrationTools, { id: inst.id, name: inst.name })
          : await performLocalMigration(inst, actionData, migrationTools)
        entry = result.entry
        destPath = result.destPath

        _operationAborts.delete(installationId)
        sendProgress('done', { percent: 100, status: 'Complete' })
        return { ok: true, navigate: 'list' }
      } catch (err) {
        _operationAborts.delete(installationId)
        if (entry) {
          try { await installations.remove(entry.id) } catch {}
        }
        if (destPath && fs.existsSync(destPath)) {
          try { await fs.promises.rm(destPath, { recursive: true, force: true }) } catch {}
        }
        if (abort.signal.aborted) return { ok: true, navigate: 'detail' }
        return { ok: false, message: (err as Error).message }
      }
    }
    if (actionId === 'release-update') {
      const name = actionData?.name as string | undefined
      const releaseSelection = actionData?.releaseSelection as Record<string, unknown> | undefined
      const variantSelection = actionData?.variantSelection as Record<string, unknown> | undefined
      if (!name || !releaseSelection || !variantSelection) {
        return { ok: false, message: 'Missing required selections.' }
      }
      if (!inst.installPath || !fs.existsSync(inst.installPath)) {
        return { ok: false, message: i18n.t('errors.dirNotExist', { path: inst.installPath || '' }) }
      }
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }

      const source = sourceMap[inst.sourceId]
      if (!source) return { ok: false, message: i18n.t('errors.unknownSource') }
      const installData = source.buildInstallation({
        release: releaseSelection as unknown as FieldOption,
        variant: variantSelection as unknown as FieldOption,
      })

      const parentDir = path.dirname(inst.installPath)
      const dirName = name.replace(/[<>:"/\\|?*]+/g, '_').trim() || 'ComfyUI'
      let destPath = path.join(parentDir, dirName)
      let suffix = 1
      while (fs.existsSync(destPath)) {
        destPath = path.join(parentDir, `${dirName} (${suffix})`)
        suffix++
      }

      const duplicate = await findDuplicatePath(destPath)
      if (duplicate) {
        return { ok: false, message: `That directory is already used by "${duplicate.name}".` }
      }

      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)
      const sendOutput = makeSendOutput(sender, installationId)

      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      sendProgress('steps', { steps: [
        { phase: 'download', label: i18n.t('common.download') },
        { phase: 'extract', label: i18n.t('common.extract') },
        { phase: 'setup', label: i18n.t('standalone.setupEnv') },
        { phase: 'migrate', label: i18n.t('migrate.filePhase') },
        { phase: 'deps', label: i18n.t('migrate.depsPhase') },
      ] })

      let entry: InstallationRecord | null = null
      let installComplete = false
      try {
        fs.mkdirSync(destPath, { recursive: true })
        const installRecord = { ...installData, installPath: destPath } as InstallationRecord
        const cache = createCache(settings.get('cacheDir') as string, settings.get('maxCachedFiles') as number)
        await source.install!(installRecord, { sendProgress, download, cache, extract, signal: abort.signal })

        const finalName = await uniqueName(name)
        entry = await installations.add({
          sourceId: inst.sourceId,
          sourceLabel: source.label,
          ...installData,
          name: finalName,
          installPath: destPath,
          status: 'installed',
          seen: false,
          browserPartition: 'unique',
          copiedFrom: inst.id,
          copiedFromName: inst.name,
          copiedAt: new Date().toISOString(),
          copyReason: 'release-update' as const,
        })
        try { fs.writeFileSync(path.join(destPath, MARKER_FILE), entry.id) } catch {}
        await copyBrowserPartition(inst.id, entry.id, inst.browserPartition as string | undefined)

        const newUpdate = (data: Record<string, unknown>): Promise<void> =>
          installations.update(entry!.id, data).then(() => {})
        await source.postInstall!(installRecord, { sendProgress, update: newUpdate, signal: abort.signal })
        installComplete = true

        const newInst = await installations.get(entry.id)
        const migrateSendProgress = (phase: string, detail: Record<string, unknown>): void => {
          if (phase !== 'steps' && phase !== 'done') sendProgress(phase, detail)
        }
        const migrateData = {
          sourceInstallationId: inst.id,
          customNodes: true,
          allUserData: true,
          models: true,
          input: true,
          output: true,
        }
        let migrateError: string | null = null
        try {
          const migrateResult = await source.handleAction('migrate-from', newInst!, migrateData, {
            update: newUpdate,
            sendProgress: migrateSendProgress,
            sendOutput,
            signal: abort.signal,
          })
          if (migrateResult && !migrateResult.ok) {
            migrateError = migrateResult.message || 'Unknown migration error'
          }
        } catch (migrateErr) {
          migrateError = (migrateErr as Error).message
        }

        _operationAborts.delete(installationId)
        if (migrateError) {
          sendOutput(`\n⚠ ${migrateError}\n`)
          sendProgress('migrate', { percent: -1, status: i18n.t('standalone.releaseUpdateCleaningUp') })
          try { await installations.remove(entry.id) } catch {}
          try {
            await deleteDir(destPath, (p) => {
              const elapsed = formatTime(p.elapsedSecs)
              const eta = p.etaSecs >= 0 ? formatTime(p.etaSecs) : '—'
              sendProgress('migrate', {
                percent: p.percent,
                status: `${i18n.t('standalone.releaseUpdateCleaningUp')}  ${p.deleted} / ${p.total}  ·  ${elapsed} elapsed  ·  ${eta} remaining`,
              })
            })
          } catch {}
          return { ok: false, message: migrateError }
        }
        sendProgress('done', { percent: 100, status: 'Complete' })
        return { ok: true, navigate: 'list' }
      } catch (err) {
        _operationAborts.delete(installationId)
        if (!installComplete) {
          if (entry) try { await installations.remove(entry.id) } catch {}
          try { await fs.promises.rm(destPath, { recursive: true, force: true }) } catch {}
        }
        if (abort.signal.aborted) return { ok: true, navigate: installComplete ? 'list' : 'detail' }
        return { ok: false, message: (err as Error).message }
      }
    }
    if (actionId === 'launch') {
      if (_runningSessions.has(installationId)) {
        return { ok: false, message: i18n.t('errors.alreadyRunning') }
      }
      if (_operationAborts.has(installationId)) {
        return { ok: false, message: 'Another operation is already running for this installation.' }
      }
      const source = sourceMap[inst.sourceId]
      if (!source) return { ok: false, message: i18n.t('errors.unknownSource') }
      if (!source.skipInstall && isEffectivelyEmptyInstallDir(inst.installPath)) {
        return { ok: false, message: i18n.t('errors.installDirEmpty') }
      }
      const launchCmdRaw = source.getLaunchCommand(inst)
      if (!launchCmdRaw) {
        return { ok: false, message: i18n.t('errors.noEnvFound') }
      }
      const launchCmd = launchCmdRaw

      // Filter out unsupported args
      if (launchCmd.cmd && launchCmd.args && launchCmd.cwd) {
        const sIdx = launchCmd.args.indexOf('-s')
        if (sIdx !== -1 && sIdx + 1 < launchCmd.args.length) {
          const mainPyRel = launchCmd.args[sIdx + 1]!
          const mainPyAbs = path.resolve(launchCmd.cwd, mainPyRel)
          try {
            const schema = await getComfyArgsSchema(launchCmd.cmd, mainPyAbs, launchCmd.cwd, installationId, inst.version as string | undefined)
            const prefixArgs = launchCmd.args.slice(0, sIdx + 2)
            const userArgs = launchCmd.args.slice(sIdx + 2)
            const filtered = filterUnsupportedArgs(userArgs, schema)
            launchCmd.args = [...prefixArgs, ...filtered]
          } catch {
            // Schema not available — pass args as-is
          }
        }
      }

      // Inject shared paths
      const useSharedPaths = !launchCmd.skipSharedPaths && (inst.useSharedPaths as boolean | undefined) !== false && !!launchCmd.args
      let preLaunchExtras: string[] = []
      let sharedModelsDirs: string[] | undefined
      if (useSharedPaths) {
        sharedModelsDirs = settings.get('modelsDirs') as string[] | undefined
        const { config } = syncCustomModelFolders(inst.installPath, sharedModelsDirs)
        if (config) {
          launchCmd.args!.push('--extra-model-paths-config', config.yamlPath)
        }
        const installExtras = discoverExtraModelFolders(inst.installPath)
        const baselineSet = new Set([...(config?.extraFolders ?? []), ...installExtras])
        preLaunchExtras = [...baselineSet].sort()
        const inputDir = (settings.get('inputDir') as string | undefined) || settings.defaults.inputDir
        const outputDir = (settings.get('outputDir') as string | undefined) || settings.defaults.outputDir
        fs.mkdirSync(inputDir, { recursive: true })
        fs.mkdirSync(outputDir, { recursive: true })
        launchCmd.args!.push('--input-directory', inputDir)
        launchCmd.args!.push('--output-directory', outputDir)
      }

      const sender = _event.sender
      const sendProgress = makeSendProgress(sender, installationId)

      const abort = new AbortController()
      _operationAborts.set(installationId, abort)

      // Remote connection
      if (launchCmd.remote) {
        sendProgress('launch', { percent: -1, status: i18n.t('launch.connecting', { url: launchCmd.url || '' }) })
        try {
          await waitForUrl(launchCmd.url!, {
            timeoutMs: 15000,
            signal: abort.signal,
            onPoll: ({ elapsedMs }) => {
              const secs = Math.round(elapsedMs / 1000)
              sendProgress('launch', { percent: -1, status: i18n.t('launch.connectingTime', { url: launchCmd.url || '', secs }) })
            },
          })
        } catch (_err) {
          _operationAborts.delete(installationId)
          if (abort.signal.aborted) return { ok: false, cancelled: true }
          return { ok: false, message: i18n.t('errors.cannotConnect', { url: launchCmd.url || '' }) }
        }

        _operationAborts.delete(installationId)
        const mode = (inst.launchMode as string | undefined) || 'window'
        _addSession(installationId, { proc: null, port: launchCmd.port!, url: launchCmd.url, mode, installationName: inst.name })
        if (_onLaunch) {
          _onLaunch({ port: launchCmd.port!, url: launchCmd.url, process: null, installation: inst, mode })
        }
        return { ok: true, mode, port: launchCmd.port, url: launchCmd.url }
      }

      // Local process launch
      if (!fs.existsSync(launchCmd.cmd!)) {
        _operationAborts.delete(installationId)
        return { ok: false, message: `Executable not found: ${launchCmd.cmd}` }
      }

      // Skip port logic entirely
      if (launchCmd.skipPortWait) {
        _broadcastToRenderer('instance-launching', { installationId, installationName: inst.name })
        const sendOutput = makeSendOutput(sender, installationId)
        const launchEnv = buildLaunchEnv(inst)
        const proc = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, { showWindow: launchCmd.showWindow })
        let stderrBuf = ''
        proc.stdout?.on('data', (chunk: Buffer) => sendOutput(chunk.toString('utf-8')))
        proc.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stderrBuf += text
          if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-4096)
          sendOutput(text)
        })

        _operationAborts.delete(installationId)
        const mode = (inst.launchMode as string | undefined) || 'window'
        _addSession(installationId, { proc, port: 0, mode, installationName: inst.name })

        proc.on('exit', (code) => {
          const crashed = _runningSessions.has(installationId) && code !== 0
          _removeSession(installationId)
          if (!sender.isDestroyed()) {
            sender.send('comfy-exited', { installationId, crashed, exitCode: code, installationName: inst.name })
          }
          if (_onComfyExited) _onComfyExited({ installationId })
        })

        if (_onLaunch) {
          _onLaunch({ port: 0, process: proc, installation: inst, mode })
        }
        return { ok: true, mode }
      }

      if (actionData && actionData.portOverride) {
        setPortArg(launchCmd as LaunchCmd, actionData.portOverride as number)
      }

      // Check for port conflicts
      const pendingPortOwner = _pendingPorts.get(launchCmd.port!)
      const existingPids = pendingPortOwner ? [] : await findPidsByPort(launchCmd.port!)
      const portOccupied = !!pendingPortOwner || existingPids.length > 0

      if (portOccupied) {
        const defaults = source.getDefaults ? source.getDefaults() : {}
        const portConflictMode = (inst.portConflict as string | undefined) || (defaults.portConflict as string | undefined) || 'auto'
        const userArgs = ((inst.launchArgs as string | undefined) || '').trim()
        const portIsExplicit = /(?:^|\s)--port\b/.test(userArgs)

        const reservedPorts = new Set(_pendingPorts.keys())
        let nextPort: number | null = null
        try {
          nextPort = await findAvailablePort('127.0.0.1', launchCmd.port! + 1, launchCmd.port! + 1000, reservedPorts)
        } catch {}

        if (portConflictMode === 'auto' && nextPort && !portIsExplicit) {
          sendProgress('launch', { percent: -1, status: i18n.t('launch.portBusyUsing', { old: launchCmd.port!, new: nextPort }) })
          setPortArg(launchCmd as LaunchCmd, nextPort)
        } else {
          let message: string
          let isComfy: boolean
          if (pendingPortOwner) {
            message = i18n.t('errors.portConflictLauncher', { port: launchCmd.port!, name: pendingPortOwner })
            isComfy = true
          } else {
            const lock = readPortLock(launchCmd.port!)
            if (lock) {
              message = i18n.t('errors.portConflictLauncher', { port: launchCmd.port!, name: lock.installationName })
              isComfy = true
            } else {
              const info = await getProcessInfo(existingPids[0]!)
              isComfy = looksLikeComfyUI(info)
              const processDesc = info ? info.name : `PID ${existingPids[0]}`
              message = isComfy
                ? i18n.t('errors.portConflictComfy', { port: launchCmd.port!, process: processDesc })
                : i18n.t('errors.portConflictOther', { port: launchCmd.port!, process: processDesc })
            }
          }
          _operationAborts.delete(installationId)
          return { ok: false, message, portConflict: { port: launchCmd.port, pids: existingPids, isComfy, nextPort } }
        }
      }

      // Synchronous re-check: TOCTOU gap
      const lateConflictOwner = _pendingPorts.get(launchCmd.port!)
      if (lateConflictOwner) {
        const defaults = source.getDefaults ? source.getDefaults() : {}
        const portConflictMode = (inst.portConflict as string | undefined) || (defaults.portConflict as string | undefined) || 'auto'
        const userArgs = ((inst.launchArgs as string | undefined) || '').trim()
        const portIsExplicit = /(?:^|\s)--port\b/.test(userArgs)

        const reservedPorts = new Set(_pendingPorts.keys())
        let nextPort: number | null = null
        try {
          nextPort = await findAvailablePort('127.0.0.1', launchCmd.port! + 1, launchCmd.port! + 1000, reservedPorts)
        } catch {}

        if (portConflictMode === 'auto' && nextPort && !portIsExplicit) {
          sendProgress('launch', { percent: -1, status: i18n.t('launch.portBusyUsing', { old: launchCmd.port!, new: nextPort }) })
          setPortArg(launchCmd as LaunchCmd, nextPort)
        } else {
          _operationAborts.delete(installationId)
          return {
            ok: false,
            message: i18n.t('errors.portConflictLauncher', { port: launchCmd.port!, name: lateConflictOwner }),
            portConflict: { port: launchCmd.port, pids: [], isComfy: true, nextPort },
          }
        }
      }

      // Reserve port eagerly
      _reservePort(launchCmd.port!, inst.name)
      _broadcastToRenderer('instance-launching', { installationId, installationName: inst.name })

      const sessionPath = createSessionPath()
      const launchEnv = buildLaunchEnv(inst, sessionPath)
      const sendOutput = (text: string): void => {
        if (!sender.isDestroyed()) {
          sender.send('comfy-output', { installationId, text })
        }
      }

      function spawnComfy(): { proc: ChildProcess; getStderr: () => string } {
        const p = spawnProcess(launchCmd.cmd!, launchCmd.args!, launchCmd.cwd!, launchEnv, { showWindow: launchCmd.showWindow })
        let stderrBuf = ''
        p.stdout!.on('data', (chunk: Buffer) => sendOutput(chunk.toString('utf-8')))
        p.stderr!.on('data', (chunk: Buffer) => {
          const text = chunk.toString('utf-8')
          stderrBuf += text
          if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-4096)
          sendOutput(text)
        })
        return { proc: p, getStderr: () => stderrBuf }
      }

      const PORT_RETRY_MAX = 3
      const REBOOT_RETRY_MAX = 5
      let portRetries = 0
      let rebootRetries = 0

      const tryLaunch = async (): Promise<{ ok: true; proc: ChildProcess; getStderr: () => string } | { ok: false; message: string; cancelled?: boolean }> => {
        const cmdLine = [launchCmd.cmd!, ...launchCmd.args!].map((a, ci, ca) => {
          if (ci > 0 && SENSITIVE_ARG_RE.test(ca[ci - 1]!)) return '"***"'
          return /\s/.test(a) ? `"${a}"` : a
        }).join(' ')
        sendProgress('launch', { percent: -1, status: i18n.t('launch.starting') })
        if (!sender.isDestroyed()) {
          sender.send('comfy-output', { installationId, text: `> ${cmdLine}\n\n` })
        }
        const spawned = spawnComfy()

        let earlyExit: string | null = null
        const earlyExitPromise = new Promise<void>((_resolve, reject) => {
          spawned.proc.on('error', (err: Error) => {
            const code = (err as NodeJS.ErrnoException).code ? ` (${(err as NodeJS.ErrnoException).code})` : ''
            earlyExit = err.message
            reject(new Error(`Failed to start${code}: ${launchCmd.cmd}`))
          })
          spawned.proc.on('exit', (code) => {
            if (!earlyExit) {
              const detail = spawned.getStderr().trim() ? `\n\n${spawned.getStderr().trim()}` : ''
              earlyExit = `Process exited with code ${code}${detail}`
              reject(new Error(earlyExit))
            }
          })
        })

        sendProgress('launch', { percent: -1, status: i18n.t('launch.waiting') })
        try {
          await Promise.race([
            waitForPort(launchCmd.port!, '127.0.0.1', {
              timeoutMs: COMFY_BOOT_TIMEOUT_MS,
              signal: abort.signal,
              onPoll: ({ elapsedMs }) => {
                const secs = Math.round(elapsedMs / 1000)
                sendProgress('launch', { percent: -1, status: i18n.t('launch.waitingTime', { secs }) })
              },
            }),
            earlyExitPromise,
          ])
          return { ok: true, proc: spawned.proc, getStderr: spawned.getStderr }
        } catch (err) {
          killProcessTree(spawned.proc)
          if (checkRebootMarker(sessionPath) && rebootRetries < REBOOT_RETRY_MAX) {
            rebootRetries++
            sendOutput('\n--- Manager requested restart during startup, respawning… ---\n\n')
            return tryLaunch()
          }
          const stderr = spawned.getStderr().toLowerCase()
          const isPortConflict = stderr.includes('address already in use') || (stderr.includes('port') && stderr.includes('in use'))
          if (isPortConflict && portRetries < PORT_RETRY_MAX) {
            portRetries++
            try {
              const reservedPorts = new Set(_pendingPorts.keys())
              const retryPort = await findAvailablePort('127.0.0.1', launchCmd.port! + 1, launchCmd.port! + 1000, reservedPorts)
              sendOutput(`\nPort ${launchCmd.port} in use, retrying on port ${retryPort}…\n`)
              _releasePort(launchCmd.port!)
              setPortArg(launchCmd as LaunchCmd, retryPort)
              _reservePort(launchCmd.port!, inst.name)
              return tryLaunch()
            } catch {}
          }
          if (abort.signal.aborted) return { ok: false, message: (err as Error).message, cancelled: true }
          return { ok: false, message: (err as Error).message }
        }
      }

      const launchResult = await tryLaunch()
      if (!launchResult.ok) {
        _releasePort(launchCmd.port!)
        _operationAborts.delete(installationId)
        _broadcastToRenderer('instance-launch-failed', { installationId })
        if (launchResult.cancelled) return { ok: false, cancelled: true }
        return { ok: false, message: launchResult.message }
      }
      let { proc } = launchResult

      _pendingPorts.delete(launchCmd.port!)
      _operationAborts.delete(installationId)
      const mode = (inst.launchMode as string | undefined) || 'window'
      _addSession(installationId, { proc, port: launchCmd.port!, mode, installationName: inst.name })
      writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })

      // Capture snapshot in background after successful launch
      if (inst.sourceId === 'standalone') {
        captureSnapshotIfChanged(inst.installPath, inst, 'boot')
          .then(async ({ saved, filename }) => {
            if (saved) {
              const snapshotCount = await getSnapshotCount(inst.installPath)
              installations.update(installationId, { lastSnapshot: filename, snapshotCount })
            }
          })
          .catch((err) => console.warn('Snapshot capture failed:', err))
      }

      // Check if custom nodes created new model folders during startup
      let site1Relaunched = false
      if (useSharedPaths) {
        const { newFolders } = syncCustomModelFolders(inst.installPath, sharedModelsDirs, preLaunchExtras)
        if (newFolders.length > 0) {
          sendOutput(`\n--- Restarting: new model folders detected (${newFolders.join(', ')}) ---\n\n`)
          if (_onModelFolderRelaunch) {
            await Promise.resolve(_onModelFolderRelaunch({ installationId })).catch(() => {})
          }
          await killProcessTree(proc)
          const respawned = spawnComfy()
          proc = respawned.proc
          const session = _runningSessions.get(installationId)
          if (session) session.proc = proc
          writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })
          await waitForPort(launchCmd.port!, '127.0.0.1', {
            timeoutMs: COMFY_BOOT_TIMEOUT_MS,
            signal: abort.signal,
            onPoll: ({ elapsedMs }) => {
              const secs = Math.round(elapsedMs / 1000)
              sendProgress('launch', { percent: -1, status: i18n.t('launch.waitingTime', { secs }) })
            },
          })
          site1Relaunched = true
        }
      }

      const knownExtras = new Set(
        site1Relaunched ? discoverExtraModelFolders(inst.installPath) : preLaunchExtras,
      )
      let pendingModelFolderRelaunch = false
      let rebootModelCheckAbort: AbortController | null = null

      function attachExitHandler(p: ChildProcess): void {
        p.on('exit', (code) => {
          if (rebootModelCheckAbort) {
            rebootModelCheckAbort.abort()
            rebootModelCheckAbort = null
          }

          if (pendingModelFolderRelaunch || checkRebootMarker(sessionPath)) {
            const isModelRelaunch = pendingModelFolderRelaunch
            pendingModelFolderRelaunch = false
            if (!isModelRelaunch) {
              sendOutput('\n--- ComfyUI restarting ---\n\n')
            }
            if (useSharedPaths) {
              const { config } = syncCustomModelFolders(inst.installPath, sharedModelsDirs)
              if (config) {
                for (const f of config.extraFolders) knownExtras.add(f)
              }
              if (!isModelRelaunch) {
                knownExtras.clear()
                const freshExtras = discoverExtraModelFolders(inst.installPath)
                for (const f of freshExtras) knownExtras.add(f)
                if (config) {
                  for (const f of config.extraFolders) knownExtras.add(f)
                }
              }
            }
            const spawned = spawnComfy()
            proc = spawned.proc
            const session = _runningSessions.get(installationId)
            if (session) session.proc = proc
            writePortLock(launchCmd.port!, { pid: proc.pid!, installationName: inst.name })
            attachExitHandler(proc)
            if (_onComfyRestarted) _onComfyRestarted({ installationId, process: proc })
            if (useSharedPaths) {
              rebootModelCheckAbort = new AbortController()
              const checkSignal = rebootModelCheckAbort.signal
              waitForPort(launchCmd.port!, '127.0.0.1', { timeoutMs: COMFY_BOOT_TIMEOUT_MS, signal: checkSignal })
                .then(async () => {
                  if (checkSignal.aborted) return
                  const currentSession = _runningSessions.get(installationId)
                  if (!currentSession || currentSession.proc !== proc) return
                  const currentExtras = discoverExtraModelFolders(inst.installPath)
                  const newFolders = currentExtras.filter((f) => !knownExtras.has(f))
                  if (newFolders.length > 0) {
                    const { config } = syncCustomModelFolders(inst.installPath, sharedModelsDirs)
                    if (config) {
                      for (const f of config.extraFolders) knownExtras.add(f)
                    }
                    for (const f of newFolders) knownExtras.add(f)
                    sendOutput(`\n--- Restarting: new model folders detected (${newFolders.join(', ')}) ---\n\n`)
                    pendingModelFolderRelaunch = true
                    if (_onModelFolderRelaunch) {
                      await Promise.resolve(_onModelFolderRelaunch({ installationId })).catch(() => {})
                    }
                    killProcessTree(proc)
                  }
                })
                .catch(() => {})
            }
            // Capture snapshot after Manager-triggered restart
            if (inst.sourceId === 'standalone') {
              installations.get(installationId).then((currentInst) => {
                if (!currentInst) return
                captureSnapshotIfChanged(currentInst.installPath, currentInst, 'restart')
                  .then(async ({ saved, filename }) => {
                    if (saved) {
                      const snapshotCount = await getSnapshotCount(currentInst.installPath)
                      installations.update(installationId, { lastSnapshot: filename, snapshotCount })
                    }
                  })
                  .catch((err) => console.warn('Snapshot capture failed:', err))
              })
            }
            return
          }
          const crashed = _runningSessions.has(installationId)
          _removeSession(installationId)
          if (!sender.isDestroyed()) {
            sender.send('comfy-exited', { installationId, crashed, exitCode: code, installationName: inst.name })
          }
          if (_onComfyExited) _onComfyExited({ installationId })
        })
      }
      attachExitHandler(proc)

      if (_onLaunch) {
        _onLaunch({ port: launchCmd.port!, process: proc, installation: inst, mode })
      }
      return { ok: true, mode, port: launchCmd.port }
    }
    // Delegate to source plugin's handleAction
    const abort = new AbortController()
    _operationAborts.set(installationId, abort)
    const sender = _event.sender
    const sendProgress = (phase: string, detail: Record<string, unknown>): void => {
      try { if (!sender.isDestroyed()) sender.send('install-progress', { installationId, phase, ...detail }) } catch {}
    }
    const sendOutput = (text: string): void => {
      try { if (!sender.isDestroyed()) sender.send('comfy-output', { installationId, text }) } catch {}
    }
    const update = (data: Record<string, unknown>): Promise<void> =>
      installations.update(installationId, data).then(() => {})
    const source = sourceMap[inst.sourceId]
    if (!source) {
      _operationAborts.delete(installationId)
      return { ok: false, message: i18n.t('errors.unknownSource') }
    }
    try {
      return await source.handleAction(actionId, inst, actionData, { update, sendProgress, sendOutput, signal: abort.signal })
    } catch (err) {
      if (abort.signal.aborted) return { ok: false, message: 'Cancelled' }
      return { ok: false, message: (err as Error).message }
    } finally {
      _operationAborts.delete(installationId)
    }
  })
}
