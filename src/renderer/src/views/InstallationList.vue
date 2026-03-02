<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSessionStore } from '../stores/sessionStore'
import { useInstallationStore } from '../stores/installationStore'
import { useModal } from '../composables/useModal'
import { useLocalInstanceGuard } from '../composables/useLocalInstanceGuard'
import { useInstallContextMenu } from '../composables/useInstallContextMenu'
import { useProgressStore } from '../stores/progressStore'
import { DraggableList } from '../lib/draggableList'
import InstanceCard from '../components/InstanceCard.vue'
import ContextMenu from '../components/ContextMenu.vue'
import type { Installation, ListAction, SnapshotFilePreview } from '../types/ipc'

const { t } = useI18n()
const sessionStore = useSessionStore()
const installationStore = useInstallationStore()
const progressStore = useProgressStore()
const modal = useModal()
const localInstanceGuard = useLocalInstanceGuard()

const filter = ref('all')
const listActions = ref(new Map<string, ListAction[]>())

const cardProgress = computed(() => {
  const map = new Map<string, { status: string; percent: number }>()
  for (const inst of installationStore.installations) {
    const info = progressStore.getProgressInfo(inst.id)
    if (info) map.set(inst.id, info)
  }
  return map
})

const filteredInstallations = computed(() => {
  if (filter.value === 'all') return installationStore.installations
  return installationStore.installations.filter((i) => i.sourceCategory === filter.value)
})

const hasLocal = computed(() =>
  installationStore.installations.some((i) => i.sourceCategory === 'local')
)

async function refresh(): Promise<void> {
  await installationStore.fetchInstallations()
  for (const inst of installationStore.installations) {
    if (
      !sessionStore.isRunning(inst.id) &&
      !sessionStore.activeSessions.has(inst.id)
    ) {
      const actions = await window.api.getListActions(inst.id)
      listActions.value.set(inst.id, actions)
    }
  }
}

onMounted(() => refresh())

watch(
  [
    () => sessionStore.runningInstances.size,
    () => sessionStore.activeSessions.size,
    () => sessionStore.errorInstances.size,
  ],
  () => refresh()
)

function setFilter(f: string): void {
  filter.value = f
}

interface MetaPart {
  text: string
  class?: string
  wrapClass?: string
}

function getMetaParts(inst: Installation): MetaPart[] {
  const parts: MetaPart[] = [{ text: inst.sourceLabel }]
  if (inst.version) parts.push({ text: inst.version })
  if (sessionStore.isRunning(inst.id)) {
    parts.push({ text: t('list.running'), class: 'status-running' })
  } else if (sessionStore.errorInstances.has(inst.id)) {
    parts.push({ text: t('running.crashed'), class: 'status-danger' })
  }
  const activeSession = sessionStore.activeSessions.get(inst.id)
  if (!sessionStore.isRunning(inst.id) && activeSession) {
    parts.push({ text: activeSession.label, class: 'status-in-progress' })
  }
  if (inst.statusTag) {
    parts.push({ text: inst.statusTag.label, class: `status-${inst.statusTag.style}` })
  }
  if (inst.seen === false) {
    parts.push({ text: t('list.new'), class: 'status-new', wrapClass: 'status-new-wrap' })
  }
  return parts
}

function getLaunchMeta(inst: Installation): string {
  if (inst.listPreview) return inst.listPreview
  if (inst.launchMode) {
    return inst.launchMode + (inst.launchArgs ? ' · ' + inst.launchArgs : '')
  }
  return ''
}

