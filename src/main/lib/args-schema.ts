/** Schema describing known ComfyUI CLI arguments for the args-builder UI. */

export interface ArgDef {
  /** The CLI flag without leading dashes, e.g. "port" for --port */
  name: string
  /** Human-readable label */
  label: string
  /** Short description shown as tooltip/hint */
  description: string
  /** Argument type */
  type: 'boolean' | 'number' | 'string' | 'select'
  /** For select type: available choices */
  choices?: { value: string; label: string }[]
  /** Group this arg belongs to */
  group: string
  /** ComfyUI version that introduced this arg (semver), or undefined if always available */
  since?: string
  /** For mutually-exclusive groups: only one from the same exclusiveGroup can be active */
  exclusiveGroup?: string
}

export const ARG_SCHEMA: ArgDef[] = [
  { name: 'port', label: 'Port', description: 'Set the listen port (default: 8188)', type: 'number', group: 'common' },
  { name: 'listen', label: 'Listen Address', description: 'IP address to listen on. Leave empty for 0.0.0.0 (all interfaces)', type: 'string', group: 'common' },
  { name: 'front-end-version', label: 'Frontend Version', description: 'Format: owner/repo@version (e.g. comfyanonymous/ComfyUI@latest)', type: 'string', group: 'common' },
  { name: 'enable-manager', label: 'Enable Manager', description: 'Enable the ComfyUI-Manager extension', type: 'boolean', group: 'common' },
]

/**
 * Compare two version strings (e.g. "0.3.8" vs "0.4.0").
 * Returns true if `installed` >= `required`.
 */
export function versionSatisfies(installed: string, required: string): boolean {
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
