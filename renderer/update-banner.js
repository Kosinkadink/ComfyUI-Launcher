window.Launcher = window.Launcher || {};

window.Launcher.updateBanner = {
  _state: null, // { type: "available"|"downloading"|"ready"|"error", data: ... }

  init() {
    const banner = document.getElementById("update-banner");

    window.api.onUpdateAvailable((info) => {
      this._state = { type: "available", data: info };
      this._showAvailable(banner, info);
    });

    window.api.onUpdateDownloadProgress((progress) => {
      this._state = { type: "downloading", data: progress };
      this._showDownloading(banner, progress);
    });

    window.api.onUpdateDownloaded((info) => {
      this._state = { type: "ready", data: info };
      this._showReady(banner, info);
    });

    window.api.onUpdateError((err) => {
      this._state = { type: "error", data: err };
      this._showError(banner, err);
    });

    // Check if an update was already detected before this view loaded
    window.api.getPendingUpdate().then((info) => {
      if (info) {
        this._state = { type: "available", data: info };
        this._showAvailable(banner, info);
      }
    });
  },

  refresh() {
    if (!this._state) return;
    const banner = document.getElementById("update-banner");
    if (!banner || banner.style.display === "none") return;
    const { type, data } = this._state;
    if (type === "available") this._showAvailable(banner, data);
    else if (type === "downloading") this._showDownloading(banner, data);
    else if (type === "ready") this._showReady(banner, data);
    else if (type === "error") this._showError(banner, data);
  },

  _showAvailable(banner, info) {
    const { esc } = window.Launcher;
    const availText = window.t("update.available", { version: info.version }).replace(/\*\*(.+?)\*\*/g, (_, s) => `<strong>${esc(s)}</strong>`);
    banner.innerHTML = `
      <span class="update-text">${availText}</span>
      <button class="primary" id="btn-update-download">${esc(window.t("update.download"))}</button>
      <button id="btn-update-dismiss">${esc(window.t("update.dismiss"))}</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-download").onclick = () => window.api.downloadUpdate();
    document.getElementById("btn-update-dismiss").onclick = () => { banner.style.display = "none"; };
  },

  _showDownloading(banner, progress) {
    const { esc } = window.Launcher;
    banner.innerHTML = `
      <span class="update-text">${esc(window.t("update.downloading", { progress: `${progress.transferred} / ${progress.total} MB (${progress.percent}%)` }))}</span>`;
    banner.style.display = "flex";
  },

  _showReady(banner, info) {
    const { esc } = window.Launcher;
    const readyText = window.t("update.ready", { version: info.version }).replace(/\*\*(.+?)\*\*/g, (_, s) => `<strong>${esc(s)}</strong>`);
    banner.innerHTML = `
      <span class="update-text">${readyText}</span>
      <button class="primary" id="btn-update-install">${esc(window.t("update.restartUpdate"))}</button>
      <button id="btn-update-later">${esc(window.t("update.later"))}</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-install").onclick = () => window.api.installUpdate();
    document.getElementById("btn-update-later").onclick = () => { banner.style.display = "none"; };
  },

  _showError(banner, err) {
    const { esc } = window.Launcher;
    banner.innerHTML = `
      <span class="update-text">${esc(window.t("update.checkFailed"))}</span>
      <button id="btn-update-details">${esc(window.t("update.details"))}</button>
      <button id="btn-update-retry">${esc(window.t("update.retry"))}</button>
      <button id="btn-update-error-dismiss">${esc(window.t("update.dismiss"))}</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-details").onclick = () => {
      window.Launcher.modal.alert({ title: window.t("update.updateError"), message: err.message });
    };
    document.getElementById("btn-update-retry").onclick = () => {
      banner.style.display = "none";
      window.api.checkForUpdate();
    };
    document.getElementById("btn-update-error-dismiss").onclick = () => { banner.style.display = "none"; };
  },
};
