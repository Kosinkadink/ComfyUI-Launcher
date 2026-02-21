/**
 * PoC: vue-i18n configuration for ComfyUI Launcher
 *
 * Demonstrates:
 * - createI18n() setup with the existing en.json locale format (no changes needed)
 * - Lazy loading of non-default locales via dynamic import
 * - Fallback locale configuration
 *
 * In a full migration this would live at src/i18n/index.js and be registered
 * via app.use(i18n) in the Vue app entry point.
 */
import { createI18n } from "vue-i18n";
import en from "../../locales/en.json";

/**
 * Create and configure the vue-i18n instance.
 *
 * The existing en.json uses {placeholder} named interpolation which is
 * natively supported by vue-i18n — no locale file changes required.
 *
 * Examples from en.json that work as-is:
 *   "exitCode": "Exit code {code}"        → $t('running.exitCode', { code: 1 })
 *   "detectedGpu": "Detected GPU: {label}" → $t('newInstall.detectedGpu', { label: 'NVIDIA' })
 *   "connectedTo": "Connected to {url}"    → $t('console.connectedTo', { url: 'http://...' })
 */
const i18n = createI18n({
  legacy: false, // Use Composition API mode
  locale: "en",
  fallbackLocale: "en",
  messages: { en },
  // Silence missing-key warnings in development for keys still being migrated
  missingWarn: false,
  fallbackWarn: false,
});

/**
 * Lazily load a locale's messages and register them with vue-i18n.
 * Only the active locale is loaded — other locales are fetched on demand.
 *
 * @param {string} locale - Locale code (e.g., 'zh', 'ja', 'fr')
 * @returns {Promise<void>}
 */
export async function loadLocaleMessages(locale) {
  if (i18n.global.availableLocales.includes(locale)) {
    i18n.global.locale.value = locale;
    document.querySelector("html").setAttribute("lang", locale);
    return;
  }

  // Dynamic import — Vite splits each locale into its own chunk
  const messages = await import(`../../locales/${locale}.json`);
  i18n.global.setLocaleMessage(locale, messages.default);
  i18n.global.locale.value = locale;
  document.querySelector("html").setAttribute("lang", locale);
}

/**
 * Available locales with display labels, matching the current
 * getAvailableLocales() API from lib/i18n.js:68-79.
 */
export function getAvailableLocales() {
  // In a full migration, this would scan the locales directory at build time
  // via @intlify/unplugin-vue-i18n or a Vite glob import
  return [
    { value: "en", label: "English" },
    { value: "zh", label: "中文" },
  ];
}

export default i18n;
