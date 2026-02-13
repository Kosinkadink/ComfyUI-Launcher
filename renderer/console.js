window.Launcher = window.Launcher || {};

window.Launcher.console = {
  _unsubOutput: null,
  _unsubExited: null,

  show({ installationId, port, initialOutput }) {
    document.getElementById("console-title").textContent = "ComfyUI Console";
    const terminal = document.getElementById("console-terminal");
    terminal.textContent = initialOutput || "";
    terminal.scrollTop = terminal.scrollHeight;

    window.Launcher.showView("console");

    this._unsubOutput = window.api.onComfyOutput((data) => {
      if (data.installationId !== installationId) return;
      terminal.textContent += data.text;
      terminal.scrollTop = terminal.scrollHeight;
    });

    this._unsubExited = window.api.onComfyExited((data) => {
      if (data.installationId !== installationId) return;
      this._cleanup();
      terminal.textContent += "\n\n--- Process exited ---\n";
      terminal.scrollTop = terminal.scrollHeight;
      const stopBtn = document.getElementById("btn-console-stop");
      stopBtn.textContent = "Back";
      stopBtn.className = "";
      stopBtn.onclick = () => {
        window.Launcher.showView("list");
        window.Launcher.list.render();
      };
    });

    const browserBtn = document.getElementById("btn-console-browser");
    browserBtn.onclick = () => {
      window.api.openPath(`http://127.0.0.1:${port || 8188}`);
    };

    const stopBtn = document.getElementById("btn-console-stop");
    stopBtn.textContent = "Stop";
    stopBtn.className = "danger";
    stopBtn.onclick = async () => {
      await window.api.stopComfyUI();
      this._cleanup();
      window.Launcher.showView("list");
      window.Launcher.list.render();
    };
  },

  _cleanup() {
    if (this._unsubOutput) {
      this._unsubOutput();
      this._unsubOutput = null;
    }
    if (this._unsubExited) {
      this._unsubExited();
      this._unsubExited = null;
    }
  },
};
