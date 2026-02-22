declare global {
  interface Window {
    api: {
      // Sources / New Install
      getSources(): Promise<Source[]>
      getFieldOptions(
        sourceId: string,
        fieldId: string,
        selections: Record<string, unknown>
      ): Promise<FieldOption[]>
      buildInstallation(
        sourceId: string,
        selections: Record<string, unknown>
      ): Promise<Record<string, unknown>>
      getDefaultInstallDir(): Promise<string>
      detectGPU(): Promise<{ label: string } | null>

      // File/URL
      browseFolder(defaultPath?: string): Promise<string | null>
      openPath(targetPath: string): Promise<void>
      openExternal(url: string): Promise<void>

      // Locale
      getLocaleMessages(): Promise<Record<string, unknown>>
      getAvailableLocales(): Promise<{ value: string; label: string }[]>

      // Installations
      getInstallations(): Promise<Installation[]>
      addInstallation(
        data: Record<string, unknown>
      ): Promise<{ ok: boolean; message?: string; entry?: Installation }>
      reorderInstallations(orderedIds: string[]): Promise<void>
      probeInstallation(dirPath: string): Promise<ProbeResult[]>
      trackInstallation(
        data: Record<string, unknown>
      ): Promise<{ ok: boolean; message?: string }>
      installInstance(installationId: string): Promise<void>
      updateInstallation(
        installationId: string,
        data: Record<string, unknown>
      ): Promise<{ ok?: boolean; message?: string } | void>

      // Running
      stopComfyUI(installationId: string): Promise<void>
      focusComfyWindow(installationId: string): Promise<void>
      getRunningInstances(): Promise<RunningInstance[]>
      cancelLaunch(): Promise<void>
      cancelOperation(installationId: string): Promise<void>
      killPortProcess(port: number): Promise<{ ok: boolean }>

      // Actions
      getListActions(installationId: string): Promise<ListAction[]>
      getDetailSections(installationId: string): Promise<DetailSection[]>
      runAction(
        installationId: string,
        actionId: string,
        actionData?: Record<string, unknown>
      ): Promise<ActionResult>

      // Settings
      getSettingsSections(): Promise<SettingsSection[]>
      getModelsSections(): Promise<{ systemDefault: string; sections: ModelsSection[] }>
      setSetting(key: string, value: unknown): Promise<void>
      getSetting(key: string): Promise<unknown>

      // Theme
      getResolvedTheme(): Promise<string>

      // App
      quitApp(): Promise<void>

      // Updates
      checkForUpdate(): Promise<void>
      downloadUpdate(): Promise<void>
      installUpdate(): Promise<void>
      getPendingUpdate(): Promise<{ version: string } | null>

      // Event listeners (return unsubscribe functions)
      onInstallProgress(callback: (data: ProgressData) => void): () => void
      onComfyOutput(
        callback: (data: { installationId: string; text: string }) => void
      ): () => void
      onComfyExited(
        callback: (data: {
          installationId: string
          installationName: string
          crashed?: boolean
          exitCode?: number
        }) => void
      ): () => void
      onInstanceStarted(callback: (data: RunningInstance) => void): () => void
      onInstanceStopped(callback: (data: { installationId: string }) => void): () => void
      onThemeChanged(callback: (theme: string) => void): () => void
      onLocaleChanged(callback: (messages: Record<string, unknown>) => void): () => void
      onConfirmQuit(callback: () => void): () => void
      onUpdateAvailable(callback: (info: { version: string }) => void): () => void
      onUpdateDownloadProgress(
        callback: (progress: { transferred: string; total: string; percent: number }) => void
      ): () => void
      onUpdateDownloaded(callback: (info: { version: string }) => void): () => void
      onUpdateError(callback: (err: { message: string }) => void): () => void
    }
  }
}

// Supporting types used in the API interface above

interface Installation {
  id: string
  name: string
  sourceLabel: string
  sourceCategory: string
  version?: string
  statusTag?: { style: string; label: string }
  seen?: boolean
  listPreview?: string
  launchMode?: string
  launchArgs?: string
  hasConsole?: boolean
  installPath?: string
  status?: string
  [key: string]: unknown
}

interface RunningInstance {
  installationId: string
  installationName: string
  port?: number
  url?: string
  mode: string
}

interface Source {
  id: string
  label: string
  fields: SourceField[]
  hideInstallPath?: boolean
  skipInstall?: boolean
}

interface SourceField {
  id: string
  label: string
  type: 'text' | 'select'
  defaultValue?: string
  action?: { label: string }
  errorTarget?: string
}

interface FieldOption {
  value: string
  label: string
  description?: string
  recommended?: boolean
}

interface DetailSection {
  title?: string
  description?: string
  collapsed?: boolean
  pinBottom?: boolean
  items?: { label: string; active?: boolean; actions?: ActionDef[] }[]
  fields?: DetailField[]
  actions?: ActionDef[]
}

interface DetailField {
  id: string
  label: string
  value: string | boolean | number | null
  editable?: boolean
  editType?: 'select' | 'boolean' | 'text'
  options?: { value: string; label: string }[]
  refreshSection?: boolean
  onChangeAction?: string
}

interface ActionDef {
  id: string
  label: string
  style?: 'primary' | 'danger'
  enabled?: boolean
  disabledMessage?: string
  confirm?: {
    title?: string
    message?: string
    confirmLabel?: string
    options?: { id: string; label: string; checked?: boolean }[]
  }
  showProgress?: boolean
  progressTitle?: string
  cancellable?: boolean
  data?: Record<string, unknown>
  fieldSelects?: {
    sourceId: string
    fieldId: string
    field: string
    title?: string
    message?: string
    emptyMessage?: string
  }[]
  select?: {
    source: string
    excludeSelf?: boolean
    filters?: Record<string, string>
    title?: string
    message?: string
    field: string
    emptyMessage?: string
  }
  prompt?: {
    title?: string
    message?: string
    placeholder?: string
    defaultValue?: string
    confirmLabel?: string
    field: string
    required?: boolean | string
  }
}

interface ActionResult {
  ok?: boolean
  navigate?: 'list' | 'detail'
  message?: string
  mode?: 'console' | 'window'
  portConflict?: {
    port: number
    nextPort?: number
    isComfy?: boolean
  }
}

interface ListAction {
  id: string
  label: string
  style?: 'primary' | 'danger'
  enabled?: boolean
  disabledMessage?: string
  confirm?: { title?: string; message?: string }
  showProgress?: boolean
  progressTitle?: string
  cancellable?: boolean
}

interface SettingsSection {
  title?: string
  fields: SettingsField[]
  actions?: { label: string; url?: string }[]
}

interface SettingsField {
  id: string
  label: string
  type: 'text' | 'path' | 'select' | 'boolean' | 'pathList' | 'number'
  value: string | boolean | number | string[] | null
  readonly?: boolean
  options?: { value: string; label: string }[]
  openable?: boolean
  min?: number
  max?: number
}

interface ModelsSection {
  title?: string
  fields: {
    id: string
    label: string
    type: 'pathList'
    value: string[]
  }[]
}

interface ProbeResult {
  sourceLabel: string
  version?: string
  repo?: string
  branch?: string
  [key: string]: unknown
}

interface ProgressData {
  installationId: string
  phase: string
  status?: string
  percent?: number
  steps?: { phase: string; label: string }[]
}

export {}
