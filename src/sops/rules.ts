import type { EncryptionRules } from '../types'

/** SOPS' own default when a creation rule sets none of the four knobs. */
export const DEFAULT_UNENCRYPTED_SUFFIX = '_unencrypted'

export const DEFAULT_RULES: EncryptionRules = {
  unencryptedSuffix: DEFAULT_UNENCRYPTED_SUFFIX,
}

/**
 * Go's regexp (RE2) and JavaScript's RegExp agree on the constructs used by
 * real-world `.sops.yaml` files, with one common exception: Go supports the
 * inline `(?i)` flag, JavaScript only supports the trailing `i`.
 */
export function compileGoRegex(source: string): RegExp {
  let body = source
  let flags = ''
  const inline = /^\(\?([imsU]+)\)/.exec(body)
  if (inline?.[1]) {
    body = body.slice(inline[0].length)
    if (inline[1].includes('i')) flags += 'i'
    if (inline[1].includes('s')) flags += 's'
    if (inline[1].includes('m')) flags += 'm'
  }
  return new RegExp(body, flags)
}

/**
 * Reproduces the decision SOPS makes in `Tree.Encrypt`: start from "encrypted",
 * then let each configured knob override the verdict in a fixed order, testing
 * every segment of the key path so that a match anywhere above a leaf applies
 * to the whole subtree.
 *
 * `path` holds map keys only — SOPS does not add sequence indices to the path,
 * so every item of a list inherits the verdict of the key holding it.
 */
export function isPathEncrypted(path: readonly string[], rules: EncryptionRules): boolean {
  let encrypted = true

  if (rules.unencryptedSuffix) {
    if (path.some((p) => p.endsWith(rules.unencryptedSuffix!))) encrypted = false
  }
  if (rules.encryptedSuffix) {
    encrypted = path.some((p) => p.endsWith(rules.encryptedSuffix!))
  }
  if (rules.unencryptedRegex) {
    const re = compileGoRegex(rules.unencryptedRegex)
    if (path.some((p) => re.test(p))) encrypted = false
  }
  if (rules.encryptedRegex) {
    const re = compileGoRegex(rules.encryptedRegex)
    encrypted = path.some((p) => re.test(p))
  }

  return encrypted
}

/**
 * SOPS leaves `null` and empty scalars untouched, so masking them on the
 * cleartext side would invent a difference that the encrypted file never has.
 */
export function isEncryptableValue(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}
