window.Launcher = window.Launcher || {};

window.Launcher.updateBanner = {
  init() {
    const banner = document.getElementById("update-banner");

    window.api.onUpdateAvailable((info) => {
      this._showAvailable(banner, info);
    });

    window.api.onUpdateDownloadProgress((progress) => {
      this._showDownloading(banner, progress);
    });

    window.api.onUpdateDownloaded((info) => {
      this._showReady(banner, info);
    });

    window.api.onUpdateError((err) => {
      this._showError(banner, err);
    });

    // Check if an update was already detected before this view loaded
    window.api.getPendingUpdate().then((info) => {
      if (info) this._showAvailable(banner, info);
    });
  },

  _showAvailable(banner, info) {
    const { esc } = window.Launcher;
    banner.innerHTML = `
      <span class="update-text">Update available: <strong>v${esc(info.version)}</strong></span>
      <button class="primary" id="btn-update-download">Download</button>
      <button id="btn-update-dismiss">Dismiss</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-download").onclick = () => window.api.downloadUpdate();
    document.getElementById("btn-update-dismiss").onclick = () => { banner.style.display = "none"; };
  },

  _showDownloading(banner, progress) {
    const { esc } = window.Launcher;
    banner.innerHTML = `
      <span class="update-text">Downloading update… ${esc(progress.transferred)} / ${esc(progress.total)} MB (${progress.percent}%)</span>`;
    banner.style.display = "flex";
  },

  _showReady(banner, info) {
    const { esc } = window.Launcher;
    banner.innerHTML = `
      <span class="update-text">Update <strong>v${esc(info.version)}</strong> ready to install</span>
      <button class="primary" id="btn-update-install">Restart & Update</button>
      <button id="btn-update-later">Later</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-install").onclick = () => window.api.installUpdate();
    document.getElementById("btn-update-later").onclick = () => { banner.style.display = "none"; };
  },

  _showError(banner, err) {
    banner.innerHTML = `
      <span class="update-text">Update check failed</span>
      <button id="btn-update-details">Details</button>
      <button id="btn-update-retry">Retry</button>
      <button id="btn-update-error-dismiss">Dismiss</button>`;
    banner.style.display = "flex";
    document.getElementById("btn-update-details").onclick = () => {
      window.Launcher.modal.alert({ title: "Update Error", message: err.message });
    };
    document.getElementById("btn-update-retry").onclick = () => {
      banner.style.display = "none";
      window.api.checkForUpdate();
    };
    document.getElementById("btn-update-error-dismiss").onclick = () => { banner.style.display = "none"; };
  },
};
