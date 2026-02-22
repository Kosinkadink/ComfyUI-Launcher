import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'

const api = {
  // Sources / New Install
  getSources: () => ipcRenderer.invoke('get-sources'),
  getFieldOptions: (sourceId: string, fieldId: string, selections: Record<string, unknown>) =>
    ipcRenderer.invoke('get-field-options', sourceId, fieldId, selections),
  buildInstallation: (sourceId: string, selections: Record<string, unknown>) =>
    ipcRenderer.invoke('build-installation', sourceId, selections),
  getDefaultInstallDir: () => ipcRenderer.invoke('get-default-install-dir'),
  detectGPU: () => ipcRenderer.invoke('detect-gpu'),

  // File/URL
  browseFolder: (defaultPath?: string) => ipcRenderer.invoke('browse-folder', defaultPath),
  openPath: (targetPath: string) => ipcRenderer.invoke('open-path', targetPath),
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),

  // Locale
  getLocaleMessages: () => ipcRenderer.invoke('get-locale-messages'),
  getAvailableLocales: () => ipcRenderer.invoke('get-available-locales'),

  // Installations
  getInstallations: () => ipcRenderer.invoke('get-installations'),
  addInstallation: (data: Record<string, unknown>) =>
    ipcRenderer.invoke('add-installation', data),
  reorderInstallations: (orderedIds: string[]) =>
    ipcRenderer.invoke('reorder-installations', orderedIds),
  probeInstallation: (dirPath: string) => ipcRenderer.invoke('probe-installation', dirPath),
  trackInstallation: (data: Record<string, unknown>) =>
    ipcRenderer.invoke('track-installation', data),
  installInstance: (installationId: string) =>
    ipcRenderer.invoke('install-instance', installationId),
  updateInstallation: (installationId: string, data: Record<string, unknown>) =>
    ipcRenderer.invoke('update-installation', installationId, data),

  // Running
  stopComfyUI: (installationId: string) => ipcRenderer.invoke('stop-comfyui', installationId),
  focusComfyWindow: (installationId: string) =>
    ipcRenderer.invoke('focus-comfy-window', installationId),
  getRunningInstances: () => ipcRenderer.invoke('get-running-instances'),
  cancelLaunch: () => ipcRenderer.invoke('cancel-launch'),
  cancelOperation: (installationId: string) =>
    ipcRenderer.invoke('cancel-operation', installationId),
  killPortProcess: (port: number) => ipcRenderer.invoke('kill-port-process', port),

  // Actions
  getListActions: (installationId: string) =>
    ipcRenderer.invoke('get-list-actions', installationId),
  getDetailSections: (installationId: string) =>
    ipcRenderer.invoke('get-detail-sections', installationId),
  runAction: (installationId: string, actionId: string, actionData?: Record<string, unknown>) =>
    ipcRenderer.invoke('run-action', installationId, actionId, actionData),

  // Settings
  getSettingsSections: () => ipcRenderer.invoke('get-settings-sections'),
  getModelsSections: () => ipcRenderer.invoke('get-models-sections'),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),

  // Theme
  getResolvedTheme: () => ipcRenderer.invoke('get-resolved-theme'),

  // App
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Updates
  checkForUpdate: () => ipcRenderer.invoke('check-for-update'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  getPendingUpdate: () => ipcRenderer.invoke('get-pending-update'),

  // Event listeners (return unsubscribe functions)
  onInstallProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('install-progress', handler)
    return () => ipcRenderer.removeListener('install-progress', handler)
  },
  onComfyOutput: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('comfy-output', handler)
    return () => ipcRenderer.removeListener('comfy-output', handler)
  },
  onComfyExited: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('comfy-exited', handler)
    return () => ipcRenderer.removeListener('comfy-exited', handler)
  },
  onInstanceStarted: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('instance-started', handler)
    return () => ipcRenderer.removeListener('instance-started', handler)
  },
  onInstanceStopped: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('instance-stopped', handler)
    return () => ipcRenderer.removeListener('instance-stopped', handler)
  },
  onThemeChanged: (callback: (theme: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, theme: unknown) => callback(theme)
    ipcRenderer.on('theme-changed', handler)
    return () => ipcRenderer.removeListener('theme-changed', handler)
  },
  onLocaleChanged: (callback: (messages: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, messages: unknown) => callback(messages)
    ipcRenderer.on('locale-changed', handler)
    return () => ipcRenderer.removeListener('locale-changed', handler)
  },
  onConfirmQuit: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on('confirm-quit', handler)
    return () => ipcRenderer.removeListener('confirm-quit', handler)
  },
  onUpdateAvailable: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('update-available', handler)
    return () => ipcRenderer.removeListener('update-available', handler)
  },
  onUpdateDownloadProgress: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('update-download-progress', handler)
    return () => ipcRenderer.removeListener('update-download-progress', handler)
  },
  onUpdateDownloaded: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('update-downloaded', handler)
    return () => ipcRenderer.removeListener('update-downloaded', handler)
  },
  onUpdateError: (callback: (data: unknown) => void) => {
    const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
    ipcRenderer.on('update-error', handler)
    return () => ipcRenderer.removeListener('update-error', handler)
  }
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-expect-error fallback for non-isolated contexts
  window.api = api
}
