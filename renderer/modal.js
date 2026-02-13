window.Launcher = window.Launcher || {};

window.Launcher.modal = {
  alert({ title, message, buttonLabel = "OK" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const box = document.createElement("div");
      box.className = "modal-box";
      box.innerHTML = `
        <div class="modal-title">${window.Launcher.esc(title)}</div>
        <div class="modal-message">${window.Launcher.esc(message)}</div>
        <div class="modal-actions">
          <button class="primary modal-ok">${window.Launcher.esc(buttonLabel)}</button>
        </div>`;

      const close = () => { overlay.remove(); resolve(); };

      box.querySelector(".modal-ok").onclick = close;
      overlay.onclick = (e) => { if (e.target === overlay) close(); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      box.querySelector(".modal-ok").focus();
    });
  },

  confirm({ title, message, confirmLabel = "Confirm", confirmStyle = "danger" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const box = document.createElement("div");
      box.className = "modal-box";
      box.innerHTML = `
        <div class="modal-title">${window.Launcher.esc(title)}</div>
        <div class="modal-message">${window.Launcher.esc(message)}</div>
        <div class="modal-actions">
          <button class="modal-cancel">Cancel</button>
          <button class="${confirmStyle} modal-confirm">${window.Launcher.esc(confirmLabel)}</button>
        </div>`;

      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      box.querySelector(".modal-cancel").onclick = () => close(false);
      box.querySelector(".modal-confirm").onclick = () => close(true);
      overlay.onclick = (e) => { if (e.target === overlay) close(false); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      box.querySelector(".modal-cancel").focus();
    });
  },
};
