import * as vscode from 'vscode'
import { NormalizedContentProvider, SCHEME, buildDiffUri } from './contentProvider'
import { loadFile, sopsPathFor, type LoadedFile } from './document'
import { initLog, log, showLog } from './log'
import { basenameOf } from './normalize'
import { decryptFile } from './sops/decrypt'

const SELECTION_CONTEXT_KEY = 'sopsDiff.hasSelectionForCompare'

let selectedForCompare: vscode.Uri | undefined

export function activate(context: vscode.ExtensionContext): void {
  initLog(context)
  const provider = new NormalizedContentProvider()

  context.subscriptions.push(
    provider,
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
    vscode.commands.registerCommand('sopsDiff.compareSelected', (clicked?: vscode.Uri, selection?: vscode.Uri[]) =>
      compareSelected(clicked, selection, false),
    ),
    vscode.commands.registerCommand(
      'sopsDiff.compareSelectedDecrypted',
      (clicked?: vscode.Uri, selection?: vscode.Uri[]) => compareSelected(clicked, selection, true),
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

async function compareSelected(clicked: vscode.Uri | undefined, selection: vscode.Uri[] | undefined, decrypt: boolean) {
  const uris = selection?.length ? selection : clicked ? [clicked] : []
  if (uris.length !== 2) {
    void vscode.window.showErrorMessage(
      `Select exactly two files to compare — ${uris.length} ${uris.length === 1 ? 'is' : 'are'} selected.`,
    )
    return
  }
  await openDiff(uris[0]!, uris[1]!, decrypt)
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
  await openDiff(selectedForCompare, uri, false)
}

async function openDiff(left: vscode.Uri, right: vscode.Uri, decrypt: boolean): Promise<void> {
  try {
    const [a, b] = await Promise.all([loadFile(left), loadFile(right)])

    if (!a.encrypted && !b.encrypted) {
      void vscode.window.showWarningMessage(
        `Neither "${a.name}" nor "${b.name}" looks SOPS-encrypted. Showing a plain diff with no masking.`,
      )
    }

    const decryptPair = decrypt && (await canDecryptPair([a, b]))
    const settings = vscode.workspace.getConfiguration('sopsDiff', left)
    // Masking cleartext values only makes sense against an encrypted counterpart:
    // doing it on two cleartext files would hide the very differences being sought,
    // and doing it once the pair is decrypted would hide the answer.
    const maskClearValues = !decryptPair && (a.encrypted || b.encrypted) && settings.get('maskClearValues', true)
    const request = { maskClearValues, decrypt: decryptPair }

    log(`\n--- ${a.name} ↔ ${b.name} (${JSON.stringify(request)}) ---`)

    await vscode.commands.executeCommand(
      'vscode.diff',
      buildDiffUri(left, request),
      buildDiffUri(right, request),
      `${a.name} ↔ ${b.name} (${decryptPair ? 'SOPS decrypted' : 'SOPS normalized'})`,
      { preview: false },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log(`Compare failed: ${message}`)
    const action = await vscode.window.showErrorMessage(`SOPS Diff: ${message}`, 'Show Log')
    if (action === 'Show Log') showLog()
  }
}

/**
 * Decryption is all-or-nothing across the pair. Letting one side decrypt while the
 * other stays masked would line real values up against placeholders and report every
 * secret as a difference — worse than not decrypting at all.
 */
async function canDecryptPair(files: readonly LoadedFile[]): Promise<boolean> {
  const encrypted = files.filter((file) => file.encrypted)
  if (encrypted.length === 0) return false

  const outcomes = await Promise.all(
    encrypted.map(async (file) => ({ file, outcome: await decryptFile(file.uri.fsPath, sopsPathFor(file.uri)) })),
  )

  const failed = outcomes.filter((entry) => !entry.outcome.ok)
  if (failed.length === 0) return true

  for (const { file, outcome } of failed) {
    if (!outcome.ok) log(`Could not decrypt ${file.name}: ${outcome.reason}`)
  }
  const [first] = failed
  const reason = first && !first.outcome.ok ? first.outcome.reason : 'unknown error'
  void vscode.window
    .showWarningMessage(
      `Could not decrypt "${first?.file.name}": ${reason} Falling back to the masked comparison.`,
      'Show Log',
    )
    .then((action) => {
      if (action === 'Show Log') showLog()
    })

  return false
}
