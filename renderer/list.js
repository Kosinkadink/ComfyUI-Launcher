window.Launcher = window.Launcher || {};

window.Launcher.list = {
  async render() {
    const { esc, showView } = window.Launcher;
    const el = document.getElementById("instance-list");
    const installations = await window.api.getInstallations();
    el.innerHTML = "";

    if (installations.length === 0) {
      el.innerHTML =
        '<div class="empty-state">No installations yet.<br>Click <strong>+ New Install</strong> to get started.</div>';
      return;
    }

    for (const inst of installations) {
      const card = document.createElement("div");
      card.className = "instance-card";
      const statusTag = inst.status === "failed" ? ' · <span class="status-failed">Install Failed</span>' : "";
      const launchMeta = inst.listPreview
        ? esc(inst.listPreview)
        : inst.launchMode
          ? `${esc(inst.launchMode)}${inst.launchArgs ? " · " + esc(inst.launchArgs) : ""}`
          : "";
      card.innerHTML = `
        <div class="instance-info">
          <div class="instance-name">${esc(inst.name)}</div>
          <div class="instance-meta">${esc(inst.sourceLabel)}${inst.version ? " · " + esc(inst.version) : ""}${statusTag}</div>
          ${launchMeta ? `<div class="instance-meta">${launchMeta}</div>` : ""}
        </div>
        <div class="instance-actions"></div>`;

      const actionsEl = card.querySelector(".instance-actions");
      const actions = await window.api.getListActions(inst.id);
      actions.forEach((a) => {
        const btn = document.createElement("button");
        btn.textContent = a.label;
        if (a.style === "primary") btn.className = "primary";
        if (a.style === "danger") btn.className = "danger";
        btn.disabled = a.enabled === false;
        btn.onclick = async () => {
          if (a.confirm) {
            const confirmed = await window.Launcher.modal.confirm({
              title: a.confirm.title || "Confirm",
              message: a.confirm.message || "Are you sure?",
              confirmLabel: a.label,
              confirmStyle: a.style || "danger",
            });
            if (!confirmed) return;
          }
          if (a.showProgress) {
            window.Launcher.progress.show({
              installationId: inst.id,
              title: a.progressTitle || `${a.label}…`,
              apiCall: () => window.api.runAction(inst.id, a.id),
            });
            return;
          }
          const result = await window.api.runAction(inst.id, a.id);
          if (result.navigate === "list") {
            window.Launcher.list.render();
          } else if (result.message) {
            await window.Launcher.modal.alert({ title: a.label, message: result.message });
          }
        };
        actionsEl.appendChild(btn);
      });

      const viewBtn = document.createElement("button");
      viewBtn.className = "view-btn";
      viewBtn.textContent = "View";
      viewBtn.onclick = () => window.Launcher.detail.show(inst);
      actionsEl.appendChild(viewBtn);

      el.appendChild(card);
    }
  },
};