async function handleListAction(inst: Installation, action: ListAction): Promise<void> {
  if (action.enabled === false && action.disabledMessage) {
    await modal.alert({ title: action.label, message: action.disabledMessage })
    return
  }
  if (inst.seen === false) {
    inst.seen = true
    window.api.updateInstallation(inst.id, { seen: true })
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
  if (result.navigate === 'list') {
    await refresh()
  } else if (result.message) {
    await modal.alert({ title: action.label, message: result.message })
  }
}

// --- Drag-to-reorder ---
const listContainerRef = useTemplateRef<HTMLElement>('listContainer')
let draggableList: DraggableList | null = null

function initDraggable(): void {
  draggableList?.dispose()
  draggableList = null
  if (!listContainerRef.value) return
  draggableList = new DraggableList(
    listContainerRef.value,
    '.instance-card',
    { onReorder: handleReorder }
  )
}

async function handleReorder(oldIndex: number, newIndex: number): Promise<void> {
  const visible = filteredInstallations.value
  const movedId = visible[oldIndex]?.id
  const targetId = visible[newIndex]?.id
  if (!movedId || !targetId || movedId === targetId) return
  const ids = installationStore.installations.map((i) => i.id)
  const fromIdx = ids.indexOf(movedId)
  const toIdx = ids.indexOf(targetId)
  if (fromIdx === -1 || toIdx === -1) return
  const moved = ids.splice(fromIdx, 1)[0]
  if (moved) ids.splice(toIdx, 0, moved)
  // Optimistically reorder the store so Vue re-renders before next paint
  const byId = new Map(installationStore.installations.map((i) => [i.id, i]))
  installationStore.installations = ids.map((id) => byId.get(id)!).filter(Boolean)
  await window.api.reorderInstallations(ids)
  refresh()
}

watch(
  () => filteredInstallations.value.map((i) => i.id).join('|'),
  () => initDraggable(),
  { flush: 'post' }
)

onMounted(() => initDraggable())
onBeforeUnmount(() => draggableList?.dispose())

function markSeen(inst: Installation): void {
  if (inst.seen === false) {
    inst.seen = true
    window.api.updateInstallation(inst.id, { seen: true })
  }
}

function focusComfyWindow(installationId: string): void {
  window.api.focusComfyWindow(installationId)
}

function stopComfyUI(installationId: string): void {
  window.api.stopComfyUI(installationId)
}

const filterKeys = ['all', 'local', 'remote', 'cloud'] as const

function filterLabel(f: string): string {
  return t(`list.filter${f.charAt(0).toUpperCase() + f.slice(1)}`)
}

const filterStats = computed(() => {
  const stats: Record<string, { count: number; hasNew: boolean }> = {}
  for (const f of filterKeys) {
    const list = f === 'all'
      ? installationStore.installations
      : installationStore.installations.filter((i) => i.sourceCategory === f)
    stats[f] = { count: list.length, hasNew: list.some((i) => i.seen === false) }
  }
  return stats
})

const emit = defineEmits<{
  'show-detail': [inst: Installation]
  'show-console': [installationId: string]
  'show-progress': [opts: {
    installationId: string
    title: string
    apiCall: () => Promise<unknown>
    cancellable?: boolean
  }]
  'show-new-install': []
  'show-track': []
}>()

const snapshotPreview = ref<SnapshotFilePreview | null>(null)
const snapshotNodesExpanded = ref(true)

async function handleNewFromSnapshot(): Promise<void> {
  const result = await window.api.previewSnapshotFile()
  if (!result.ok) {
    if (result.message) {
      await modal.alert({ title: t('list.newFromSnapshot'), message: result.message })
    }
    return
  }
  if (result.preview) {
    snapshotPreview.value = result.preview
    snapshotNodesExpanded.value = true
  }
}

function cancelSnapshotPreview(): void {
  snapshotPreview.value = null
}

async function confirmCreateFromSnapshot(): Promise<void> {
  if (!snapshotPreview.value) return
  const filePath = snapshotPreview.value.filePath
  snapshotPreview.value = null

  const result = await window.api.createFromSnapshot(filePath)
  if (!result.ok) {
    if (result.message) {
      await modal.alert({ title: t('list.newFromSnapshot'), message: result.message })
    }
    return
  }
  if (result.entry) {
    emit('show-progress', {
      installationId: result.entry.id,
      title: `${t('newInstall.installing')} — ${result.entry.name}`,
      apiCall: () => window.api.installInstance(result.entry!.id),
      cancellable: true,
    })
  }
}

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case 'boot': return t('snapshots.triggerBoot')
    case 'restart': return t('snapshots.triggerRestart')
    case 'manual': return t('snapshots.triggerManual')
    case 'pre-update': return t('snapshots.triggerPreUpdate')
    case 'post-update': return t('snapshots.triggerPostUpdate')
    case 'post-restore': return t('snapshots.triggerPostRestore')
    default: return trigger
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function formatNodeVersion(node: { version?: string; commit?: string }): string {
  if (node.version) return node.version
  if (node.commit) return node.commit.slice(0, 7)
  return '—'
}

// --- Context menu ---
const { ctxMenu, ctxMenuItems, openCardMenu, handleCtxMenuSelect, closeMenu } =
  useInstallContextMenu((inst) => emit('show-detail', inst))

defineExpose({ refresh })
</script>

<template>
  <div class="view active">
    <div class="toolbar">
      <div class="breadcrumb">
        <span class="breadcrumb-current">{{ $t('list.title') }}</span>
      </div>
      <div class="toolbar-actions">
        <button @click="emit('show-track')">{{ $t('list.trackExisting') }}</button>
        <button @click="handleNewFromSnapshot">{{ $t('list.newFromSnapshot') }}</button>
        <button class="primary add-btn" @click="emit('show-new-install')">
          + {{ $t('list.newInstall') }}
        </button>
      </div>
    </div>

    <div class="filter-tabs">
      <button
        v-for="f in filterKeys"
        :key="f"
        class="filter-tab"
        :class="{ active: filter === f }"
        @click="setFilter(f)"
      >
        {{ filterLabel(f) }}<span v-if="filterStats[f]?.count" class="filter-count" :class="{ 'has-new': filterStats[f]?.hasNew }">{{ filterStats[f]?.count }}</span>
      </button>
    </div>

    <div class="view-list-scroll">
      <div ref="listContainer" class="instance-list">
        <!-- Empty: has local but filtered out -->
        <div v-if="filteredInstallations.length === 0 && hasLocal" class="empty-state">
          {{ $t('list.emptyFilter') }}
        </div>

        <!-- Empty: no installations at all -->
        <div v-else-if="filteredInstallations.length === 0" class="empty-state">
          <div style="font-weight: 700; color: var(--text-muted)">{{ $t('list.empty') }}</div>
          <div style="margin-top: 4px">{{ $t('list.emptyHint') }}</div>
          <button class="accent add-btn" style="margin-top: 8px" @click="emit('show-new-install')">
            + {{ $t('list.newInstall') }}
          </button>
        </div>

        <!-- Installation cards -->
        <InstanceCard
          v-for="inst in filteredInstallations"
          :key="inst.id"
          :installation-id="inst.id"
          :name="inst.name"
          :source-category="inst.sourceCategory"
          :draggable="true"
          @mousedown="markSeen(inst)"
          @contextmenu.prevent="openCardMenu($event, inst)"
        >
          <template #meta>
            <template v-for="(part, i) in getMetaParts(inst)" :key="i">
              <template v-if="i > 0"> · </template>
              <span v-if="part.wrapClass" :class="part.wrapClass"><span :class="part.class">{{ part.text }}</span></span>
              <span v-else-if="part.class" :class="part.class">{{ part.text }}</span>
              <template v-else>{{ part.text }}</template>
            </template>
          </template>

          <template #extra-info>
            <div v-if="getLaunchMeta(inst)" class="instance-meta">{{ getLaunchMeta(inst) }}</div>
            <div
              v-if="cardProgress.get(inst.id)"
              class="card-progress"
            >
              <div class="card-progress-status">{{ cardProgress.get(inst.id)!.status }}</div>
              <div class="card-progress-track">
                <div
                  class="card-progress-fill"
                  :class="{ indeterminate: cardProgress.get(inst.id)!.percent < 0 }"
                  :style="cardProgress.get(inst.id)!.percent >= 0
                    ? { width: cardProgress.get(inst.id)!.percent + '%' }
                    : { width: '100%' }"
                ></div>
              </div>
            </div>
          </template>

          <template #actions>
            <!-- In-progress -->
            <template v-if="sessionStore.activeSessions.has(inst.id) && !sessionStore.isRunning(inst.id)">
              <button
                class="primary"
                @click="emit('show-progress', {
                  installationId: inst.id,
                  title: '',
                  apiCall: async () => ({}),
                })"
              >
                {{ $t('list.viewProgress') }}
              </button>
            </template>

            <!-- Running -->
            <template v-else-if="sessionStore.isRunning(inst.id)">
              <button
                v-if="sessionStore.runningInstances.get(inst.id)?.mode !== 'console'"
                class="primary"
                @click="focusComfyWindow(inst.id)"
              >
                {{ $t('running.showWindow') }}
              </button>
              <button v-if="inst.hasConsole" @click="emit('show-console', inst.id)">
                {{ $t('list.console') }}
              </button>
              <button class="danger" @click="stopComfyUI(inst.id)">
                {{ $t('console.stop') }}
              </button>
            </template>

            <!-- Idle / Error: list actions -->
            <template v-else>
              <button
                v-for="a in (listActions.get(inst.id) || [])"
                :key="a.id"
                :class="[a.style, { 'looks-disabled': a.enabled === false && a.disabledMessage }]"
                :disabled="a.enabled === false && !a.disabledMessage"
                @click="handleListAction(inst, a)"
              >
                {{ a.label }}
              </button>
              <button v-if="sessionStore.errorInstances.has(inst.id) && inst.hasConsole" @click="emit('show-console', inst.id)">
                {{ $t('list.viewError') }}
              </button>
            </template>

            <button class="manage-btn" @click="emit('show-detail', inst)">
              {{ $t('list.view') }}
            </button>
          </template>
        </InstanceCard>

        <!-- Prompt to install when no local installations exist -->
        <div
          v-if="filteredInstallations.length > 0 && !hasLocal && (filter === 'all' || filter === 'local')"
          class="empty-state"
        >
          <div style="font-weight: 700; color: var(--text-muted)">{{ $t('list.empty') }}</div>
          <div style="margin-top: 4px">{{ $t('list.emptyHint') }}</div>
          <button class="accent add-btn" style="margin-top: 8px" @click="emit('show-new-install')">
            + {{ $t('list.newInstall') }}
          </button>
        </div>
      </div>
    </div>

    <slot name="update-banner" />

    <!-- Snapshot preview overlay -->
    <Teleport to="body">
    <div v-if="snapshotPreview" class="snapshot-preview-overlay" @click.self="cancelSnapshotPreview">
      <div class="snapshot-preview-panel">
        <div class="snapshot-preview-header">
          <div class="snapshot-preview-title">{{ $t('list.newFromSnapshot') }}</div>
          <button class="snapshot-preview-close" @click="cancelSnapshotPreview">✕</button>
        </div>

        <div class="snapshot-preview-body">
          <!-- Source info -->
          <div class="sp-section">
            <div class="sp-field">
              <span class="sp-label">{{ $t('list.snapshotSourceName') }}</span>
              <span class="sp-value">{{ snapshotPreview.installationName }}</span>
            </div>
            <div class="sp-field">
              <span class="sp-label">{{ $t('list.snapshotCount') }}</span>
              <span class="sp-value">{{ snapshotPreview.snapshotCount }}</span>
            </div>
          </div>

          <!-- Snapshot timeline -->
          <div class="sp-section">
            <div class="sp-section-title">{{ $t('list.snapshotTimeline') }}</div>
            <div class="sp-timeline">
              <div
                v-for="(snap, i) in snapshotPreview.snapshots"
                :key="snap.filename"
                class="sp-timeline-item"
              >
                <span class="sp-trigger" :class="'sp-trigger-' + snap.trigger">{{ triggerLabel(snap.trigger) }}</span>
                <span v-if="i === 0" class="sp-current-tag">{{ $t('snapshots.current') }}</span>
                <span class="sp-meta">{{ snap.comfyuiVersion }} · {{ $t('snapshots.nodesCount', { count: snap.nodeCount }) }} · {{ $t('snapshots.packagesCount', { count: snap.pipPackageCount }) }}</span>
                <span class="sp-time">{{ formatDate(snap.createdAt) }}</span>
              </div>
            </div>
          </div>

          <!-- Newest snapshot detail -->
          <div class="sp-section">
            <div class="sp-section-title">{{ $t('list.snapshotNewestDetail') }}</div>

            <!-- Environment -->
            <div class="sp-grid">
              <div class="sp-field">
                <span class="sp-label">{{ $t('snapshots.comfyuiVersion') }}</span>
                <span class="sp-value">{{ snapshotPreview.newestSnapshot.comfyui.displayVersion || snapshotPreview.newestSnapshot.comfyui.ref }}</span>
              </div>
              <div class="sp-field">
                <span class="sp-label">{{ $t('snapshots.variant') }}</span>
                <span class="sp-value">{{ snapshotPreview.newestSnapshot.comfyui.variant || '—' }}</span>
              </div>
              <div class="sp-field">
                <span class="sp-label">{{ $t('snapshots.pythonVersion') }}</span>
                <span class="sp-value">{{ snapshotPreview.newestSnapshot.pythonVersion || '—' }}</span>
              </div>
              <div class="sp-field">
                <span class="sp-label">{{ $t('snapshots.capturedAt') }}</span>
                <span class="sp-value">{{ formatDate(snapshotPreview.newestSnapshot.createdAt) }}</span>
              </div>
            </div>

            <!-- Custom nodes -->
            <div class="sp-subsection">
              <div class="sp-subsection-title" @click="snapshotNodesExpanded = !snapshotNodesExpanded">
                <span>{{ $t('snapshots.customNodes') }} ({{ snapshotPreview.newestSnapshot.customNodes.length }})</span>
                <span class="sp-collapse">{{ snapshotNodesExpanded ? '▾' : '▸' }}</span>
              </div>
              <div v-if="snapshotNodesExpanded && snapshotPreview.newestSnapshot.customNodes.length > 0" class="sp-node-list">
                <div v-for="node in snapshotPreview.newestSnapshot.customNodes" :key="node.id" class="sp-node-row">
                  <span class="sp-node-status" :class="node.enabled ? 'sp-node-enabled' : 'sp-node-disabled'" />
                  <span class="sp-node-name">{{ node.id }}</span>
                  <span class="sp-node-type">{{ node.type }}</span>
                  <span class="sp-node-version">{{ formatNodeVersion(node) }}</span>
                </div>
              </div>
              <div v-else-if="snapshotNodesExpanded" class="sp-empty">—</div>
            </div>

            <!-- Pip packages count -->
            <div class="sp-subsection">
              <div class="sp-subsection-title">
                <span>{{ $t('snapshots.pipPackages') }} ({{ snapshotPreview.newestSnapshot.pipPackageCount }})</span>
              </div>
            </div>
          </div>
        </div>

        <div class="snapshot-preview-actions">
          <button class="sp-cancel" @click="cancelSnapshotPreview">{{ $t('common.cancel') }}</button>
          <button class="sp-confirm" @click="confirmCreateFromSnapshot">{{ $t('list.snapshotCreateInstall') }}</button>
        </div>
      </div>
    </div>
    </Teleport>

    <ContextMenu
      :open="ctxMenu.open"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :items="ctxMenuItems"
      @close="closeMenu"
      @select="handleCtxMenuSelect"
    />
  </div>
