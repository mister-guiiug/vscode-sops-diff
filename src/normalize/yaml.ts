import { Parser, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml'
import type { Document, Pair, ParsedNode } from 'yaml'
import { isEncryptableValue, isPathEncrypted } from '../sops/rules'
import type { NormalizeOptions, NormalizeResult } from '../types'
import { applyEdits, commentEdit, containsEnc, expandToWholeLines, maskEncLiterals, type Edit } from './edits'
import { normalizeText } from './text'

type ParsedPair = Pair<ParsedNode, ParsedNode | null>

const SOPS_KEY = 'sops'
/** Any of these under a top-level `sops:` map means we are looking at SOPS metadata. */
const METADATA_KEYS = new Set([
  'mac',
  'version',
  'lastmodified',
  'kms',
  'pgp',
  'age',
  'gcp_kms',
  'azure_kv',
  'hc_vault',
  'encrypted_regex',
  'unencrypted_regex',
  'encrypted_suffix',
  'unencrypted_suffix',
  'mac_only_encrypted',
  'shamir_threshold',
])

export function detectYaml(text: string): boolean {
  try {
    for (const doc of parseAllDocuments(text)) {
      if (doc.errors.length === 0 && findSopsPair(doc)) return true
    }
  } catch {
    // Unparseable YAML still answers the question textually.
  }
  return containsEnc(text)
}

export function normalizeYaml(text: string, opts: NormalizeOptions): NormalizeResult {
  let docs: Document.Parsed[]
  try {
    docs = parseAllDocuments(text)
  } catch {
    return normalizeText(text, opts)
  }
  if (docs.some((doc) => doc.errors.length > 0)) return normalizeText(text, opts)

  const edits: Edit[] = []
  let masked = 0
  let metadataStripped = false

  for (const doc of docs) {
    const sopsPair = findSopsPair(doc)
    if (sopsPair && opts.stripMetadata) {
      const end = (sopsPair.value ?? sopsPair.key).range[1]
      edits.push({ ...expandToWholeLines(text, sopsPair.key.range[0], end), replacement: '' })
      metadataStripped = true
    }
    if (opts.maskClearValues) {
      masked += collectMasks(doc.contents, [], opts, edits, sopsPair)
    }
  }

  if (!opts.compareComments) {
    for (const [start, end] of collectCommentRanges(text)) {
      edits.push(commentEdit(text, start, end))
    }
  }

  const literals = maskEncLiterals(applyEdits(text, edits), opts.placeholder)
  return { text: literals.text, masked: masked + literals.masked, metadataStripped }
}

function findSopsPair(doc: Document.Parsed): ParsedPair | undefined {
  const contents = doc.contents
  if (!isMap(contents)) return undefined
  return contents.items.find(
    (item) =>
      isScalar(item.key) &&
      item.key.value === SOPS_KEY &&
      isMap(item.value) &&
      item.value.items.some((meta) => isScalar(meta.key) && METADATA_KEYS.has(String(meta.key.value))),
  )
}

/**
 * Walk the document the way SOPS walks its tree: map keys extend the path,
 * sequences do not, and only scalar leaves can be encrypted.
 */
function collectMasks(
  node: ParsedNode | null,
  path: readonly string[],
  opts: NormalizeOptions,
  edits: Edit[],
  skip: ParsedPair | undefined,
): number {
  if (isMap(node)) {
    let masked = 0
    for (const item of node.items) {
      if (item === skip) continue
      const key = isScalar(item.key) ? String(item.key.value) : undefined
      const childPath = key === undefined ? path : [...path, key]
      masked += collectMasks(item.value, childPath, opts, edits, skip)
    }
    return masked
  }

  if (isSeq(node)) {
    let masked = 0
    for (const item of node.items) masked += collectMasks(item, path, opts, edits, skip)
    return masked
  }

  if (isScalar(node) && isEncryptableValue(node.value) && isPathEncrypted(path, opts.rules)) {
    edits.push({ start: node.range[0], end: node.range[1], replacement: opts.placeholder })
    return 1
  }

  return 0
}

/**
 * Comments live in the concrete syntax tree rather than the document tree, and
 * they hang off several different token fields. Rather than track which, walk the
 * token graph and pick up anything that says it is a comment.
 */
function collectCommentRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []

  const visit = (token: unknown): void => {
    if (!token || typeof token !== 'object') return
    if (Array.isArray(token)) {
      for (const child of token) visit(child)
      return
    }
    const record = token as Record<string, unknown>
    if (record.type === 'comment' && typeof record.offset === 'number' && typeof record.source === 'string') {
      ranges.push([record.offset, record.offset + record.source.length])
      return
    }
    for (const [key, value] of Object.entries(record)) {
      if (key === 'type' || key === 'source') continue
      visit(value)
    }
  }

  try {
    for (const token of new Parser().parse(text)) visit(token)
  } catch {
    return []
  }
  return ranges
}
