import * as path from 'node:path'
import * as vscode from 'vscode'
import { parseSopsConfig, resolveRuleForPath, type RuleMatch } from './sops/config'
import { DEFAULT_RULES } from './sops/rules'
import type { EncryptionRules } from './types'

const CONFIG_NAMES = ['.sops.yaml', '.sops.yml']
const MAX_LEVELS = 32

export interface RuleResolution {
  rules: EncryptionRules
  configPath?: string
  match?: RuleMatch
  warnings: string[]
}

/**
 * Find the `.sops.yaml` that governs `uri` and work out which creation rule it
 * would apply, mirroring what SOPS does when it encrypts the file: walk up from
 * the file, take the first config found, and match the file path relative to it.
 *
 * With no config — or no rule matching the path — SOPS falls back to encrypting
 * everything except keys ending in `_unencrypted`, and so do we.
 */
export async function resolveRulesForFile(uri: vscode.Uri): Promise<RuleResolution> {
  const configUri = await findConfig(uri)
  if (!configUri) return { rules: DEFAULT_RULES, warnings: [] }

  const configPath = configUri.fsPath
  let text: string
  try {
    text = new TextDecoder().decode(await vscode.workspace.fs.readFile(configUri))
  } catch (err) {
    return { rules: DEFAULT_RULES, configPath, warnings: [`Could not read ${configPath}: ${String(err)}`] }
  }

  let config
  try {
    config = parseSopsConfig(text)
  } catch (err) {
    return { rules: DEFAULT_RULES, configPath, warnings: [`${configPath} is not valid YAML: ${String(err)}`] }
  }
  if (!config?.creation_rules?.length) {
    return { rules: DEFAULT_RULES, configPath, warnings: [`${configPath} declares no creation_rules.`] }
  }

  const native = path.relative(path.dirname(configPath), uri.fsPath)
  const posix = native.split(path.sep).join('/')
  const match = resolveRuleForPath(config, native === posix ? [posix] : [posix, native])
  if (!match) {
    return {
      rules: DEFAULT_RULES,
      configPath,
      warnings: [`No creation rule in ${configPath} matches "${posix}"; using SOPS' default rules.`],
    }
  }

  return { rules: match.rules, configPath, match, warnings: match.warnings }
}

async function findConfig(uri: vscode.Uri): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri)
  const stopAt = workspaceFolder ? path.resolve(workspaceFolder.uri.fsPath) : undefined

  let dir = vscode.Uri.joinPath(uri, '..')
  for (let level = 0; level < MAX_LEVELS; level++) {
    for (const name of CONFIG_NAMES) {
      const candidate = vscode.Uri.joinPath(dir, name)
      try {
        const stat = await vscode.workspace.fs.stat(candidate)
        if (stat.type & vscode.FileType.File) return candidate
      } catch {
        // Not here; keep walking up.
      }
    }

    const current = path.resolve(dir.fsPath)
    if (stopAt && current === stopAt) return undefined
    const parent = vscode.Uri.joinPath(dir, '..')
    if (path.resolve(parent.fsPath) === current) return undefined
    dir = parent
  }
  return undefined
}