</template>

<style scoped>
/* Snapshot preview overlay */
.snapshot-preview-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.snapshot-preview-panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  width: 520px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.snapshot-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.snapshot-preview-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

.snapshot-preview-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 16px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.snapshot-preview-close:hover {
  color: var(--text);
  background: var(--bg);
}

.snapshot-preview-body {
  padding: 14px 16px;
  overflow-y: auto;
  flex: 1;
}

.sp-section {
  margin-bottom: 14px;
}
.sp-section:last-child {
  margin-bottom: 0;
}

.sp-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: 6px;
}

.sp-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  margin-bottom: 8px;
}

.sp-field {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-bottom: 4px;
}

.sp-label {
  font-size: 11px;
  color: var(--text-muted);
}

.sp-value {
  font-size: 13px;
  color: var(--text);
}

/* Timeline */
.sp-timeline {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 160px;
  overflow-y: auto;
}

.sp-timeline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 4px 8px;
  background: var(--bg);
  border-radius: 5px;
}

.sp-trigger {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
  color: var(--text-muted);
  background: var(--surface);
  border: 1px solid var(--border);
}

.sp-trigger-boot { color: var(--info, #58a6ff); border-color: color-mix(in srgb, var(--info, #58a6ff) 40%, var(--border)); }
.sp-trigger-manual { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); }
.sp-trigger-pre-update,
.sp-trigger-post-update { color: var(--warning, #fd9903); border-color: color-mix(in srgb, var(--warning, #fd9903) 40%, var(--border)); }
.sp-trigger-post-restore { color: var(--success, #00cd72); border-color: color-mix(in srgb, var(--success, #00cd72) 40%, var(--border)); }

.sp-current-tag {
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  flex-shrink: 0;
}

.sp-meta {
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-time {
  color: var(--text-muted);
  font-size: 11px;
  flex-shrink: 0;
}

/* Subsections (nodes, packages) */
.sp-subsection {
  margin-top: 8px;
}

.sp-subsection-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  user-select: none;
  margin-bottom: 4px;
}

.sp-collapse {
  font-size: 12px;
}

.sp-node-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}

.sp-node-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  padding: 1px 0;
}

.sp-node-status {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sp-node-enabled { background: var(--info, #58a6ff); }
.sp-node-disabled { background: var(--text-muted); }

.sp-node-name {
  color: var(--text);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sp-node-type {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  padding: 0 4px;
  border: 1px solid var(--border);
  border-radius: 3px;
  flex-shrink: 0;
}

.sp-node-version {
  font-size: 12px;
  color: var(--text-muted);
  font-family: monospace;
  flex-shrink: 0;
}

.sp-empty {
  font-size: 13px;
  color: var(--text-muted);
}

/* Actions */
.snapshot-preview-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.sp-cancel {
  padding: 6px 16px;
  font-size: 13px;
  border-radius: 6px;
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
}
.sp-cancel:hover {
  color: var(--text);
  border-color: var(--border-hover);
}

.sp-confirm {
  padding: 6px 16px;
  font-size: 13px;
  font-weight: 600;
  border-radius: 6px;
  background: var(--accent);
  border: 1px solid var(--accent);
  color: #fff;
  cursor: pointer;
}
.sp-confirm:hover {
  filter: brightness(1.1);
}
</style>
