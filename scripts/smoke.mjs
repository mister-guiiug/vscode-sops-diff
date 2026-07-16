/**
 * `npm run build` happily emits a bundle that cannot be loaded — a dependency
 * whose inner require() calls esbuild could not resolve leaves them dynamic, and
 * the extension only dies once VS Code activates it. Load the built bundle against
 * a stub `vscode` module and activate it, so that failure surfaces in CI instead.
 */
import Module, { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const registered = []
const disposable = { dispose() {} }

const vscodeStub = {
  window: {
    createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
    showErrorMessage: async () => undefined,
    showWarningMessage() {},
    setStatusBarMessage() {},
  },
  workspace: {
    registerTextDocumentContentProvider: (scheme) => {
      registered.push(`scheme:${scheme}`)
      return disposable
    },
    onDidChangeConfiguration: () => disposable,
    onDidSaveTextDocument: () => disposable,
    getConfiguration: () => ({ get: (_key, fallback) => fallback }),
    textDocuments: [],
    fs: {},
    getWorkspaceFolder: () => undefined,
  },
  commands: {
    registerCommand: (id) => {
      registered.push(`command:${id}`)
      return disposable
    },
    executeCommand: async () => undefined,
  },
  EventEmitter: class {
    constructor() {
      this.event = () => disposable
    }
    fire() {}
    dispose() {}
  },
  Uri: { from: (parts) => parts, parse: (value) => value, joinPath: () => ({ fsPath: '' }) },
  FileType: { File: 1, Directory: 2 },
}

const originalLoad = Module._load
Module._load = function (request, ...rest) {
  if (request === 'vscode') return vscodeStub
  return originalLoad.call(this, request, ...rest)
}

const extension = require(join(root, 'dist', 'extension.js'))
if (typeof extension.activate !== 'function') throw new Error('dist/extension.js does not export activate')
if (typeof extension.deactivate !== 'function') throw new Error('dist/extension.js does not export deactivate')

const context = { subscriptions: [] }
extension.activate(context)

const manifest = require(join(root, 'package.json'))
const declared = manifest.contributes.commands.map((command) => command.command)

const missing = declared.filter((id) => !registered.includes(`command:${id}`))
if (missing.length) throw new Error(`package.json declares commands the code never registers: ${missing.join(', ')}`)

const referenced = new Set(
  Object.values(manifest.contributes.menus)
    .flat()
    .map((item) => item.command),
)
const undeclared = [...referenced].filter((id) => !declared.includes(id))
if (undeclared.length) throw new Error(`menus reference undeclared commands: ${undeclared.join(', ')}`)

extension.deactivate()

console.log(`bundle activates, ${declared.length} commands registered: ${declared.join(', ')}`)
