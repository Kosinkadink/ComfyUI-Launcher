<!--
  PoC: SidebarItem.vue — `.sidebar-item` converted to Tailwind utilities + Lucide icon

  BEFORE (index.html lines 52–54, styles.css lines 78–108):

    <button class="sidebar-item active" data-sidebar="list">
      <svg width="18" height="18"><use href="#icon-box"/></svg>
      <span data-i18n="sidebar.installations">Installations</span>
    </button>

    .sidebar-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 12px; border: none; border-radius: 6px;
      background: none; color: var(--text-muted); font-size: 14px;
      font-weight: 500; cursor: pointer; text-align: left; width: 100%;
    }
    .sidebar-item:hover { background: var(--border); color: var(--text); }
    .sidebar-item.active { background: var(--border); color: var(--text); font-weight: 600; }
    .sidebar-item svg { flex-shrink: 0; opacity: 0.6; }
    .sidebar-item.active svg { opacity: 1; }

  AFTER (this file):
  - .sidebar-item CSS class replaced with Tailwind utilities on <button>
  - <svg><use href="#icon-box"/></svg> replaced with <component :is="icon" :size="18" />
  - SVG opacity handled with Tailwind opacity classes
  - Active state managed via dynamic class binding
  - No CSS file needed — all styling is in the template
-->
<script setup>
import { computed } from 'vue';

const props = defineProps({
  /** The Lucide icon component to render */
  icon: {
    type: [Object, Function],
    required: true,
  },
  /** Button label text */
  label: {
    type: String,
    required: true,
  },
  /** Whether this item is currently active */
  active: {
    type: Boolean,
    default: false,
  },
});

defineEmits(['click']);

const iconOpacity = computed(() => props.active ? 'opacity-100' : 'opacity-60');
</script>

<template>
  <button
    class="flex items-center gap-2.5 px-3 py-2 border-none rounded-md
           bg-transparent text-text-muted text-sm font-medium
           cursor-pointer text-left w-full
           hover:bg-border hover:text-text"
    :class="{
      'bg-border text-text font-semibold': active,
    }"
    @click="$emit('click')"
  >
    <component
      :is="icon"
      :size="18"
      class="shrink-0"
      :class="iconOpacity"
    />
    <span>{{ label }}</span>
  </button>
</template>
