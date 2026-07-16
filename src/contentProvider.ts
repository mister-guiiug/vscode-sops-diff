import * as vscode from 'vscode'
import { normalizeFile } from './document'
import { log } from './log'
import { basenameOf } from './normalize'

export const SCHEME = 'sops-diff'

interface Payload {
  uri: string
  maskClearValues: boolean
}

/**
 * The virtual document keeps the original basename so VS Code still applies the
 * right syntax highlighting, and carries everything needed to rebuild its content
 * in the query — which keeps it working after a window reload.
 */
export function buildDiffUri(target: vscode.Uri, maskClearValues: boolean): vscode.Uri {
  const payload: Payload = { uri: target.toString(), maskClearValues }
  return vscode.Uri.from({ scheme: SCHEME, path: `/${basenameOf(target.path)}`, query: JSON.stringify(payload) })
}

export class NormalizedContentProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>()
  private readonly issued = new Map<string, vscode.Uri>()

  readonly onDidChange = this.emitter.event

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    this.issued.set(uri.toString(), uri)

    let payload: Payload
    try {
      payload = JSON.parse(uri.query) as Payload
    } catch {
      return `Could not read the SOPS Diff request from ${uri.toString()}.`
    }

    const target = vscode.Uri.parse(payload.uri)
    try {
      const normalized = await normalizeFile(target, payload.maskClearValues)
      log(
        `${normalized.file.name}: format=${normalized.file.format} ` +
          `encrypted=${normalized.file.encrypted} masked=${normalized.masked} ` +
          `metadataStripped=${normalized.metadataStripped}`,
      )
      log(`  rules → ${normalized.ruleDescription}`)
      for (const warning of normalized.warnings) log(`  warning → ${warning}`)
      return normalized.text
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log(`${target.toString()}: ${message}`)
      return `SOPS Diff could not normalize this file:\n\n${message}\n`
    }
  }

  /** Re-run normalization for every open virtual document. */
  refreshAll(): void {
    for (const uri of this.issued.values()) this.emitter.fire(uri)
  }

  dispose(): void {
    this.emitter.dispose()
    this.issued.clear()
  }
}
