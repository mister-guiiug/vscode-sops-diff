import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, compileGoRegex, isEncryptableValue, isPathEncrypted } from '../src/sops/rules'

describe('isPathEncrypted', () => {
  it('encrypts everything but the _unencrypted suffix when no rule is configured', () => {
    expect(isPathEncrypted(['password'], DEFAULT_RULES)).toBe(true)
    expect(isPathEncrypted(['metadata', 'name'], DEFAULT_RULES)).toBe(true)
    expect(isPathEncrypted(['api_key_unencrypted'], DEFAULT_RULES)).toBe(false)
    expect(isPathEncrypted(['config_unencrypted', 'nested'], DEFAULT_RULES)).toBe(false)
  })

  it('applies an encrypted_regex match to the whole subtree below it', () => {
    const rules = { encryptedRegex: '^data$' }
    expect(isPathEncrypted(['data'], rules)).toBe(true)
    expect(isPathEncrypted(['data', 'nested', 'leaf'], rules)).toBe(true)
    expect(isPathEncrypted(['metadata', 'name'], rules)).toBe(false)
  })

  it('treats everything outside unencrypted_regex as encrypted', () => {
    const rules = { unencryptedRegex: '^(apiVersion|kind|metadata)$' }
    expect(isPathEncrypted(['metadata', 'name'], rules)).toBe(false)
    expect(isPathEncrypted(['data', 'password'], rules)).toBe(true)
  })

  it('honours encrypted_suffix and unencrypted_suffix', () => {
    expect(isPathEncrypted(['db_secret'], { encryptedSuffix: '_secret' })).toBe(true)
    expect(isPathEncrypted(['db_public'], { encryptedSuffix: '_secret' })).toBe(false)
    expect(isPathEncrypted(['db_public'], { unencryptedSuffix: '_public' })).toBe(false)
    expect(isPathEncrypted(['db_secret'], { unencryptedSuffix: '_public' })).toBe(true)
  })

  it('lets encrypted_regex win over unencrypted_regex, as SOPS evaluation order does', () => {
    const rules = { unencryptedRegex: '^data$', encryptedRegex: '^data$' }
    expect(isPathEncrypted(['data'], rules)).toBe(true)
  })

  it('ignores sequence indices because SOPS does not put them in the path', () => {
    const rules = { encryptedRegex: '^password$' }
    // `replicas[0].password` reaches us as ['replicas', 'password'].
    expect(isPathEncrypted(['replicas', 'password'], rules)).toBe(true)
    expect(isPathEncrypted(['replicas', 'name'], rules)).toBe(false)
  })
})

describe('compileGoRegex', () => {
  it('translates Go’s inline (?i) flag, which JavaScript does not support', () => {
    expect(compileGoRegex('(?i)^password$').test('PASSWORD')).toBe(true)
    expect(compileGoRegex('^password$').test('PASSWORD')).toBe(false)
  })

  it('leaves an ordinary pattern alone', () => {
    expect(compileGoRegex('^(password|token)$').test('token')).toBe(true)
  })
})

describe('isEncryptableValue', () => {
  it('rejects the values SOPS leaves in the clear', () => {
    expect(isEncryptableValue(null)).toBe(false)
    expect(isEncryptableValue('')).toBe(false)
    expect(isEncryptableValue(undefined)).toBe(false)
  })

  it('accepts scalars SOPS would encrypt', () => {
    expect(isEncryptableValue('hunter2')).toBe(true)
    expect(isEncryptableValue(0)).toBe(true)
    expect(isEncryptableValue(false)).toBe(true)
  })
})
