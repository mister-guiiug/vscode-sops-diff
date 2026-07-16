import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NormalizedContentProvider, buildDiffUri } from '../src/contentProvider'
import { resolveRulesForFile } from '../src/discovery'
import { loadFile } from '../src/document'
import { activate } from '../src/extension'
import { clearDecryptCache } from '../src/sops/decrypt'
import { fixture, FIXTURES } from './helpers'
import { Uri, executedCommands, resetStub, runCommand, setSettings, setWorkspaceRoot, shownMessages } from './vscode-stub'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

const clearFile = () => Uri.file(join(FIXTURES, 'secrets', 'values.clear.yaml'))
const encryptedFile = () => Uri.file(join(FIXTURES, 'secrets', 'values.enc.yaml'))

async function contentOf(uri: Uri, maskClearValues = true): Promise<string> {
  const provider = new NormalizedContentProvider()
  return provider.provideTextDocumentContent(buildDiffUri(uri as never, { maskClearValues, decrypt: false }) as never)
}

beforeEach(() => {
  resetStub()
  clearDecryptCache()
  execFileMock.mockReset()
  setWorkspaceRoot(FIXTURES)
  setSettings({})
})

describe('resolveRulesForFile', () => {
  it('finds the .sops.yaml above the file and matches the rule for its path', async () => {
    const resolution = await resolveRulesForFile(encryptedFile() as never)

    expect(resolution.configPath).toBe(join(FIXTURES, '.sops.yaml'))
    expect(resolution.match?.index).toBe(0)
    expect(resolution.match?.matchedPath).toBe('secrets/values.enc.yaml')
    expect(resolution.rules).toEqual({ encryptedRegex: '^(password|token|apiKey)$' })
    expect(resolution.warnings).toEqual([])
  })

  it('falls back to SOPS defaults and says so when no rule covers the file', async () => {
    const resolution = await resolveRulesForFile(Uri.file(join(FIXTURES, '.sops.yaml')) as never)

    expect(resolution.rules).toEqual({ unencryptedSuffix: '_unencrypted' })
    expect(resolution.warnings[0]).toMatch(/No creation rule/)
  })

  it('stops walking up at the workspace root', async () => {
    setWorkspaceRoot(join(FIXTURES, 'secrets'))
    const resolution = await resolveRulesForFile(encryptedFile() as never)

    expect(resolution.configPath).toBeUndefined()
    expect(resolution.rules).toEqual({ unencryptedSuffix: '_unencrypted' })
  })
})

describe('loadFile', () => {
  it('tells the encrypted file from the cleartext one', async () => {
    expect((await loadFile(encryptedFile() as never)).encrypted).toBe(true)
    expect((await loadFile(clearFile() as never)).encrypted).toBe(false)
  })

  it('refuses a folder rather than failing obscurely', async () => {
    await expect(loadFile(Uri.file(join(FIXTURES, 'secrets')) as never)).rejects.toThrow(/is a folder/)
  })
})

describe('the diff a user actually gets', () => {
  it('renders the cleartext file and its encrypted twin as the same document', async () => {
    const clear = await contentOf(clearFile())
    const encrypted = await contentOf(encryptedFile())

    expect(clear).toBe(encrypted)
    // Secrets collapse to the placeholder on both sides…
    expect(clear).toContain('password: ENC[***]')
    expect(clear).not.toContain('hunter2')
    // …while everything the creation rule leaves alone stays readable. This is what
    // proves the rule was found: under SOPS' defaults these would be masked too.
    expect(clear).toContain('host: db.internal')
    expect(clear).toContain('env: prod')
    expect(clear).toContain('- name: r1')
    // The metadata block is gone.
    expect(encrypted).not.toContain('lastmodified')
  })

  it('masks everything outside the workspace, where no rule applies', async () => {
    setWorkspaceRoot(join(FIXTURES, 'secrets'))
    const clear = await contentOf(clearFile())

    expect(clear).toContain('host: ENC[***]')
    expect(clear).toContain('password: ENC[***]')
  })

  it('honours the encryptedPlaceholder setting', async () => {
    setSettings({ encryptedPlaceholder: '<secret>' })
    const clear = await contentOf(clearFile())
    const encrypted = await contentOf(encryptedFile())

    expect(clear).toContain('password: <secret>')
    expect(encrypted).toBe(clear)
  })

  it('leaves cleartext values alone when masking is turned off', async () => {
    const clear = await contentOf(clearFile(), false)

    expect(clear).toContain('password: hunter2')
  })

  it('reports a failure inside the document instead of throwing', async () => {
    const missing = await contentOf(Uri.file(join(FIXTURES, 'does-not-exist.yaml')))

    expect(missing).toMatch(/could not normalize/i)
  })
})

