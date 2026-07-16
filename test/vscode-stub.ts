/**
 * The slice of the VS Code API the extension actually touches, backed by the real
 * filesystem. `vitest.config.ts` aliases `vscode` here so the glue between the
 * commands, the config discovery and the normalisers can be tested outside an
 * extension host.
 */
import { readFileSync, statSync } from 'node:fs'
import * as nodePath from 'node:path'

export class Uri {
  constructor(
    readonly scheme: string,
    readonly path: string,
    readonly query = '',
  ) {}

  static file(filePath: string): Uri {
    const posix = filePath.replace(/\\/g, '/')
    return new Uri('file', posix.startsWith('/') ? posix : `/${posix}`)
  }

  static from(parts: { scheme: string; path?: string; query?: string }): Uri {
    return new Uri(parts.scheme, parts.path ?? '', parts.query ?? '')
  }

  static parse(value: string): Uri {
    const match = /^([a-zA-Z][\w+.-]*):\/\/([^?]*)(?:\?(.*))?$/.exec(value)
    if (!match) return new Uri('file', value)
    return new Uri(match[1]!, match[2]!, match[3] ?? '')
  }

  static joinPath(uri: Uri, ...segments: string[]): Uri {
    return new Uri(uri.scheme, nodePath.posix.normalize(nodePath.posix.join(uri.path, ...segments)), uri.query)
  }

  get fsPath(): string {
    const withoutLeadingSlash = /^\/[A-Za-z]:/.test(this.path) ? this.path.slice(1) : this.path
    return nodePath.sep === '\\' ? withoutLeadingSlash.replace(/\//g, '\\') : withoutLeadingSlash
  }

  toString(): string {
    return `${this.scheme}://${this.path}${this.query ? `?${this.query}` : ''}`
  }
}

export const FileType = { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 } as const

export class EventEmitter<T> {
  private readonly listeners: ((value: T) => void)[] = []

  readonly event = (listener: (value: T) => void) => {
    this.listeners.push(listener)
    return { dispose: () => {} }
  }

  fire(value: T): void {
    for (const listener of this.listeners) listener(value)
  }

  dispose(): void {
    this.listeners.length = 0
  }
}

let workspaceRoot: string | undefined
let settings: Record<string, unknown> = {}

/** Bound the `.sops.yaml` walk-up the way an open folder would. */
export function setWorkspaceRoot(root: string | undefined): void {
  workspaceRoot = root
}

export function setSettings(values: Record<string, unknown>): void {
  settings = values
}

export const workspace = {
  textDocuments: [] as { uri: Uri; getText(): string }[],

  fs: {
    async stat(uri: Uri): Promise<{ type: number }> {
      const stats = statSync(uri.fsPath)
      return { type: stats.isDirectory() ? FileType.Directory : FileType.File }
    },
    async readFile(uri: Uri): Promise<Uint8Array> {
      return new Uint8Array(readFileSync(uri.fsPath))
    },
  },

  getWorkspaceFolder(_uri: Uri): { uri: Uri } | undefined {
    return workspaceRoot ? { uri: Uri.file(workspaceRoot) } : undefined
  },

  getConfiguration(_section?: string, _scope?: unknown) {
    return {
      get<T>(key: string, fallback: T): T {
        return (settings[key] as T) ?? fallback
      },
    }
  },

  registerTextDocumentContentProvider: () => ({ dispose: () => {} }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
  onDidSaveTextDocument: () => ({ dispose: () => {} }),
}

export const window = {
  createOutputChannel: () => ({ appendLine: () => {}, show: () => {}, dispose: () => {} }),
  showErrorMessage: async () => undefined,
  showWarningMessage: () => undefined,
  setStatusBarMessage: () => undefined,
}

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
  executeCommand: async () => undefined,
}
