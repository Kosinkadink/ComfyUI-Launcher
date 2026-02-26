<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useInstallationStore } from '../stores/installationStore'
import { useSessionStore } from '../stores/sessionStore'
import { useProgressStore } from '../stores/progressStore'
import { useModal } from '../composables/useModal'
import { useLocalInstanceGuard } from '../composables/useLocalInstanceGuard'
import { Play, Download, ExternalLink, Square, Star, Clock, Cloud } from 'lucide-vue-next'
import type { Installation, ListAction } from '../types/ipc'

const props = defineProps<{
  visible: boolean
}>()

const { t } = useI18n()
const installationStore = useInstallationStore()
const sessionStore = useSessionStore()
const progressStore = useProgressStore()
const modal = useModal()
const localInstanceGuard = useLocalInstanceGuard()

const emit = defineEmits<{
  'show-new-install': []
  'show-detail': [inst: Installation]
  'show-console': [installationId: string]
  'show-progress': [opts: {
    installationId: string
    title: string
    apiCall: () => Promise<unknown>
    cancellable?: boolean
  }]
  'show-list': []
}>()

// --- Primary install ---
const primaryInstallId = ref<string | null>(null)

onMounted(async () => {
  const stored = await window.api.getSetting('primaryInstallId') as string | null
  if (stored) primaryInstallId.value = stored
})

const localInstalls = computed(() =>
  installationStore.installations.filter((i) => i.sourceCategory === 'local')
)

const primaryInstall = computed(() => {
  if (primaryInstallId.value) {
    const found = localInstalls.value.find((i) => i.id === primaryInstallId.value)
    if (found) return found
  }
  return localInstalls.value[0] ?? null
})

// --- Latest install ---
const latestInstall = computed(() => {
  const withTimestamp = installationStore.installations.filter(
    (i) => i.sourceCategory !== 'cloud' && typeof i.lastLaunchedAt === 'number'
  )
  if (withTimestamp.length === 0) return null
  return withTimestamp.reduce((a, b) =>
    (a.lastLaunchedAt as number) > (b.lastLaunchedAt as number) ? a : b
  )
})

const showLatestCard = computed(() =>
  latestInstall.value && latestInstall.value.id !== primaryInstall.value?.id
)

// --- Cloud install ---
const cloudInstall = computed(() =>
  installationStore.installations.find((i) => i.sourceCategory === 'cloud') ?? null
)

// --- Non-cloud installs for summary ---
const nonCloudInstalls = computed(() =>
  installationStore.installations.filter((i) => i.sourceCategory !== 'cloud')
)

// --- Actions for cards ---
const primaryActions = ref<ListAction[]>([])
const latestActions = ref<ListAction[]>([])
const cloudActions = ref<ListAction[]>([])

let actionGeneration = 0

watch(
  [
    () => primaryInstall.value?.id,
    () => props.visible,
    () => sessionStore.runningInstances.size,
    () => sessionStore.activeSessions.size,
    () => sessionStore.errorInstances.size,
  ],
  async () => {
    const gen = ++actionGeneration
    const id = primaryInstall.value?.id
    if (!id || !props.visible) { primaryActions.value = []; return }
    if (
      !sessionStore.isRunning(id) &&
      !sessionStore.activeSessions.has(id) &&
      !sessionStore.errorInstances.has(id)
    ) {
      const actions = await window.api.getListActions(id)
      if (gen === actionGeneration) primaryActions.value = actions
    } else {
      primaryActions.value = []
    }
  },
  { immediate: true }
)

watch(
  [
    () => latestInstall.value?.id,
    () => props.visible,
    () => sessionStore.runningInstances.size,
    () => sessionStore.activeSessions.size,
    () => sessionStore.errorInstances.size,
  ],
  async () => {
    const gen = ++actionGeneration
    const id = latestInstall.value?.id
    if (!id || !props.visible || id === primaryInstall.value?.id) { latestActions.value = []; return }
    if (
      !sessionStore.isRunning(id) &&
      !sessionStore.activeSessions.has(id) &&
      !sessionStore.errorInstances.has(id)
    ) {
      const actions = await window.api.getListActions(id)
      if (gen === actionGeneration) latestActions.value = actions
    } else {
      latestActions.value = []
    }
  },
  { immediate: true }
)

