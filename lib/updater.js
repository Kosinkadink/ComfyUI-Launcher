const { autoUpdater } = require("electron-updater");
const { ipcMain, BrowserWindow } = require("electron");
const settings = require("../settings");

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

let _updateInfo = null;

function broadcast(channel, data) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  });
}

function register() {
  autoUpdater.on("update-available", (info) => {
    _updateInfo = { version: info.version, releaseNotes: info.releaseNotes || "" };
    broadcast("update-available", _updateInfo);
  });

  autoUpdater.on("update-not-available", () => {
    _updateInfo = null;
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcast("update-download-progress", {
      percent: Math.round(progress.percent),
      transferred: (progress.transferred / 1048576).toFixed(1),
      total: (progress.total / 1048576).toFixed(1),
    });
  });

  autoUpdater.on("update-downloaded", () => {
    broadcast("update-downloaded", _updateInfo);
  });

  autoUpdater.on("error", (err) => {
    broadcast("update-error", { message: err.message });
  });

  ipcMain.handle("check-for-update", async () => {
    try {
      const result = await autoUpdater.checkForUpdates();
      if (result && result.updateInfo) {
        return { available: true, version: result.updateInfo.version };
      }
      return { available: false };
    } catch (err) {
      return { available: false, error: err.message };
    }
  });

  ipcMain.handle("download-update", () => {
    autoUpdater.downloadUpdate();
  });

  ipcMain.handle("install-update", () => {
    autoUpdater.quitAndInstall(false, true);
  });

  ipcMain.handle("get-pending-update", () => _updateInfo);

  // Check on startup if auto-update is enabled
  if (settings.get("autoUpdate") !== false) {
    // Delay to avoid slowing down app launch
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }
}

module.exports = { register };
