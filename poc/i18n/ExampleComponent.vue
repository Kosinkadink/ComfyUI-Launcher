<!--
  PoC: Vue component using vue-i18n $t() with existing locale keys.

  Demonstrates that the current en.json format works unchanged with vue-i18n:
  - Simple keys: $t('sidebar.installations') → "Installations"
  - Named interpolation: $t('running.exitCode', { code: 1 }) → "Exit code 1"
  - Nested keys: $t('settings.title') → "Settings"

  In a full migration, each renderer/*.js file would become a .vue SFC
  using $t() instead of window.t().
-->
<template>
  <div class="poc-example">
    <h2>vue-i18n PoC — Using Existing Locale Keys</h2>

    <!-- Simple key lookup (replaces data-i18n="sidebar.installations") -->
    <nav aria-label="Main navigation">
      <ul>
        <li>{{ $t('sidebar.installations') }}</li>
        <li>{{ $t('sidebar.running') }}</li>
        <li>{{ $t('models.title') }}</li>
        <li>{{ $t('settings.title') }}</li>
      </ul>
    </nav>

    <!-- Named interpolation (replaces window.t('running.exitCode', { code })) -->
    <section>
      <h3>{{ $t('console.title') }}</h3>
      <p>{{ $t('running.exitCode', { code: exitCode }) }}</p>
      <p>{{ $t('console.connectedTo', { url: comfyUrl }) }}</p>
      <p>{{ $t('newInstall.detectedGpu', { label: gpuName }) }}</p>
    </section>

    <!-- Demonstrating locale switching -->
    <section>
      <h3>Locale Switching</h3>
      <p>Current locale: <strong>{{ $i18n.locale }}</strong></p>
      <button
        v-for="loc in locales"
        :key="loc.value"
        :disabled="$i18n.locale === loc.value"
        @click="switchLocale(loc.value)"
      >
        {{ loc.label }}
      </button>
    </section>

    <!-- Keys from different namespaces to prove full coverage -->
    <section>
      <h3>{{ $t('list.title') }}</h3>
      <p>{{ $t('list.empty') }}</p>
      <p>{{ $t('list.emptyHint') }}</p>
      <button>{{ $t('list.newInstall') }}</button>
      <button>{{ $t('list.trackExisting') }}</button>
    </section>

    <section>
      <h3>{{ $t('actions.deleteConfirmTitle') }}</h3>
      <p>{{ $t('actions.deleteConfirmMessage') }}</p>
      <button>{{ $t('common.cancel') }}</button>
      <button>{{ $t('modal.confirm') }}</button>
    </section>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { loadLocaleMessages, getAvailableLocales } from './index.js';

const exitCode = ref(1);
const comfyUrl = ref('http://127.0.0.1:8188');
const gpuName = ref('NVIDIA RTX 4090');
const locales = getAvailableLocales();

async function switchLocale(locale) {
  await loadLocaleMessages(locale);
}
</script>