watch(
  [
    () => cloudInstall.value?.id,
    () => props.visible,
    () => sessionStore.runningInstances.size,
    () => sessionStore.activeSessions.size,
  ],
  async () => {
    const gen = ++actionGeneration
    const id = cloudInstall.value?.id
    if (!id || !props.visible) { cloudActions.value = []; return }
    if (
      !sessionStore.isRunning(id) &&
      !sessionStore.activeSessions.has(id)
    ) {
      const actions = await window.api.getListActions(id)
      if (gen === actionGeneration) cloudActions.value = actions
    } else {
      cloudActions.value = []
    }
  },
  { immediate: true }
)

function getLaunchAction(actions: ListAction[]): ListAction | null {
  return actions.find((a) => a.style === 'primary') ?? actions[0] ?? null
}

function getProgress(installId: string) {
  return progressStore.getProgressInfo(installId)
}

function getRunning(installId: string) {
  return sessionStore.runningInstances.get(installId) ?? null
}

// --- Relative time (reactive) ---
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  nowTimer = setInterval(() => { now.value = Date.now() }, 60_000)
})
onBeforeUnmount(() => {
  if (nowTimer) clearInterval(nowTimer)
})

function timeAgo(timestamp: number): string {
  const diff = now.value - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// --- Launch handling ---
async function handleLaunch(inst: Installation, actions: ListAction[]): Promise<void> {
  const action = getLaunchAction(actions)
  if (!inst || !action) return

  if (action.enabled === false && action.disabledMessage) {
    await modal.alert({ title: action.label, message: action.disabledMessage })
    return
  }

  if (action.confirm) {
    const confirmed = await modal.confirm({
      title: action.confirm.title || 'Confirm',
      message: action.confirm.message || 'Are you sure?',
      confirmLabel: action.label,
      confirmStyle: action.style || 'danger',
    })
    if (!confirmed) return
  }

  if (action.id === 'launch') {
    const canLaunch = await localInstanceGuard.checkBeforeLaunch(inst.id)
    if (!canLaunch) return
  }

  if (action.showProgress) {
    emit('show-progress', {
      installationId: inst.id,
      title: `${action.progressTitle || action.label} — ${inst.name}`,
      apiCall: () => window.api.runAction(inst.id, action.id),
      cancellable: !!action.cancellable,
    })
    return
  }

  const result = await window.api.runAction(inst.id, action.id)
  if (result.message) {
    await modal.alert({ title: action.label, message: result.message })
  }
}

function focusComfyWindow(installationId: string): void {
  window.api.focusComfyWindow(installationId)
}

function stopComfyUI(installationId: string): void {
  window.api.stopComfyUI(installationId)
}

// --- Change primary ---
async function changePrimary(): Promise<void> {
  const items = localInstalls.value.map((i) => ({
    value: i.id,
    label: i.name,
    description: [i.sourceLabel, i.version].filter(Boolean).join(' · '),
  }))
  if (items.length === 0) return
  const selected = await modal.select({
    title: t('dashboard.setPrimary'),
    items,
  })
  if (selected) {
    primaryInstallId.value = selected
    await window.api.runAction(selected, 'set-primary-install')
  }
}
</script>

<template>
  <div class="view active">
    <div class="view-scroll">
      <!-- Welcome state: no local installations -->
      <div v-if="!primaryInstall" class="dashboard-welcome">
        <div class="dashboard-welcome-icon">
          <Download :size="48" />
        </div>
        <h1 class="dashboard-welcome-title">{{ $t('dashboard.welcome') }}</h1>
        <p class="dashboard-welcome-desc">{{ $t('dashboard.welcomeDesc') }}</p>
        <button class="primary dashboard-cta-btn" @click="emit('show-new-install')">
          <Download :size="18" />
          {{ $t('dashboard.installComfyUI') }}
        </button>
      </div>

      <!-- Quick Launch section -->
      <div v-if="primaryInstall" class="dashboard-section">
        <div class="dashboard-section-label">{{ $t('dashboard.quickLaunch') }}</div>
        <div class="dashboard-quick-launch">
          <!-- Latest card (only when different from primary and has been launched) -->
          <div v-if="showLatestCard && latestInstall" class="dashboard-card">
            <div class="dashboard-card-badge">
              <Clock :size="14" />
              {{ $t('dashboard.latest') }}
            </div>
            <div class="dashboard-card-info">
              <div class="dashboard-card-name">{{ latestInstall.name }}</div>
              <div class="dashboard-card-meta">
                <span>{{ latestInstall.sourceLabel }}</span>
                <template v-if="latestInstall.version">
                  <span> · </span>
                  <span>{{ latestInstall.version }}</span>
                </template>
                <template v-if="getRunning(latestInstall.id)">
                  <span> · </span>
                  <span class="status-running">{{ $t('list.running') }}</span>
                </template>
              </div>
              <div v-if="typeof latestInstall.lastLaunchedAt === 'number'" class="dashboard-card-detail">
                {{ $t('dashboard.launchedAgo', { time: timeAgo(latestInstall.lastLaunchedAt as number) }) }}
              </div>

              <div v-if="getProgress(latestInstall.id)" class="card-progress">
                <div class="card-progress-status">{{ getProgress(latestInstall.id)!.status }}</div>
                <div class="card-progress-track">
                  <div
                    class="card-progress-fill"
                    :class="{ indeterminate: getProgress(latestInstall.id)!.percent < 0 }"
                    :style="getProgress(latestInstall.id)!.percent >= 0 ? { width: getProgress(latestInstall.id)!.percent + '%' } : { width: '100%' }"
                  ></div>
                </div>
              </div>
            </div>

            <div class="dashboard-card-actions">
              <!-- Running -->
              <template v-if="getRunning(latestInstall.id)">
                <button
                  v-if="getRunning(latestInstall.id)?.mode !== 'console'"
                  class="primary dashboard-cta-btn"
                  @click="focusComfyWindow(latestInstall.id)"
                >
                  <ExternalLink :size="18" />
                  {{ $t('running.showWindow') }}
                </button>
                <button v-if="latestInstall.hasConsole" @click="emit('show-console', latestInstall.id)">
                  {{ $t('list.console') }}
                </button>
                <button class="danger" @click="stopComfyUI(latestInstall.id)">
                  <Square :size="16" />
                  {{ $t('console.stop') }}
                </button>
              </template>

              <!-- In-progress -->
              <template v-else-if="sessionStore.activeSessions.has(latestInstall.id)">
                <button
                  class="primary dashboard-cta-btn"
                  @click="emit('show-progress', {
                    installationId: latestInstall.id,
                    title: '',
                    apiCall: async () => ({}),
                  })"
                >
                  {{ $t('list.viewProgress') }}
                </button>
              </template>

              <!-- Idle -->
              <template v-else-if="latestInstall.status === 'installed'">
                <button
                  v-if="getLaunchAction(latestActions)"
                  class="primary dashboard-cta-btn"
                  :class="{ 'looks-disabled': getLaunchAction(latestActions)!.enabled === false && getLaunchAction(latestActions)!.disabledMessage }"
                  :disabled="getLaunchAction(latestActions)!.enabled === false && !getLaunchAction(latestActions)!.disabledMessage"
                  @click="handleLaunch(latestInstall, latestActions)"
                >
                  <Play :size="18" />
                  {{ getLaunchAction(latestActions)!.label }}
                </button>
              </template>

              <button @click="emit('show-detail', latestInstall)">
                {{ $t('list.view') }}
              </button>
            </div>
          </div>

          <!-- Primary card -->
          <div class="dashboard-card">
            <div class="dashboard-card-badge dashboard-card-badge-primary">
              <Star :size="14" />
              {{ $t('dashboard.primary') }}
              <button class="dashboard-change-btn" @click="changePrimary">{{ $t('dashboard.changePrimary') }}</button>
            </div>
            <div class="dashboard-card-info">
              <div class="dashboard-card-name">{{ primaryInstall.name }}</div>
              <div class="dashboard-card-meta">
                <span>{{ primaryInstall.sourceLabel }}</span>
                <template v-if="primaryInstall.version">
                  <span> · </span>
                  <span>{{ primaryInstall.version }}</span>
                </template>
                <template v-if="getRunning(primaryInstall.id)">
                  <span> · </span>
                  <span class="status-running">{{ $t('list.running') }}</span>
                </template>
              </div>
              <div v-if="typeof primaryInstall.lastLaunchedAt === 'number'" class="dashboard-card-detail">
                {{ $t('dashboard.launchedAgo', { time: timeAgo(primaryInstall.lastLaunchedAt as number) }) }}
              </div>
              <div v-else class="dashboard-card-detail">
                {{ $t('dashboard.neverLaunched') }}
              </div>

              <div v-if="getProgress(primaryInstall.id)" class="card-progress">
                <div class="card-progress-status">{{ getProgress(primaryInstall.id)!.status }}</div>
                <div class="card-progress-track">
                  <div
                    class="card-progress-fill"
                    :class="{ indeterminate: getProgress(primaryInstall.id)!.percent < 0 }"
                    :style="getProgress(primaryInstall.id)!.percent >= 0 ? { width: getProgress(primaryInstall.id)!.percent + '%' } : { width: '100%' }"
                  ></div>
                </div>
              </div>
            </div>

            <div class="dashboard-card-actions">
              <!-- Running -->
              <template v-if="getRunning(primaryInstall.id)">
                <button
                  v-if="getRunning(primaryInstall.id)?.mode !== 'console'"
                  class="primary dashboard-cta-btn"
                  @click="focusComfyWindow(primaryInstall.id)"
                >
                  <ExternalLink :size="18" />
                  {{ $t('running.showWindow') }}
                </button>
                <button v-if="primaryInstall.hasConsole" @click="emit('show-console', primaryInstall.id)">
                  {{ $t('list.console') }}
                </button>
                <button class="danger" @click="stopComfyUI(primaryInstall.id)">
                  <Square :size="16" />
                  {{ $t('console.stop') }}
                </button>
              </template>

              <!-- In-progress -->
              <template v-else-if="sessionStore.activeSessions.has(primaryInstall.id)">
                <button
                  class="primary dashboard-cta-btn"
                  @click="emit('show-progress', {
                    installationId: primaryInstall.id,
                    title: '',
                    apiCall: async () => ({}),
                  })"
                >
                  {{ $t('list.viewProgress') }}
                </button>
              </template>

              <!-- Idle -->
              <template v-else-if="primaryInstall.status === 'installed'">
                <button
                  v-if="getLaunchAction(primaryActions)"
                  class="primary dashboard-cta-btn"
                  :class="{ 'looks-disabled': getLaunchAction(primaryActions)!.enabled === false && getLaunchAction(primaryActions)!.disabledMessage }"
                  :disabled="getLaunchAction(primaryActions)!.enabled === false && !getLaunchAction(primaryActions)!.disabledMessage"
                  @click="handleLaunch(primaryInstall, primaryActions)"
                >
                  <Play :size="18" />
                  {{ getLaunchAction(primaryActions)!.label }}
                </button>
              </template>

              <button @click="emit('show-detail', primaryInstall)">
                {{ $t('list.view') }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Cloud section -->
      <div v-if="cloudInstall" class="dashboard-section">
        <div class="dashboard-section-label">
          <Cloud :size="14" style="vertical-align: -2px; margin-right: 4px;" />
          {{ $t('dashboard.cloudSection') }}
        </div>
        <div class="dashboard-cloud-card">
          <div class="dashboard-card-info">
            <div class="dashboard-card-name">{{ cloudInstall.name }}</div>
            <div class="dashboard-card-meta">
              <span>{{ cloudInstall.listPreview || cloudInstall.sourceLabel }}</span>
              <template v-if="getRunning(cloudInstall.id)">
                <span> · </span>
                <span class="status-running">{{ $t('list.running') }}</span>
              </template>
            </div>
          </div>

          <div class="dashboard-card-actions">
            <template v-if="getRunning(cloudInstall.id)">
              <button
                v-if="getRunning(cloudInstall.id)?.mode !== 'console'"
                class="primary dashboard-cta-btn"
                @click="focusComfyWindow(cloudInstall.id)"
              >
                <ExternalLink :size="18" />
                {{ $t('running.showWindow') }}
              </button>
              <button class="danger" @click="stopComfyUI(cloudInstall.id)">
                <Square :size="16" />
                {{ $t('console.stop') }}
              </button>
            </template>

            <template v-else-if="sessionStore.activeSessions.has(cloudInstall.id)">
              <button
                class="primary dashboard-cta-btn"
                @click="emit('show-progress', {
                  installationId: cloudInstall.id,
                  title: '',
                  apiCall: async () => ({}),
                })"
              >
                {{ $t('list.viewProgress') }}
              </button>
            </template>

            <template v-else-if="cloudInstall.status === 'installed'">
              <button
                v-if="getLaunchAction(cloudActions)"
                class="primary dashboard-cta-btn"
                @click="handleLaunch(cloudInstall, cloudActions)"
              >
                <Play :size="18" />
                {{ getLaunchAction(cloudActions)!.label }}
              </button>
            </template>

            <button @click="emit('show-detail', cloudInstall)">
              {{ $t('list.view') }}
            </button>
          </div>
        </div>
      </div>

      <!-- All Installs summary -->
      <div v-if="nonCloudInstalls.length > 0" class="dashboard-section">
        <div class="dashboard-section-label">{{ $t('dashboard.allInstalls') }}</div>
        <div class="dashboard-summary-card">
          <div class="dashboard-summary-info">
            <span class="dashboard-summary-count">{{ nonCloudInstalls.length }}</span>
            <span class="dashboard-summary-text">{{ $t('dashboard.installCount', nonCloudInstalls.length) }}</span>
          </div>
          <button @click="emit('show-list')">{{ $t('dashboard.viewAllInstalls') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
