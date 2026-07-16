import type { NormalizeOptions, NormalizeResult } from '../types'
import { matchTrailingNewline } from './edits'
import { detectEnv, normalizeEnv } from './env'
import { detectIni, normalizeIni } from './ini'
import { detectJson, normalizeJson } from './json'
import { detectText, normalizeText } from './text'
import { detectYaml, normalizeYaml } from './yaml'

export type Format = 'yaml' | 'json' | 'env' | 'ini' | 'text'

export function basenameOf(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').pop() ?? ''
}

export function detectFormat(filePath: string, text: string): Format {
  const base = basenameOf(filePath).toLowerCase()
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 ? base.slice(dot) : ''

  if (ext === '.yaml' || ext === '.yml') return 'yaml'
  if (ext === '.json') return 'json'
  if (ext === '.ini') return 'ini'
  if (base === '.env' || base.startsWith('.env.') || ext === '.env') return 'env'
  // SOPS' "binary" mode wraps any input in a JSON envelope, whatever the extension.
  if (text.trimStart().startsWith('{')) return 'json'
  return 'text'
}

export function detectSops(text: string, format: Format): boolean {
  switch (format) {
    case 'yaml':
      return detectYaml(text)
    case 'json':
      return detectJson(text)
    case 'env':
      return detectEnv(text)
    case 'ini':
      return detectIni(text)
    case 'text':
      return detectText(text)
  }
}

export function normalize(text: string, format: Format, opts: NormalizeOptions): NormalizeResult {
  const result = runNormalizer(text, format, opts)
  return { ...result, text: matchTrailingNewline(text, result.text) }
}

function runNormalizer(text: string, format: Format, opts: NormalizeOptions): NormalizeResult {
  switch (format) {
    case 'yaml':
      return normalizeYaml(text, opts)
    case 'json':
      return normalizeJson(text, opts)
    case 'env':
      return normalizeEnv(text, opts)
    case 'ini':
      return normalizeIni(text, opts)
    case 'text':
      return normalizeText(text, opts)
  }
}
