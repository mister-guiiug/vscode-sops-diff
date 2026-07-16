import { isEncryptableValue, isPathEncrypted } from '../sops/rules'
import type { NormalizeOptions, NormalizeResult } from '../types'
import { containsEnc, joinLines, maskEncLiterals, splitLines } from './edits'

/** `  - key: value`, `key = value`, `"key": value` — the shapes worth guessing at. */
const KEY_VALUE_RE = /^(\s*(?:-\s+)?)(["']?)([A-Za-z0-9_][\w.\-/]*)\2(\s*[:=]\s*)(.*)$/
const COMMENT_ONLY_RE = /^\s*[#;]/
/** A YAML block scalar header opens a value that continues on the next lines. */
const BLOCK_SCALAR_RE = /^[|>][-+]?\d*$/

export function detectText(text: string): boolean {
  return containsEnc(text)
}

/**
 * Last-resort normaliser for formats we cannot parse: work line by line and treat
 * whatever sits after the first `:` or `=` as the value. Everything before it is
 * the prefix that decides whether two lines line up.
 */
export function normalizeText(text: string, opts: NormalizeOptions): NormalizeResult {
  let masked = 0
  const lines = splitLines(text)
    .filter((line) => opts.compareComments || !COMMENT_ONLY_RE.test(line.body))
    .map((line) => {
      const body = maskLine(line.body, opts)
      if (body !== line.body) masked++
      return { ...line, body }
    })

  const literals = maskEncLiterals(joinLines(lines), opts.placeholder)
  return { text: literals.text, masked: masked + literals.masked, metadataStripped: false }
}

function maskLine(body: string, opts: NormalizeOptions): string {
  if (!opts.maskClearValues) return body

  const match = KEY_VALUE_RE.exec(body)
  if (!match) return body

  const [, indent = '', quote = '', key = '', separator = '', value = ''] = match
  const trimmed = value.trim()
  if (!isEncryptableValue(trimmed) || BLOCK_SCALAR_RE.test(trimmed)) return body
  if (!isPathEncrypted([key], opts.rules)) return body

  return `${indent}${quote}${key}${quote}${separator}${opts.placeholder}`
}
