import * as vscode from 'vscode'

let channel: vscode.OutputChannel | undefined

export function initLog(context: vscode.ExtensionContext): void {
  channel = vscode.window.createOutputChannel('SOPS Diff')
  context.subscriptions.push(channel)
}

export function log(message: string): void {
  channel?.appendLine(message)
}

export function showLog(): void {
  channel?.show(true)
}
