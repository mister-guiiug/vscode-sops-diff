import * as vscode from 'vscode'
import { NormalizedContentProvider, SCHEME, buildDiffUri } from './contentProvider'
import { loadFile } from './document'
import { initLog, log, showLog } from './log'
import { basenameOf } from './normalize'

const SELECTION_CONTEXT_KEY = 'sopsDiff.hasSelectionForCompare'

let selectedForCompare: vscode.Uri | undefined

export function activate(context: vscode.ExtensionContext): void {
  initLog(context)
  const provider = new NormalizedContentProvider()

  context.subscriptions.push(
    provider,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('sopsDiff.compareSelected', (clicked?: vscode.Uri, selection?: vscode.Uri[]) =>
      compareSelected(clicked, selection),
    ),
    vscode.commands.registerCommand('sopsDiff.selectForCompare', selectForCompare),
    vscode.commands.registerCommand('sopsDiff.compareWithSelected', compareWithSelected),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('sopsDiff')) provider.refreshAll()
    }),
    vscode.workspace.onDidSaveTextDocument(() => provider.refreshAll()),
  )
}

export function deactivate(): void {
  selectedForCompare = undefined
}

async function compareSelected(clicked?: vscode.Uri, selection?: vscode.Uri[]): Promise<void> {
  const uris = selection?.length ? selection : clicked ? [clicked] : []
  if (uris.length !== 2) {
    void vscode.window.showErrorMessage(
      `Select exactly two files to compare — ${uris.length} ${uris.length === 1 ? 'is' : 'are'} selected.`,
    )
    return
  }
  await openDiff(uris[0]!, uris[1]!)
}

function selectForCompare(uri?: vscode.Uri): void {
  if (!uri) return
  selectedForCompare = uri
  void vscode.commands.executeCommand('setContext', SELECTION_CONTEXT_KEY, true)
  vscode.window.setStatusBarMessage(`SOPS Diff: "${basenameOf(uri.path)}" selected for compare`, 4000)
}

async function compareWithSelected(uri?: vscode.Uri): Promise<void> {
  if (!uri) return
  if (!selectedForCompare) {
    void vscode.window.showErrorMessage('Pick a file with "Select for Compare (SOPS)" first.')
    return
  }
  await openDiff(selectedForCompare, uri)
}

async function openDiff(left: vscode.Uri, right: vscode.Uri): Promise<void> {
  try {
    const [a, b] = await Promise.all([loadFile(left), loadFile(right)])

    if (!a.encrypted && !b.encrypted) {
      void vscode.window.showWarningMessage(
        `Neither "${a.name}" nor "${b.name}" looks SOPS-encrypted. Showing a plain diff with no masking.`,
      )
    }

    const settings = vscode.workspace.getConfiguration('sopsDiff', left)
    // Masking cleartext values only makes sense against an encrypted counterpart;
    // doing it on two cleartext files would hide the very differences being sought.
    const maskClearValues = (a.encrypted || b.encrypted) && settings.get('maskClearValues', true)

    log(`\n--- ${a.name} ↔ ${b.name} (maskClearValues=${maskClearValues}) ---`)

    await vscode.commands.executeCommand(
      'vscode.diff',
      buildDiffUri(left, maskClearValues),
      buildDiffUri(right, maskClearValues),
      `${a.name} ↔ ${b.name} (SOPS normalized)`,
      { preview: false },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`Compare failed: ${message}`)
    const action = await vscode.window.showErrorMessage(`SOPS Diff: ${message}`, 'Show Log')
    if (action === 'Show Log') showLog()
  }
}
