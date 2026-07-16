import * as vscode from 'vscode'
import { resolveRulesForFile, type RuleResolution } from './discovery'
import { basenameOf, detectFormat, detectSops, normalize, type Format } from './normalize'
import { decryptFile } from './sops/decrypt'
import type { NormalizeResult } from './types'

const MAX_BYTES = 5 * 1024 * 1024
const BINARY_PROBE_BYTES = 8000

export interface LoadedFile {
  uri: vscode.Uri
  name: string
  text: string
  format: Format
  encrypted: boolean
}

export async function loadFile(uri: vscode.Uri): Promise<LoadedFile> {
  const name = basenameOf(uri.path)
  const stat = await vscode.workspace.fs.stat(uri)
  if (stat.type & vscode.FileType.Directory) throw new Error(`"${name}" is a folder, not a file.`)

  const text = await readText(uri, name)
  const format = detectFormat(uri.path, text)
  return { uri, name, text, format, encrypted: detectSops(text, format) }
}

export interface NormalizedFile extends NormalizeResult {
  file: LoadedFile
  decrypted: boolean
  configPath?: string
  ruleDescription: string
  warnings: string[]
}

export interface NormalizeRequest {
  maskClearValues: boolean
  /** Both sides of a pair agree on this, so real values never face placeholders. */
  decrypt: boolean
}

export function sopsPathFor(uri: vscode.Uri): string {
  return vscode.workspace.getConfiguration('sopsDiff', uri).get('sopsPath', 'sops')
}

export async function normalizeFile(uri: vscode.Uri, request: NormalizeRequest): Promise<NormalizedFile> {
  const file = await loadFile(uri)
  const config = vscode.workspace.getConfiguration('sopsDiff', uri)

  let text = file.text
  let format = file.format
  let decrypted = false

  if (request.decrypt && file.encrypted) {
    const outcome = await decryptFile(uri.fsPath, sopsPathFor(uri))
    if (!outcome.ok) throw new Error(`Could not decrypt "${file.name}": ${outcome.reason}`)
    text = outcome.text
    // A binary-mode file is stored as a JSON envelope but decrypts to its original
    // format, so the format has to be read again from the plaintext.
    format = detectFormat(uri.path, text)
    decrypted = true
  }

  const resolution = await resolveRulesForFile(uri)
  const result = normalize(text, format, {
    rules: resolution.rules,
    placeholder: config.get('encryptedPlaceholder', 'ENC[***]'),
    stripMetadata: config.get('stripMetadata', true),
    maskClearValues: request.maskClearValues,
    compareComments: config.get('compareComments', false),
  })

  return {
    ...result,
    file,
    decrypted,
    configPath: resolution.configPath,
    ruleDescription: describeRules(resolution),
    warnings: resolution.warnings,
  }
}

function describeRules(resolution: RuleResolution): string {
  const knobs = Object.entries(resolution.rules)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ')
  if (!resolution.configPath) return `no .sops.yaml found — SOPS defaults (${knobs})`
  if (!resolution.match) return `${resolution.configPath}: no matching rule — SOPS defaults (${knobs})`
  const pathRegex = resolution.match.pathRegex ? `path_regex=${resolution.match.pathRegex}` : 'no path_regex'
  return `${resolution.configPath}: creation_rules[${resolution.match.index}] (${pathRegex}) → ${knobs}`
}

/** Prefer an open editor's buffer so unsaved edits are part of the diff. */
async function readText(uri: vscode.Uri, name: string): Promise<string> {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString())
  if (open) return open.getText()

  const bytes = await vscode.workspace.fs.readFile(uri)
  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`"${name}" is larger than ${MAX_BYTES / 1024 / 1024} MB.`)
  }
  if (bytes.subarray(0, BINARY_PROBE_BYTES).includes(0)) {
    throw new Error(`"${name}" looks like a binary file, so there is nothing to diff as text.`)
  }
  return new TextDecoder('utf-8').decode(bytes)
}
