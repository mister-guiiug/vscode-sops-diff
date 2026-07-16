import { isEncryptableValue, isPathEncrypted } from '../sops/rules'
import type { NormalizeOptions, NormalizeResult } from '../types'
import { containsEnc, joinLines, maskEncLiterals, splitLines } from './edits'

const SECTION_RE = /^\s*\[([^\]]*)\]\s*$/
const ENTRY_RE = /^(\s*)([^=;#[\s][^=]*?)(\s*=\s*)(.*)$/
const COMMENT_RE = /^\s*[;#]/

export function detectIni(text: string): boolean {
  return /^\s*\[sops[^\]]*\]\s*$/im.test(text) || containsEnc(text)
}

export function normalizeIni(text: string, opts: NormalizeOptions): NormalizeResult {
  let masked = 0
  let metadataStripped = false
  let section: string | undefined
  let inMetadata = false
  const lines: { body: string; cr: string }[] = []

  for (const line of splitLines(text)) {
    const sectionMatch = SECTION_RE.exec(line.body)
    if (sectionMatch) {
      section = sectionMatch[1]?.trim()
      inMetadata = !!section && /^sops/i.test(section)
    }
    if (inMetadata) {
      if (opts.stripMetadata) {
        metadataStripped = true
        continue
      }
      lines.push(line)
      continue
    }
    if (!opts.compareComments && COMMENT_RE.test(line.body)) continue
    if (sectionMatch) {
      lines.push(line)
      continue
    }

    const entry = ENTRY_RE.exec(line.body)
    const key = entry?.[2]?.trim()
    const value = entry?.[4]
    const path = section ? [section, key ?? ''] : [key ?? '']
    if (opts.maskClearValues && key && isEncryptableValue(value) && isPathEncrypted(path, opts.rules)) {
      lines.push({ ...line, body: `${entry![1]}${entry![2]}${entry![3]}${opts.placeholder}` })
      masked++
      continue
    }
    lines.push(line)
  }

  const literals = maskEncLiterals(joinLines(lines), opts.placeholder)
  return { text: literals.text, masked: masked + literals.masked, metadataStripped }
}
