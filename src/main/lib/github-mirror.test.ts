import { describe, it, expect } from 'vitest'
import { rewriteCloneUrl, getComfyUIRemoteUrl, GITCODE_COMFY_ORG_BASE } from './github-mirror'

describe('rewriteCloneUrl', () => {
  it('rewrites Comfy-Org HTTPS URLs when enabled', () => {
    expect(rewriteCloneUrl('https://github.com/Comfy-Org/ComfyUI', true))
      .toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI`)
  })

  it('rewrites Comfy-Org HTTPS URLs with .git suffix', () => {
    expect(rewriteCloneUrl('https://github.com/Comfy-Org/ComfyUI.git', true))
      .toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI`)
  })

  it('rewrites Comfy-Org HTTPS URLs with trailing slash', () => {
    expect(rewriteCloneUrl('https://github.com/Comfy-Org/ComfyUI/', true))
      .toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI`)
  })

  it('rewrites other Comfy-Org repos', () => {
    expect(rewriteCloneUrl('https://github.com/Comfy-Org/ComfyUI-Manager.git', true))
      .toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI-Manager`)
  })

  it('passes through non-Comfy-Org URLs unchanged', () => {
    const url = 'https://github.com/Kosinkadink/ComfyUI-AnimateDiff-Evolved'
    expect(rewriteCloneUrl(url, true)).toBe(url)
  })

  it('passes through all URLs when disabled', () => {
    const url = 'https://github.com/Comfy-Org/ComfyUI'
    expect(rewriteCloneUrl(url, false)).toBe(url)
  })

  it('handles SSH-style URLs', () => {
    expect(rewriteCloneUrl('git@github.com:Comfy-Org/ComfyUI.git', true))
      .toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI`)
  })
})

describe('getComfyUIRemoteUrl', () => {
  it('returns github.com URL when disabled', () => {
    expect(getComfyUIRemoteUrl(false)).toBe('https://github.com/Comfy-Org/ComfyUI.git')
  })

  it('returns gitcode.com URL when enabled', () => {
    expect(getComfyUIRemoteUrl(true)).toBe(`${GITCODE_COMFY_ORG_BASE}/ComfyUI`)
  })
})
