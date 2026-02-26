import { ref } from 'vue'
import { useInstallationStore } from '../stores/installationStore'

// Module-level shared state so all components see the same values
const primaryInstallId = ref<string | null>(null)
const pinnedInstallIds = ref<string[]>([])
const loaded = ref(false)
let loadPromise: Promise<void> | null = null

export function useLauncherPrefs() {
  const installationStore = useInstallationStore()
  async function loadPrefs(): Promise<void> {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const [primary, pinned] = await Promise.all([
        window.api.getSetting('primaryInstallId') as Promise<string | null>,
        window.api.getSetting('pinnedInstallIds') as Promise<string[] | null>,
      ])
      primaryInstallId.value = primary ?? null
      pinnedInstallIds.value = Array.isArray(pinned) ? pinned : []
      loaded.value = true
    })()
    return loadPromise
  }

  async function setPrimary(id: string): Promise<void> {
    primaryInstallId.value = id
    await window.api.runAction(id, 'set-primary-install')
  }

  async function pinInstall(id: string): Promise<void> {
    if (!pinnedInstallIds.value.includes(id)) {
      pinnedInstallIds.value = [...pinnedInstallIds.value, id]
    }
    await window.api.runAction(id, 'pin-install')
  }

  async function unpinInstall(id: string): Promise<void> {
    pinnedInstallIds.value = pinnedInstallIds.value.filter((i) => i !== id)
    await window.api.runAction(id, 'unpin-install')
  }

  function isPinned(id: string): boolean {
    return pinnedInstallIds.value.includes(id)
  }

  function effectivePrimaryId(): string | null {
    if (primaryInstallId.value) return primaryInstallId.value
    const firstLocal = installationStore.installations.find((i) => i.sourceCategory === 'local')
    return firstLocal?.id ?? null
  }

  function isPrimary(id: string): boolean {
    return effectivePrimaryId() === id
  }

  return {
    primaryInstallId,
    pinnedInstallIds,
    loaded,
    loadPrefs,
    setPrimary,
    pinInstall,
    unpinInstall,
    isPinned,
    isPrimary,
  }
}
