import { isEncryptableValue, isPathEncrypted } from '../sops/rules'
import type { NormalizeOptions, NormalizeResult } from '../types'
import { containsEnc, joinLines, maskEncLiterals, splitLines } from './edits'

const ENTRY_RE = /^([A-Za-z_][A-Za-z0-9_.]*)=(.*)$/
/** SOPS stores its metadata in a dotenv file as flat `sops_*` entries. */
const METADATA_RE = /^sops_[A-Za-z0-9_]*=/
const COMMENT_RE = /^\s*#/

export function detectEnv(text: string): boolean {
  return /^sops_(version|mac)=/m.test(text) || containsEnc(text)
}

export function normalizeEnv(text: string, opts: NormalizeOptions): NormalizeResult {
  let masked = 0
  let metadataStripped = false
  const lines: { body: string; cr: string }[] = []

  for (const line of splitLines(text)) {
    if (METADATA_RE.test(line.body)) {
      if (opts.stripMetadata) {
        metadataStripped = true
        continue
      }
      lines.push(line)
      continue
    }
    if (!opts.compareComments && COMMENT_RE.test(line.body)) continue

    const entry = ENTRY_RE.exec(line.body)
    const key = entry?.[1]
    const value = entry?.[2]
    if (opts.maskClearValues && key && isEncryptableValue(value) && isPathEncrypted([key], opts.rules)) {
      lines.push({ ...line, body: `${key}=${opts.placeholder}` })
      masked++
      continue
    }
    lines.push(line)
  }

  const literals = maskEncLiterals(joinLines(lines), opts.placeholder)
  return { text: literals.text, masked: masked + literals.masked, metadataStripped }
}
