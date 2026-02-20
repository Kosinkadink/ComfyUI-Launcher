<!--
  PoC: SidebarExample.vue — Demonstrates full sidebar using SidebarItem + Lucide icons

  This replaces:
  - index.html lines 49–71 (sidebar nav HTML)
  - index.html lines 10–44 (SVG sprite — no longer needed)
  - styles.css lines 55–133 (sidebar CSS classes)

  The <svg><use href="#icon-box"/></svg> pattern becomes a simple component import.
-->
<script setup>
import { ref } from 'vue';
import { Box, Play, FolderOpen, Settings } from 'lucide-vue-next';
import SidebarItem from './SidebarItem.vue';

const currentView = ref('list');

const navItems = [
  { id: 'list', icon: Box, labelKey: 'Installations' },
  { id: 'running', icon: Play, labelKey: 'Running' },
  { id: 'models', icon: FolderOpen, labelKey: 'Models' },
  { id: 'settings', icon: Settings, labelKey: 'Settings' },
];

function navigate(viewId) {
  currentView.value = viewId;
}
</script>

<template>
  <nav class="w-[200px] shrink-0 bg-surface border-r border-border flex flex-col py-4">
    <div class="px-5 pt-3 pb-6 text-[15px] font-bold text-text tracking-tight">
      ComfyUI Launcher
    </div>
    <div class="flex flex-col gap-0.5 px-2 flex-1">
      <SidebarItem
        v-for="item in navItems"
        :key="item.id"
        :icon="item.icon"
        :label="item.labelKey"
        :active="currentView === item.id"
        @click="navigate(item.id)"
      />
    </div>
  </nav>
</template>