/**
 * Drives the command the way the Explorer context menu does, then renders whatever
 * URIs it handed to `vscode.diff`.
 */
async function compareViaCommand(command: string, left: Uri, right: Uri) {
  activate({ subscriptions: [] } as never)
  await runCommand(command, undefined, [left, right])

  const diff = executedCommands().find((call) => call.command === 'vscode.diff')
  if (!diff) throw new Error('the command never opened a diff')

  const provider = new NormalizedContentProvider()
  const [leftUri, rightUri, title] = diff.args as [Uri, Uri, string]
  return {
    title,
    left: await provider.provideTextDocumentContent(leftUri as never),
    right: await provider.provideTextDocumentContent(rightUri as never),
  }
}

describe('Compare Selected (SOPS, decrypted)', () => {
  it('compares the real values once the pair decrypts', async () => {
    // values.enc.yaml is, by construction, the encryption of values.clear.yaml.
    execFileMock.mockImplementation((_command, _args, _options, done) =>
      done(null, fixture('secrets/values.clear.yaml'), ''),
    )

    const { title, left, right } = await compareViaCommand('sopsDiff.compareSelectedDecrypted', clearFile(), encryptedFile())

    expect(title).toContain('SOPS decrypted')
    expect(left).toBe(right)
    // The point of the feature: the secret itself is compared, not masked away.
    expect(right).toContain('password: hunter2')
    expect(right).not.toContain('ENC[')
  })

  it('shows a real difference between the two secrets', async () => {
    execFileMock.mockImplementation((_command, _args, _options, done) =>
      done(null, fixture('secrets/values.clear.yaml').replace('hunter2', 'correct-horse'), ''),
    )

    const { left, right } = await compareViaCommand('sopsDiff.compareSelectedDecrypted', clearFile(), encryptedFile())

    expect(left).toContain('password: hunter2')
    expect(right).toContain('password: correct-horse')
  })

  it('falls back to the masked comparison when sops refuses, and says why', async () => {
    execFileMock.mockImplementation((_command, _args, _options, done) =>
      done(Object.assign(new Error('Command failed'), { code: 1 }), '', 'Failed to get the data key'),
    )

    const { title, left, right } = await compareViaCommand('sopsDiff.compareSelectedDecrypted', clearFile(), encryptedFile())

    expect(title).toContain('SOPS normalized')
    expect(left).toBe(right)
    expect(left).toContain('password: ENC[***]')
    expect(shownMessages().some((m) => m.level === 'warning' && /Failed to get the data key/.test(m.text))).toBe(true)
  })

  it('decrypts each file once, not once per read', async () => {
    execFileMock.mockImplementation((_command, _args, _options, done) =>
      done(null, fixture('secrets/values.clear.yaml'), ''),
    )

    await compareViaCommand('sopsDiff.compareSelectedDecrypted', clearFile(), encryptedFile())

    // Only values.enc.yaml is encrypted, and the command plus the provider both
    // need its plaintext.
    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('leaves the plain command masking, so the two entries stay distinct', async () => {
    const { title, left } = await compareViaCommand('sopsDiff.compareSelected', clearFile(), encryptedFile())

    expect(title).toContain('SOPS normalized')
    expect(left).toContain('password: ENC[***]')
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
