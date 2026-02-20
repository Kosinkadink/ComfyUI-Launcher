import './i18n.js'
import './util.js'
import './modal.js'
import './list.js'
import './detail.js'
import './new-install.js'
import './progress.js'
import './sessions.js'
import './console.js'
import './settings.js'
import './models.js'
import './track.js'
import './running.js'
import './update-banner.js'

window.api.getResolvedTheme().then((t) => window.Launcher.applyTheme(t))
window.api.onThemeChanged((t) => window.Launcher.applyTheme(t))
window.api.onLocaleChanged((msgs) => {
  window.Launcher.i18n.init(msgs)
  const activeView = document.querySelector('.view.active')
  if (activeView) {
    const id = activeView.id.replace('view-', '')
    if (id === 'list') window.Launcher.list.render()
    else if (id === 'settings') window.Launcher.settings.show()
    else if (id === 'models') window.Launcher.models.show()
    else if (id === 'running') window.Launcher.running.show()
  }
  window.Launcher.updateBanner.refresh()
})
window.Launcher.detail.init()
window.Launcher.newInstall.init()
window.Launcher.settings.init()
window.Launcher.track.init()
window.Launcher.updateBanner.init()
window.Launcher.sessions.init()
window.Launcher.initRunningInstances()

document.querySelectorAll('.sidebar-item').forEach((btn) => {
  btn.onclick = () => {
    const view = btn.dataset.sidebar
    if (view === 'settings') window.Launcher.settings.show()
    else if (view === 'models') window.Launcher.models.show()
    else if (view === 'running') window.Launcher.running.show()
    else if (view === 'list') { window.Launcher.showView('list'); window.Launcher.list.render() }
    else window.Launcher.showView(view)
  }
})

window.api.onConfirmQuit(async () => {
  const confirmed = await window.Launcher.modal.confirm({
    title: window.t('settings.closeQuitTitle'),
    message: window.t('settings.closeQuitMessage'),
    confirmLabel: window.t('settings.closeQuitConfirm'),
    confirmStyle: 'danger',
  })
  if (confirmed) window.api.quitApp()
})

document.querySelectorAll('.view-modal-close').forEach((btn) => {
  btn.onclick = () => window.Launcher.closeViewModal(btn.dataset.modal)
})

document.querySelectorAll('#list-filter-tabs .filter-tab').forEach((btn) => {
  btn.onclick = () => window.Launcher.list.setFilter(btn.dataset.filter)
})

window.api.getLocaleMessages().then((msgs) => {
  window.Launcher.i18n.init(msgs)
  window.Launcher.list.render()
})
