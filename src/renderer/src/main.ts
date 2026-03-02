import './assets/main.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createI18n } from 'vue-i18n'
import App from './App.vue'
import type { RendererErrorReport } from './types/ipc'

const i18n = createI18n({
  legacy: false,
  locale: 'en',
  fallbackLocale: 'en',
  messages: { en: {} },
  missingWarn: false,
  fallbackWarn: false,
})

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.mount('#app')

function reportRendererError(payload: RendererErrorReport): void {
  void window.api.reportRendererError(payload).catch(() => {
    // Never throw from global error handlers.
  })
}

window.addEventListener('error', (event) => {
  reportRendererError({
    type: 'error',
    message: event.message,
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const message = reason instanceof Error ? reason.message : String(reason)
  const stack = reason instanceof Error ? reason.stack : undefined
  reportRendererError({
    type: 'unhandledrejection',
    message,
    stack,
    reason: message,
  })
})

export { i18n }
