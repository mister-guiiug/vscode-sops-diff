import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { NormalizedContentProvider, buildDiffUri } from '../src/contentProvider'
import { resolveRulesForFile } from '../src/discovery'
import { loadFile } from '../src/document'
import { FIXTURES } from './helpers'
import { Uri, setSettings, setWorkspaceRoot } from './vscode-stub'

const clearFile = () => Uri.file(join(FIXTURES, 'secrets', 'values.clear.yaml'))
const encryptedFile = () => Uri.file(join(FIXTURES, 'secrets', 'values.enc.yaml'))

async function contentOf(uri: Uri, maskClearValues = true): Promise<string> {
  const provider = new NormalizedContentProvider()
  return provider.provideTextDocumentContent(buildDiffUri(uri as never, maskClearValues) as never)
}

beforeEach(() => {
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
