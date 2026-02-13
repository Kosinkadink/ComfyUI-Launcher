window.Launcher = window.Launcher || {};

window.Launcher.progress = {
  _unsubscribe: null,

  show({ installationId, title, apiCall }) {
    document.getElementById("progress-title").textContent = title || "Working…";
    const container = document.getElementById("progress-content");
    container.innerHTML = `
      <div class="progress-status" id="progress-status">Starting…</div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" id="progress-fill"></div>
      </div>
      <div class="terminal-output" id="progress-terminal"></div>`;

    window.Launcher.showView("progress");

    this._unsubscribe = window.api.onInstallProgress((data) => {
      if (data.installationId !== installationId) return;
      const statusEl = document.getElementById("progress-status");
      const fillEl = document.getElementById("progress-fill");

      if (statusEl) statusEl.textContent = data.status || data.phase;
      if (fillEl) {
        if (data.percent >= 0) {
          fillEl.style.width = `${data.percent}%`;
          fillEl.classList.remove("indeterminate");
        } else {
          fillEl.style.width = "100%";
          fillEl.classList.add("indeterminate");
        }
      }
    });

    this._unsubComfy = window.api.onComfyOutput((data) => {
      if (data.installationId !== installationId) return;
      const term = document.getElementById("progress-terminal");
      if (term) {
        term.textContent += data.text;
        term.scrollTop = term.scrollHeight;
      }
    });

    const showError = (msg) => {
      this._cleanup();
      const statusEl = document.getElementById("progress-status");
      if (statusEl) statusEl.textContent = `Error: ${msg}`;
      const container = document.getElementById("progress-content");
      const btn = document.createElement("button");
      btn.textContent = "Back";
      btn.onclick = () => {
        window.Launcher.showView("list");
        window.Launcher.list.render();
      };
      container.appendChild(btn);
    };

    return apiCall().then((result) => {
      this._cleanup();
      if (result.ok) {
        if (result.mode === "console") {
          const initialOutput = document.getElementById("progress-terminal")?.textContent || "";
          window.Launcher.console.show({ installationId, port: result.port, url: result.url, initialOutput });
        } else {
          window.Launcher.showView("list");
          window.Launcher.list.render();
        }
      } else {
        showError(result.message);
      }
    }).catch((err) => {
      showError(err.message);
    });
  },

  _cleanup() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    if (this._unsubComfy) {
      this._unsubComfy();
      this._unsubComfy = null;
    }
  },
};
