window.Launcher = window.Launcher || {};

window.Launcher.modal = {
  _wireLinks(box) {
    box.querySelectorAll("a[data-url]").forEach((a) => {
      a.onclick = (e) => {
        e.preventDefault();
        window.api.openExternal(a.dataset.url);
      };
    });
  },

  alert({ title, message, buttonLabel = "OK" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const box = document.createElement("div");
      box.className = "modal-box";
      box.innerHTML = `
        <div class="modal-title">${window.Launcher.esc(title)}</div>
        <div class="modal-message">${window.Launcher.linkify(message)}</div>
        <div class="modal-actions">
          <button class="primary modal-ok">${window.Launcher.esc(buttonLabel)}</button>
        </div>`;

      this._wireLinks(box);
      const close = () => { overlay.remove(); resolve(); };

      box.querySelector(".modal-ok").onclick = close;
      let downOnOverlay = false;
      overlay.onmousedown = (e) => { downOnOverlay = e.target === overlay; };
      overlay.onclick = (e) => { if (e.target === overlay && downOnOverlay) close(); };

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
        <div class="modal-message">${window.Launcher.linkify(message)}</div>
        <div class="modal-actions">
          <button class="modal-cancel">${window.Launcher.esc(window.t("common.cancel"))}</button>
          <button class="${confirmStyle} modal-confirm">${window.Launcher.esc(confirmLabel)}</button>
        </div>`;

      this._wireLinks(box);
      const close = (result) => {
        overlay.remove();
        resolve(result);
      };

      box.querySelector(".modal-cancel").onclick = () => close(false);
      box.querySelector(".modal-confirm").onclick = () => close(true);
      let downOnOverlay = false;
      overlay.onmousedown = (e) => { downOnOverlay = e.target === overlay; };
      overlay.onclick = (e) => { if (e.target === overlay && downOnOverlay) close(false); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      box.querySelector(".modal-cancel").focus();
    });
  },

  confirmWithOptions({ title, message, options, confirmLabel = "Confirm", confirmStyle = "danger" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const box = document.createElement("div");
      box.className = "modal-box";
      box.innerHTML = `
        <div class="modal-title">${window.Launcher.esc(title)}</div>
        <div class="modal-message">${window.Launcher.esc(message)}</div>
        <div class="modal-options">
          ${options.map((opt) => `<label class="modal-option"><input type="checkbox" data-id="${window.Launcher.esc(opt.id)}"${opt.checked ? " checked" : ""}><span>${window.Launcher.esc(opt.label)}</span></label>`).join("")}
        </div>
        <div class="modal-actions">
          <button class="modal-cancel">${window.Launcher.esc(window.t("common.cancel"))}</button>
          <button class="${confirmStyle} modal-confirm">${window.Launcher.esc(confirmLabel)}</button>
        </div>`;

      this._wireLinks(box);
      const confirmBtn = box.querySelector(".modal-confirm");
      const checkboxes = box.querySelectorAll('input[type="checkbox"]');

      const updateDisabled = () => {
        confirmBtn.disabled = ![...checkboxes].some((cb) => cb.checked);
      };
      updateDisabled();
      checkboxes.forEach((cb) => { cb.onchange = updateDisabled; });

      const close = (result) => {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(result);
      };
      const onKeyDown = (e) => { if (e.key === "Escape") close(null); };
      document.addEventListener("keydown", onKeyDown);

      box.querySelector(".modal-cancel").onclick = () => close(null);
      confirmBtn.onclick = () => {
        const result = {};
        checkboxes.forEach((cb) => { result[cb.dataset.id] = cb.checked; });
        close(result);
      };
      let downOnOverlay = false;
      overlay.onmousedown = (e) => { downOnOverlay = e.target === overlay; };
      overlay.onclick = (e) => { if (e.target === overlay && downOnOverlay) close(null); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      box.querySelector(".modal-cancel").focus();
    });
  },

  prompt({ title, message, placeholder = "", defaultValue = "", confirmLabel = "OK", required = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const requiredMsg = typeof required === "string" ? required : window.t("modal.required");
      const box = document.createElement("div");
      box.className = "modal-box";
      box.innerHTML = `
        <div class="modal-title">${window.Launcher.esc(title)}</div>
        <div class="modal-message">${window.Launcher.esc(message)}</div>
        <div class="modal-input-wrap"><input type="text" class="modal-input" placeholder="${window.Launcher.esc(placeholder)}"></div>
        <div class="modal-error"></div>
        <div class="modal-actions">
          <button class="modal-cancel">${window.Launcher.esc(window.t("common.cancel"))}</button>
          <button class="primary modal-confirm">${window.Launcher.esc(confirmLabel)}</button>
        </div>`;

      const close = (result) => { overlay.remove(); resolve(result); };
      const input = box.querySelector(".modal-input");
      if (defaultValue) {
        input.value = defaultValue;
      }
      const errorEl = box.querySelector(".modal-error");

      const trySubmit = () => {
        const val = input.value.trim();
        if (!val && required) {
          errorEl.textContent = requiredMsg;
          input.focus();
          return;
        }
        close(val || null);
      };

      input.oninput = () => { errorEl.textContent = ""; };
      box.querySelector(".modal-cancel").onclick = () => close(null);
      box.querySelector(".modal-confirm").onclick = trySubmit;
      input.onkeydown = (e) => { if (e.key === "Enter") trySubmit(); };
      let downOnOverlay = false;
      overlay.onmousedown = (e) => { downOnOverlay = e.target === overlay; };
      overlay.onclick = (e) => { if (e.target === overlay && downOnOverlay) close(null); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      input.focus();
    });
  },

  select({ title, message, items, confirmLabel }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      const box = document.createElement("div");
      box.className = "modal-box modal-select-box";

      const titleEl = document.createElement("div");
      titleEl.className = "modal-title";
      titleEl.textContent = title;
      box.appendChild(titleEl);

      if (message) {
        const msgEl = document.createElement("div");
        msgEl.className = "modal-message";
        msgEl.textContent = message;
        box.appendChild(msgEl);
      }

      const listEl = document.createElement("div");
      listEl.className = "modal-select-list";

      const close = (result) => {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(result);
      };
      const onKeyDown = (e) => { if (e.key === "Escape") close(null); };
      document.addEventListener("keydown", onKeyDown);

      for (const item of items) {
        const row = document.createElement("button");
        row.className = "modal-select-item";

        const label = document.createElement("span");
        label.className = "modal-select-item-label";
        label.textContent = item.label;
        row.appendChild(label);

        if (item.description) {
          const desc = document.createElement("span");
          desc.className = "modal-select-item-desc";
          desc.textContent = item.description;
          row.appendChild(desc);
        }

        row.onclick = () => close(item.value);
        listEl.appendChild(row);
      }

      box.appendChild(listEl);

      const actions = document.createElement("div");
      actions.className = "modal-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "modal-cancel";
      cancelBtn.textContent = window.t("common.cancel");
      cancelBtn.onclick = () => close(null);
      actions.appendChild(cancelBtn);
      box.appendChild(actions);

      let downOnOverlay = false;
      overlay.onmousedown = (e) => { downOnOverlay = e.target === overlay; };
      overlay.onclick = (e) => { if (e.target === overlay && downOnOverlay) close(null); };

      overlay.appendChild(box);
      document.body.appendChild(overlay);
    });
  },
};
