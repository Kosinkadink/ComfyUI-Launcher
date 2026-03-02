<script setup lang="ts">
import { ref, computed } from 'vue'

interface ArgDef {
  name: string
  label: string
  description: string
  type: 'boolean' | 'number' | 'string' | 'select'
  choices?: { value: string; label: string }[]
  group: string
  since?: string
  exclusiveGroup?: string
}

interface Props {
  modelValue: string
  schema: ArgDef[]
  version?: string
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const expanded = ref(false)

// --- Parsing: string → structured state ---

function parseArgs(raw: string): { known: Map<string, string>; extra: string } {
  const tokens: string[] = []
  let current = ''
  let inQuote: string | null = null
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; continue }
      current += ch
    } else if (ch === '"' || ch === "'") {
      inQuote = ch
    } else if (/\s/.test(ch)) {
      if (current.length > 0) { tokens.push(current); current = '' }
    } else {
      current += ch
    }
  }
  if (current.length > 0) tokens.push(current)

  const schemaNames = new Set(props.schema.map((a) => a.name))
  const known = new Map<string, string>()
  const extraTokens: string[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token.startsWith('--')) {
      const name = token.slice(2)
      if (schemaNames.has(name)) {
        const def = props.schema.find((a) => a.name === name)!
        if (def.type === 'boolean') {
          known.set(name, '')
          i++
        } else {
          const nextToken = tokens[i + 1]
          if (nextToken !== undefined && !nextToken.startsWith('--')) {
            known.set(name, nextToken)
            i += 2
          } else {
            known.set(name, '')
            i++
          }
        }
      } else {
        extraTokens.push(token)
        i++
        if (i < tokens.length && !tokens[i]!.startsWith('--')) {
          extraTokens.push(tokens[i]!)
          i++
        }
      }
    } else {
      extraTokens.push(token)
      i++
    }
  }

  return { known, extra: extraTokens.join(' ') }
}

// --- Serializing: structured state → string ---

function serializeArgs(known: Map<string, string>, extra: string): string {
  const parts: string[] = []
  for (const [name, value] of known) {
    parts.push(`--${name}`)
    if (value !== '') {
      parts.push(value.includes(' ') ? `"${value}"` : value)
    }
  }
  const extraTrimmed = extra.trim()
  if (extraTrimmed) parts.push(extraTrimmed)
  return parts.join(' ')
}

// --- Reactive state derived from the string ---

const parsed = computed(() => parseArgs(props.modelValue))

// --- Version filtering ---

function versionSatisfies(installed: string, required: string): boolean {
  const parse = (v: string): number[] => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const a = parse(installed)
  const b = parse(required)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0
    const bv = b[i] ?? 0
    if (av > bv) return true
    if (av < bv) return false
  }
  return true
}

const visibleArgs = computed(() => {
  if (!props.version) return props.schema
  return props.schema.filter((a) => !a.since || versionSatisfies(props.version!, a.since))
})

// --- Getters ---

function isActive(name: string): boolean {
  return parsed.value.known.has(name)
}

function getValue(name: string): string {
  return parsed.value.known.get(name) ?? ''
}

// --- Mutators: update the known map, then serialize back to the string ---

function emitUpdate(known: Map<string, string>): void {
  emit('update:modelValue', serializeArgs(known, parsed.value.extra))
}

function toggleBoolean(name: string): void {
  const next = new Map(parsed.value.known)
  if (next.has(name)) {
    next.delete(name)
  } else {
    next.set(name, '')
  }
  emitUpdate(next)
}

function setValueArg(name: string, value: string): void {
  const next = new Map(parsed.value.known)
  if (value === '') {
    next.delete(name)
  } else {
    next.set(name, value)
  }
  emitUpdate(next)
}
</script>

<template>
  <div class="args-builder">
    <!-- Primary: the raw args string is the source of truth -->
    <input
      type="text"
      class="detail-field-input"
      :value="modelValue"
      placeholder="--flag value …"
      @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    >

    <!-- Toggle -->
    <button class="args-helper-toggle" @click="expanded = !expanded">
      <span class="args-helper-caret" :class="{ expanded }">▸</span>
      Argument helper
    </button>

    <!-- Helper: reflects current string state -->
    <div v-if="expanded" class="args-helper">
      <div v-for="a in visibleArgs" :key="a.name" class="args-row">
        <!-- Boolean -->
        <template v-if="a.type === 'boolean'">
          <label class="args-check-row">
            <input type="checkbox" :checked="isActive(a.name)" @change="toggleBoolean(a.name)">
            <div class="args-text">
              <span class="args-name">{{ a.label }}</span>
              <span class="args-desc">{{ a.description }}</span>
            </div>
          </label>
        </template>

        <!-- Number -->
        <template v-else-if="a.type === 'number'">
          <div class="args-text">
            <span class="args-name">{{ a.label }}</span>
            <span class="args-desc">{{ a.description }}</span>
          </div>
          <input
            type="number"
            class="detail-field-input args-input args-input-narrow"
            :value="getValue(a.name) || ''"
            @change="setValueArg(a.name, ($event.target as HTMLInputElement).value)"
          >
        </template>

        <!-- String -->
        <template v-else-if="a.type === 'string'">
          <div class="args-text">
            <span class="args-name">{{ a.label }}</span>
            <span class="args-desc">{{ a.description }}</span>
          </div>
          <input
            type="text"
            class="detail-field-input args-input"
            :value="getValue(a.name)"
            @change="setValueArg(a.name, ($event.target as HTMLInputElement).value)"
          >
        </template>

        <!-- Select -->
        <template v-else-if="a.type === 'select'">
          <div class="args-text">
            <span class="args-name">{{ a.label }}</span>
            <span class="args-desc">{{ a.description }}</span>
          </div>
          <select
            class="detail-field-input args-input"
            :value="getValue(a.name)"
            @change="setValueArg(a.name, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Default</option>
            <option v-for="c in a.choices" :key="c.value" :value="c.value">{{ c.label }}</option>
          </select>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.args-builder {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.args-helper-toggle {
  align-self: flex-start;
  font-size: 12px;
  color: var(--text-muted);
  background: none;
  border: none;
  padding: 2px 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.args-helper-toggle:hover {
  color: var(--accent);
}
.args-helper-caret {
  display: inline-block;
  transition: transform 0.15s;
  font-size: 10px;
}
.args-helper-caret.expanded {
  transform: rotate(90deg);
}

.args-helper {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
}

.args-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 0;
}
.args-row + .args-row {
  border-top: 1px solid var(--border);
}

.args-check-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}
.args-check-row input[type="checkbox"] {
  margin: 2px 0 0;
  flex-shrink: 0;
}

.args-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.args-name {
  font-size: 13px;
  color: var(--text);
}

.args-desc {
  font-size: 12px;
  color: var(--text-faint);
}

.args-input {
  margin-top: 0 !important;
}

.args-input-narrow {
  max-width: 120px;
}
</style>
