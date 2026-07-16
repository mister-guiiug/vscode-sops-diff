import { parseTree, type Node as JsonNode } from 'jsonc-parser'
import { isEncryptableValue, isPathEncrypted } from '../sops/rules'
import type { NormalizeOptions, NormalizeResult } from '../types'
import { applyEdits, containsEnc, expandToWholeLines, maskEncLiterals, type Edit } from './edits'
import { normalizeText } from './text'

const SOPS_KEY = 'sops'
const METADATA_KEYS = new Set(['mac', 'version', 'lastmodified', 'kms', 'pgp', 'age', 'gcp_kms', 'azure_kv', 'hc_vault'])

export function detectJson(text: string): boolean {
  const tree = parse(text)
  return (tree && !!findSopsProperty(tree)) || containsEnc(text)
}

export function normalizeJson(text: string, opts: NormalizeOptions): NormalizeResult {
  const tree = parse(text)
  if (!tree) return normalizeText(text, opts)

  const edits: Edit[] = []
  let metadataStripped = false

  const sopsProperty = findSopsProperty(tree)
  if (sopsProperty && opts.stripMetadata) {
    edits.push(removePropertyEdit(text, tree, sopsProperty))
    metadataStripped = true
  }

  const masked = opts.maskClearValues ? collectMasks(tree, [], opts, edits, sopsProperty) : 0
  const literals = maskEncLiterals(applyEdits(text, edits), opts.placeholder)
  return { text: literals.text, masked: masked + literals.masked, metadataStripped }
}

function parse(text: string): JsonNode | undefined {
  try {
    return parseTree(text, [], { allowTrailingComma: true, disallowComments: false })
  } catch {
    return undefined
  }
}

function findSopsProperty(tree: JsonNode): JsonNode | undefined {
  if (tree.type !== 'object') return undefined
  return tree.children?.find((property) => {
    if (property.children?.[0]?.value !== SOPS_KEY) return false
    const value = property.children[1]
    if (value?.type !== 'object') return false
    return !!value.children?.some((meta) => METADATA_KEYS.has(String(meta.children?.[0]?.value)))
  })
}

function collectMasks(
  node: JsonNode,
  path: readonly string[],
  opts: NormalizeOptions,
  edits: Edit[],
  skip: JsonNode | undefined,
): number {
  switch (node.type) {
    case 'object': {
      let masked = 0
      for (const property of node.children ?? []) {
        if (property === skip) continue
        const key = property.children?.[0]
        const value = property.children?.[1]
        if (!key || !value) continue
        masked += collectMasks(value, [...path, String(key.value)], opts, edits, skip)
      }
      return masked
    }
    case 'array': {
      let masked = 0
      for (const item of node.children ?? []) masked += collectMasks(item, path, opts, edits, skip)
      return masked
    }
    case 'string':
    case 'number':
    case 'boolean': {
      if (!isEncryptableValue(node.value) || !isPathEncrypted(path, opts.rules)) return 0
      edits.push({
        start: node.offset,
        end: node.offset + node.length,
        replacement: JSON.stringify(opts.placeholder),
      })
      return 1
    }
    default:
      return 0
  }
}

/**
 * Delete a top-level property along with the comma that used to attach it. SOPS
 * appends its metadata last, so the comma normally sits before the property; the
 * other case is handled for hand-edited files.
 */
function removePropertyEdit(text: string, parent: JsonNode, property: JsonNode): Edit {
  const siblings = parent.children ?? []
  const index = siblings.indexOf(property)
  const isLast = index === siblings.length - 1
  let start = property.offset
  let end = property.offset + property.length

  if (isLast) {
    let cursor = start
    while (cursor > 0 && /\s/.test(text[cursor - 1]!)) cursor--
    if (text[cursor - 1] === ',') return { start: cursor - 1, end, replacement: '' }
    return { start, end, replacement: '' }
  }

  let cursor = end
  while (cursor < text.length && /\s/.test(text[cursor]!)) cursor++
  if (text[cursor] === ',') end = cursor + 1
  ;({ start, end } = expandToWholeLines(text, start, end))
  return { start, end, replacement: '' }
}
