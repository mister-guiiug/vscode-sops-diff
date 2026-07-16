/**
 * decrypt.test.ts mocks child_process, which proves the logic but not that the
 * error shapes it reads are the ones Node really produces. These tests spawn real
 * processes. No `sops` is involved — a stub script stands in for it.
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { clearDecryptCache, decryptFile } from '../src/sops/decrypt'
import { FIXTURES } from './helpers'

const ENCRYPTED = join(FIXTURES, 'secrets', 'values.enc.yaml')

beforeEach(() => {
  clearDecryptCache()
})

describe('decryptFile against real processes', () => {
  it('reports a missing binary in terms the user can act on', async () => {
    const outcome = await decryptFile(ENCRYPTED, 'sops-that-does-not-exist-4f3a')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/was not found[\s\S]*sopsDiff\.sopsPath/)
  })

  // Windows has no way to make an executable stub without shipping a binary, and
  // Node refuses to spawn .cmd/.bat without a shell.
  it.skipIf(process.platform === 'win32')('runs the binary and returns its stdout', async () => {
    const script = join(mkdtempSync(join(tmpdir(), 'sops-diff-')), 'fake-sops')
    writeFileSync(script, '#!/bin/sh\necho "decrypted: $2"\n')
    chmodSync(script, 0o755)

    const outcome = await decryptFile(ENCRYPTED, script)

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.text.trim()).toBe(`decrypted: ${ENCRYPTED}`)
  })

  it.skipIf(process.platform === 'win32')('reports a non-zero exit with the binary’s own stderr', async () => {
    const script = join(mkdtempSync(join(tmpdir(), 'sops-diff-')), 'fake-sops')
    writeFileSync(script, '#!/bin/sh\necho "Failed to get the data key" >&2\nexit 1\n')
    chmodSync(script, 0o755)

    const outcome = await decryptFile(ENCRYPTED, script)

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('Failed to get the data key')
  })
})
