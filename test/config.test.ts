import { describe, expect, it } from 'vitest'
import { parseSopsConfig, resolveRuleForPath, rulesFromCreationRule } from '../src/sops/config'
import { fixture } from './helpers'

const CONFIG = `
creation_rules:
  - path_regex: secrets/.*\\.dev\\.yaml$
    encrypted_regex: ^(password|token)$
  - path_regex: \\.env$
    unencrypted_suffix: _public
  - kms: arn:aws:kms:eu-west-1:000:key/abc
`

describe('resolveRuleForPath', () => {
  const config = parseSopsConfig(CONFIG)!

  it('takes the first rule whose path_regex matches', () => {
    const match = resolveRuleForPath(config, ['secrets/app.dev.yaml'])
    expect(match?.index).toBe(0)
    expect(match?.rules).toEqual({ encryptedRegex: '^(password|token)$' })
  })

  it('falls through to a later rule when the first does not match', () => {
    const match = resolveRuleForPath(config, ['app/.env'])
    expect(match?.index).toBe(1)
    expect(match?.rules).toEqual({ unencryptedSuffix: '_public' })
  })

  it('treats a rule without path_regex as a catch-all', () => {
    const match = resolveRuleForPath(config, ['anything/else.txt'])
    expect(match?.index).toBe(2)
  })

  it('matches a path_regex written with forward slashes against a Windows path', () => {
    const match = resolveRuleForPath(config, ['secrets/app.dev.yaml', 'secrets\\app.dev.yaml'])
    expect(match?.index).toBe(0)
    expect(match?.matchedPath).toBe('secrets/app.dev.yaml')
  })

  it('returns nothing when no rule matches and none is a catch-all', () => {
    const narrow = parseSopsConfig('creation_rules:\n  - path_regex: \\.enc\\.yaml$\n')!
    expect(resolveRuleForPath(narrow, ['plain.yaml'])).toBeUndefined()
  })
})

describe('rulesFromCreationRule', () => {
  it('applies SOPS’ default unencrypted suffix when the rule sets no knob', () => {
    const { rules, warnings } = rulesFromCreationRule({ path_regex: '.*' })
    expect(rules).toEqual({ unencryptedSuffix: '_unencrypted' })
    expect(warnings).toEqual([])
  })

  it('warns when a rule combines knobs that SOPS would reject', () => {
    const { warnings } = rulesFromCreationRule({ encrypted_regex: '^a$', unencrypted_suffix: '_pub' })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/more than one/)
  })

  it('drops an unusable regex instead of failing the diff', () => {
    const { rules, warnings } = rulesFromCreationRule({ encrypted_regex: '^(unclosed' })
    expect(rules.encryptedRegex).toBeUndefined()
    expect(warnings[0]).toMatch(/not a valid regular expression/)
  })
})

describe('parseSopsConfig', () => {
  it('reads the checked-in fixture config', () => {
    const config = parseSopsConfig(fixture('.sops.yaml'))
    expect(config?.creation_rules).toHaveLength(2)
    expect(resolveRuleForPath(config!, ['secrets/values.enc.yaml'])?.rules).toEqual({
      encryptedRegex: '^(password|token|apiKey)$',
    })
  })

  it('survives a config that is not a mapping', () => {
    expect(parseSopsConfig('')).toBeUndefined()
    expect(parseSopsConfig('- a\n- b')?.creation_rules).toBeUndefined()
  })
})
