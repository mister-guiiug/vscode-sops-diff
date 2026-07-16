import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearDecryptCache, decryptFile } from '../src/sops/decrypt'
import { FIXTURES } from './helpers'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

type Callback = (error: unknown, stdout: string, stderr: string) => void

const ENCRYPTED = join(FIXTURES, 'secrets', 'values.enc.yaml')

function succeedWith(stdout: string): void {
  execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, done: Callback) =>
    done(null, stdout, ''),
  )
}

function failWith(error: object, stderr = ''): void {
  execFileMock.mockImplementation((_command: string, _args: string[], _options: unknown, done: Callback) =>
    done(error, '', stderr),
  )
}

beforeEach(() => {
  clearDecryptCache()
  execFileMock.mockReset()
})

describe('decryptFile', () => {
  it('asks sops to decrypt the file and hands back its stdout', async () => {
    succeedWith('password: hunter2\n')
    const outcome = await decryptFile(ENCRYPTED, 'sops')

    expect(outcome).toEqual({ ok: true, text: 'password: hunter2\n' })

    const [command, args, options] = execFileMock.mock.calls[0]!
    expect(command).toBe('sops')
    // No --input-type: SOPS inferred the format from the extension when encrypting,
    // so letting it infer again is what round-trips the file.
    expect(args).toEqual(['-d', ENCRYPTED])
    expect((options as { cwd: string }).cwd).toBe(join(FIXTURES, 'secrets'))
  })

  it('surfaces what sops printed when it refuses to decrypt', async () => {
    failWith(Object.assign(new Error('Command failed'), { code: 1 }), 'Failed to get the data key required to decrypt')
    const outcome = await decryptFile(ENCRYPTED, 'sops')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toBe('Failed to get the data key required to decrypt')
  })

  it('turns a missing binary into advice rather than an ENOENT', async () => {
    failWith(Object.assign(new Error('spawn sops ENOENT'), { code: 'ENOENT' }))
    const outcome = await decryptFile(ENCRYPTED, 'sops')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/not found.*sopsDiff\.sopsPath/)
  })

  it('explains a timeout as a possible passphrase prompt', async () => {
    failWith(Object.assign(new Error('killed'), { killed: true }))
    const outcome = await decryptFile(ENCRYPTED, 'sops')

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/still running after 30s.*passphrase/)
  })

  it('caps a runaway error message', async () => {
    failWith(Object.assign(new Error('boom'), { code: 1 }), 'x'.repeat(1000))
    const outcome = await decryptFile(ENCRYPTED, 'sops')

    if (!outcome.ok) expect(outcome.reason.length).toBeLessThanOrEqual(301)
  })
})

describe('the decryption cache', () => {
  it('decrypts once for the two reads a single comparison makes', async () => {
    succeedWith('password: hunter2\n')

    await decryptFile(ENCRYPTED, 'sops')
    await decryptFile(ENCRYPTED, 'sops')

    expect(execFileMock).toHaveBeenCalledTimes(1)
  })

  it('does not hold plaintext across a refresh', async () => {
    succeedWith('password: hunter2\n')
    await decryptFile(ENCRYPTED, 'sops')

    clearDecryptCache()
    await decryptFile(ENCRYPTED, 'sops')

    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('keys on the binary, so changing sopsPath re-runs', async () => {
    succeedWith('password: hunter2\n')

    await decryptFile(ENCRYPTED, 'sops')
    await decryptFile(ENCRYPTED, '/opt/sops')

    expect(execFileMock).toHaveBeenCalledTimes(2)
  })

  it('never caches a failure, so fixing a key setup takes effect right away', async () => {
    failWith(Object.assign(new Error('nope'), { code: 1 }), 'no key')
    expect((await decryptFile(ENCRYPTED, 'sops')).ok).toBe(false)

    succeedWith('password: hunter2\n')
    expect(await decryptFile(ENCRYPTED, 'sops')).toEqual({ ok: true, text: 'password: hunter2\n' })
    expect(execFileMock).toHaveBeenCalledTimes(2)
  })
})
