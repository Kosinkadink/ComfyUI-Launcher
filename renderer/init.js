window.api.getResolvedTheme().then((t) => window.Launcher.applyTheme(t));
window.api.onThemeChanged((t) => window.Launcher.applyTheme(t));
window.api.onLocaleChanged((msgs) => {
  window.Launcher.i18n.init(msgs);
  // Re-render whichever tab view is currently active
  const activeView = document.querySelector(".view.active");
  if (activeView) {
    const id = activeView.id.replace("view-", "");
    if (id === "list") window.Launcher.list.render();
    else if (id === "settings") window.Launcher.settings.show();
    else if (id === "models") window.Launcher.models.show();
    else if (id === "running") window.Launcher.running.show();
  }
  window.Launcher.updateBanner.refresh();
});
window.Launcher.detail.init();
window.Launcher.newInstall.init();
window.Launcher.settings.init();
window.Launcher.track.init();
window.Launcher.updateBanner.init();
window.Launcher.sessions.init();
window.Launcher.initRunningInstances();

// Sidebar navigation
document.querySelectorAll(".sidebar-item").forEach((btn) => {
  btn.onclick = () => {
    const view = btn.dataset.sidebar;
    if (view === "settings") {
      window.Launcher.settings.show();
    } else if (view === "models") {
      window.Launcher.models.show();
    } else if (view === "running") {
      window.Launcher.running.show();
    } else if (view === "list") {
      window.Launcher.showView("list");
      window.Launcher.list.render();
    } else {
      window.Launcher.showView(view);
    }
  };
});

// Quit confirmation from main process
window.api.onConfirmQuit(async () => {
  const confirmed = await window.Launcher.modal.confirm({
    title: window.t("settings.closeQuitTitle"),
    message: window.t("settings.closeQuitMessage"),
    confirmLabel: window.t("settings.closeQuitConfirm"),
    confirmStyle: "danger",
  });
  if (confirmed) window.api.quitApp();
});

// View modal close buttons
document.querySelectorAll(".view-modal-close").forEach((btn) => {
  btn.onclick = () => window.Launcher.closeViewModal(btn.dataset.modal);
});

// Filter tabs
document.querySelectorAll("#list-filter-tabs .filter-tab").forEach((btn) => {
  btn.onclick = () => window.Launcher.list.setFilter(btn.dataset.filter);
});

// Wait for i18n before first render to avoid showing raw keys
window.api.getLocaleMessages().then((msgs) => {
  window.Launcher.i18n.init(msgs);
  window.Launcher.list.render();
});
