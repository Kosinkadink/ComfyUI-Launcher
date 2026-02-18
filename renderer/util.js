window.Launcher = window.Launcher || {};

window.Launcher.esc = function esc(s) {
  const el = document.createElement("span");
  el.textContent = s || "";
  return el.innerHTML;
};

window.Launcher.linkify = function linkify(s) {
  const escaped = window.Launcher.esc(s);
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    return `<a href="#" data-url="${url}">${url}</a>`;
  });
};

window.Launcher.applyTheme = function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme || "dark");
};

// Running instances registry — tracks which installations have active ComfyUI processes
window.Launcher._runningInstances = new Map(); // installationId -> { port, url, mode, installationName }

window.Launcher.initRunningInstances = async function initRunningInstances() {
  const instances = await window.api.getRunningInstances();
  instances.forEach((inst) => {
    window.Launcher._runningInstances.set(inst.installationId, inst);
  });

  window.Launcher._updateRunningTab();

  window.api.onInstanceStarted((data) => {
    window.Launcher._runningInstances.set(data.installationId, data);
    window.Launcher._updateRunningTab();
    window.Launcher.list.render();
    window.Launcher._refreshRunningViewIfActive();
  });

  window.api.onInstanceStopped((data) => {
    window.Launcher._runningInstances.delete(data.installationId);
    window.Launcher._updateRunningTab();
    window.Launcher.list.render();
    window.Launcher._refreshRunningViewIfActive();
  });
};

window.Launcher.isInstanceRunning = function isInstanceRunning(installationId) {
  return window.Launcher._runningInstances.has(installationId);
};

// Active sessions tracking — transitive operations only (installing, launching, deleting)
window.Launcher._activeSessions = new Map(); // installationId -> { label }

// Error instances — processes that crashed unexpectedly
window.Launcher._errorInstances = new Map(); // installationId -> { installationName, exitCode }

window.Launcher.setActiveSession = function setActiveSession(installationId, label) {
  window.Launcher._activeSessions.set(installationId, { label: label || "" });
  // Clear any previous error when re-launching
  window.Launcher._errorInstances.delete(installationId);
  window.Launcher._updateRunningTab();
  window.Launcher._refreshRunningViewIfActive();
  window.Launcher.list.render();
};

window.Launcher.clearActiveSession = function clearActiveSession(installationId) {
  if (installationId) {
    window.Launcher._activeSessions.delete(installationId);
  } else {
    window.Launcher._activeSessions.clear();
  }
  window.Launcher._updateRunningTab();
  window.Launcher._refreshRunningViewIfActive();
};

window.Launcher._refreshRunningViewIfActive = function _refreshRunningViewIfActive() {
  const runningView = document.getElementById("view-running");
  if (runningView && runningView.classList.contains("active")) {
    window.Launcher.running.show();
  }
};

window.Launcher.getActiveSessionForInstallation = function getActiveSessionForInstallation(installationId) {
  return window.Launcher._activeSessions.get(installationId) || null;
};

window.Launcher.clearErrorInstance = function clearErrorInstance(installationId) {
  window.Launcher._errorInstances.delete(installationId);
  window.Launcher.sessions.clear(installationId);
  window.Launcher._updateRunningTab();
  window.Launcher.list.render();
  window.Launcher._refreshRunningViewIfActive();
};

window.Launcher.isConsoleViewActive = function isConsoleViewActive(installationId) {
  const modal = document.getElementById("modal-console");
  return modal && modal.classList.contains("active") && window.Launcher.console._installationId === installationId;
};

window.Launcher._updateRunningTab = function _updateRunningTab() {
  const btn = document.querySelector('.sidebar-item[data-sidebar="running"]');
  if (!btn) return;
  const count = window.Launcher._activeSessions.size + window.Launcher._runningInstances.size;
  const countEl = btn.querySelector(".sidebar-count");
  if (countEl) {
    countEl.textContent = count;
    countEl.style.display = count > 0 ? "" : "none";
  }
  const errorDot = btn.querySelector(".sidebar-error-dot");
  if (errorDot) {
    errorDot.style.display = window.Launcher._errorInstances.size > 0 ? "" : "none";
  }
};

// Map each view to its parent sidebar item
window.Launcher._sidebarMap = {
  list: "list",
  running: "running",
  models: "models",
  settings: "settings",
};

// Modal views — sub-views shown as overlays instead of replacing content
window.Launcher._modalViews = new Set(["detail", "console", "progress", "new", "track"]);

/**
 * Build the skeleton of an instance card (card container, info area, actions area).
 * @param {Object} opts
 * @param {string} opts.name - Display name
 * @param {string} opts.metaHtml - innerHTML for the meta line
 * @param {string} [opts.installationId] - dataset.id for the card
 * @param {boolean} [opts.draggable] - include drag handle
 * @returns {{ card: HTMLElement, infoEl: HTMLElement, actionsEl: HTMLElement }}
 */
