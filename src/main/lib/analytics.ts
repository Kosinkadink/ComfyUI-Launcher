import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import * as settings from '../settings'
import type { RendererErrorReport } from '../../types/ipc'

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'
const DEFAULT_TIMEOUT_MS = 5000
const MIN_TIMEOUT_MS = 1000
const MAX_TIMEOUT_MS = 30000

const DISTINCT_ID_SETTING_KEY = 'posthogDistinctId'
const TELEMETRY_ENABLED_SETTING_KEY = 'telemetryEnabled'
const ERROR_REPORTING_ENABLED_SETTING_KEY = 'errorReportingEnabled'

const MAX_PROPERTY_KEYS = 50
const MAX_STRING_LENGTH = 2000
const MAX_STACK_LENGTH = 8000
const MAX_DEPTH = 4

let _cachedDistinctId: string | null = null
let _processHandlersBound = false

interface PosthogConfig {
  host: string
  projectToken: string
  distinctId: string
  timeoutMs: number
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on' ||
    normalized === 'enable' ||
    normalized === 'enabled'
  ) {
    return true
  }
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off' ||
    normalized === 'disable' ||
    normalized === 'disabled'
  ) {
    return false
  }
  return undefined
}

function parseTimeoutMs(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.round(parsed)))
}

function normalizeHost(host: string): string {
  return host.replace(/\/+$/, '')
}

function getOrCreateDistinctId(): string {
  if (_cachedDistinctId) return _cachedDistinctId

  const envDistinctId = (process.env['COMFY_POSTHOG_DISTINCT_ID'] ?? '').trim()
  if (envDistinctId) {
    _cachedDistinctId = envDistinctId
    return envDistinctId
  }

  const existing = settings.get(DISTINCT_ID_SETTING_KEY)
  if (typeof existing === 'string' && existing.trim().length > 0) {
    _cachedDistinctId = existing
    return existing
  }

  const generated = randomUUID()
  settings.set(DISTINCT_ID_SETTING_KEY, generated)
  _cachedDistinctId = generated
  return generated
}

function isTelemetryEnabled(): boolean {
  const envOverride = parseBoolean(process.env['COMFY_POSTHOG_TELEMETRY_ENABLED'])
  if (envOverride !== undefined) return envOverride
  return settings.get(TELEMETRY_ENABLED_SETTING_KEY) === true
}

function isErrorReportingEnabled(): boolean {
  const envOverride = parseBoolean(process.env['COMFY_POSTHOG_ERROR_REPORTING_ENABLED'])
  if (envOverride !== undefined) return envOverride
  return settings.get(ERROR_REPORTING_ENABLED_SETTING_KEY) !== false
}

function getPosthogConfig(): PosthogConfig | null {
  const projectToken = (process.env['COMFY_POSTHOG_PROJECT_TOKEN'] ?? '').trim()
  if (!projectToken) return null

  const host = normalizeHost((process.env['COMFY_POSTHOG_HOST'] ?? DEFAULT_POSTHOG_HOST).trim() || DEFAULT_POSTHOG_HOST)
  const timeoutMs = parseTimeoutMs(process.env['COMFY_POSTHOG_TIMEOUT_MS'] ?? process.env['COMFY_UPDATER_CANARY_TIMEOUT_MS'])

  return {
    host,
    projectToken,
    distinctId: getOrCreateDistinctId(),
    timeoutMs,
  }
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}…`
}

function isSensitiveKey(key: string): boolean {
  return /(token|secret|password|cookie|authorization|auth)/i.test(key)
}

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return '[max-depth]'
  if (value == null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return truncateString(value, MAX_STRING_LENGTH)
  if (Array.isArray(value)) {
    return value.slice(0, MAX_PROPERTY_KEYS).map((entry) => sanitizeValue(entry, depth + 1))
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const sanitized: Record<string, unknown> = {}
    for (const key of Object.keys(record).slice(0, MAX_PROPERTY_KEYS)) {
      sanitized[key] = isSensitiveKey(key) ? '[redacted]' : sanitizeValue(record[key], depth + 1)
    }
    return sanitized
  }
  return String(value)
}

function sanitizeProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeValue(properties)
  return (sanitized && typeof sanitized === 'object' ? sanitized : {}) as Record<string, unknown>
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      errorName: error.name || 'Error',
      errorMessage: truncateString(error.message || 'Unknown error', MAX_STRING_LENGTH),
      errorStack: error.stack ? truncateString(error.stack, MAX_STACK_LENGTH) : null,
    }
  }

  return {
    errorName: 'NonError',
    errorMessage: truncateString(String(error), MAX_STRING_LENGTH),
    errorStack: null,
  }
}

async function sendPosthogEvent(event: string, properties: Record<string, unknown>): Promise<void> {
  const config = getPosthogConfig()
  if (!config) return

  const payload = {
    api_key: config.projectToken,
    event,
    distinct_id: config.distinctId,
    properties: {
      ...sanitizeProperties(properties),
      launcherVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
    },
  }

  try {
    const response = await fetch(`${config.host}/capture/`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'ComfyUI-Launcher',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    })

    if (!response.ok) {
      console.warn(`[analytics] PostHog capture failed (${response.status}) for event "${event}"`)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[analytics] Failed to send PostHog event "${event}": ${msg}`)
  }
}

export function captureTelemetry(event: string, properties: Record<string, unknown> = {}): void {
  if (!isTelemetryEnabled()) return
  void sendPosthogEvent(event, { category: 'telemetry', ...properties })
}

export function captureError(event: string, error: unknown, context: Record<string, unknown> = {}): void {
  if (!isErrorReportingEnabled()) return
  const serializedError = serializeError(error)
  void sendPosthogEvent(event, {
    category: 'error-report',
    ...context,
    ...serializedError,
  })
}

export function reportRendererError(payload: RendererErrorReport): void {
  const message = payload.message || payload.reason || 'Renderer error'
  captureError('renderer_error', new Error(message), {
    type: payload.type,
    source: payload.source,
    line: payload.line,
    column: payload.column,
    rendererStack: payload.stack ? truncateString(payload.stack, MAX_STACK_LENGTH) : undefined,
    reason: payload.reason,
  })
}

export function registerProcessErrorHandlers(): void {
  if (_processHandlersBound) return
  _processHandlersBound = true

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    captureError('main_uncaught_exception', error, { origin })
  })

  process.on('unhandledRejection', (reason) => {
    captureError('main_unhandled_rejection', reason)
  })
}