window.Launcher.buildCard = function buildCard({ name, metaHtml, installationId, draggable } = {}) {
  const card = document.createElement("div");
  card.className = "instance-card";
  if (installationId) card.dataset.id = installationId;

  if (draggable) {
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.title = window.t("list.dragToReorder");
    handle.innerHTML = "<span></span><span></span><span></span>";
    card.appendChild(handle);
  }

  const infoEl = document.createElement("div");
  infoEl.className = "instance-info";
  const nameEl = document.createElement("div");
  nameEl.className = "instance-name";
  nameEl.textContent = name;
  infoEl.appendChild(nameEl);
  if (metaHtml) {
    const meta = document.createElement("div");
    meta.className = "instance-meta";
    meta.innerHTML = metaHtml;
    infoEl.appendChild(meta);
  }
  card.appendChild(infoEl);

  const actionsEl = document.createElement("div");
  actionsEl.className = "instance-actions";
  card.appendChild(actionsEl);

  return { card, infoEl, actionsEl };
};

window.Launcher.buildManageBtn = function buildManageBtn(inst) {
  const btn = document.createElement("button");
  btn.className = "manage-btn";
  btn.textContent = window.t("list.view");
  btn.onclick = () => window.Launcher.detail.show(inst);
  return btn;
};

window.Launcher.buildConsoleBtn = function buildConsoleBtn(installationId) {
  const btn = document.createElement("button");
  btn.textContent = window.t("list.console");
  btn.onclick = () => window.Launcher.console.show(installationId);
  return btn;
};

window.Launcher.buildStopBtn = function buildStopBtn(installationId) {
  const btn = document.createElement("button");
  btn.className = "danger";
  btn.textContent = window.t("console.stop");
  btn.onclick = () => window.api.stopComfyUI(installationId);
  return btn;
};

window.Launcher.buildFocusBtn = function buildFocusBtn(installationId) {
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = window.t("running.showWindow");
  btn.onclick = () => window.api.focusComfyWindow(installationId);
  return btn;
};

window.Launcher.buildProgressBtn = function buildProgressBtn(installationId) {
  const btn = document.createElement("button");
  btn.className = "primary";
  btn.textContent = window.t("list.viewProgress");
  btn.onclick = () => window.Launcher.progress.showOperation(installationId);
  return btn;
};

/**
 * Build a mini progress bar for an instance card.
 * Returns a container element with status text and a thin progress bar.
 */
window.Launcher.buildCardProgress = function buildCardProgress(installationId) {
  const info = window.Launcher.progress.getProgressInfo(installationId);
  const wrap = document.createElement("div");
  wrap.className = "card-progress";
  wrap.dataset.progressId = installationId;
  const status = document.createElement("div");
  status.className = "card-progress-status";
  status.textContent = info ? info.status : "";
  wrap.appendChild(status);
  const track = document.createElement("div");
  track.className = "card-progress-track";
  const fill = document.createElement("div");
  fill.className = "card-progress-fill";
  if (info && info.percent >= 0) {
    fill.style.width = `${info.percent}%`;
  } else {
    fill.style.width = "100%";
    fill.classList.add("indeterminate");
  }
  track.appendChild(fill);
  wrap.appendChild(track);
  return wrap;
};

/**
 * Update all visible card progress bars in-place (called from progress tick).
 */
window.Launcher._updateCardProgress = function _updateCardProgress(installationId) {
  document.querySelectorAll(`.card-progress[data-progress-id="${installationId}"]`).forEach((wrap) => {
    const info = window.Launcher.progress.getProgressInfo(installationId);
    if (!info) return;
    const status = wrap.querySelector(".card-progress-status");
    if (status) status.textContent = info.status;
    const fill = wrap.querySelector(".card-progress-fill");
    if (fill) {
      if (info.percent >= 0) {
        fill.style.width = `${info.percent}%`;
        fill.classList.remove("indeterminate");
      } else {
        fill.style.width = "100%";
        fill.classList.add("indeterminate");
      }
    }
  });
};

window.Launcher.showViewModal = function showViewModal(name) {
  const modal = document.getElementById(`modal-${name}`);
  if (!modal) return;
  // Close any other open view modals first
  document.querySelectorAll(".view-modal.active").forEach((m) => {
    if (m !== modal) m.classList.remove("active");
  });
  modal.classList.add("active");
  modal.onclick = (e) => {
    if (e.target === modal) window.Launcher.closeViewModal(name);
  };
};

window.Launcher.closeViewModal = function closeViewModal(name) {
  const modal = document.getElementById(`modal-${name}`);
  if (modal) modal.classList.remove("active");
};

window.Launcher.showView = function showView(name) {
  if (window.Launcher._modalViews.has(name)) {
    window.Launcher.showViewModal(name);
    return;
  }
  // Tab view — switch content and close any open modals
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  document.getElementById(`view-${name}`).classList.add("active");
  document.querySelectorAll(".view-modal").forEach((m) => m.classList.remove("active"));

  // Update sidebar active state
  const sidebarKey = window.Launcher._sidebarMap[name] || "list";
  document.querySelectorAll(".sidebar-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.sidebar === sidebarKey);
  });
};
