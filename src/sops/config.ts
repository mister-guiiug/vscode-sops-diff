import { parse as parseYaml } from 'yaml'
import type { EncryptionRules } from '../types'
import { compileGoRegex, DEFAULT_UNENCRYPTED_SUFFIX } from './rules'

export interface CreationRule {
  path_regex?: string
  encrypted_regex?: string
  unencrypted_regex?: string
  encrypted_suffix?: string
  unencrypted_suffix?: string
}

export interface SopsConfigFile {
  creation_rules?: CreationRule[]
}

export interface RuleMatch {
  /** Position of the rule in `creation_rules`, for reporting. */
  index: number
  pathRegex?: string
  /** Which of the candidate paths the rule's `path_regex` matched. */
  matchedPath?: string
  rules: EncryptionRules
  warnings: string[]
}

export function parseSopsConfig(text: string): SopsConfigFile | undefined {
  const parsed: unknown = parseYaml(text)
  if (!parsed || typeof parsed !== 'object') return undefined
  const rules = (parsed as SopsConfigFile).creation_rules
  if (!Array.isArray(rules)) return { creation_rules: undefined }
  return { creation_rules: rules.filter((r): r is CreationRule => !!r && typeof r === 'object') }
}

/** Translate one creation rule into the subset of it that drives our masking. */
export function rulesFromCreationRule(rule: CreationRule): { rules: EncryptionRules; warnings: string[] } {
  const warnings: string[] = []
  const rules: EncryptionRules = {}
  if (rule.encrypted_regex) rules.encryptedRegex = rule.encrypted_regex
  if (rule.unencrypted_regex) rules.unencryptedRegex = rule.unencrypted_regex
  if (rule.encrypted_suffix) rules.encryptedSuffix = rule.encrypted_suffix
  if (rule.unencrypted_suffix) rules.unencryptedSuffix = rule.unencrypted_suffix

  const knobs = Object.keys(rules).length
  if (knobs > 1) {
    warnings.push(
      'This creation rule sets more than one of encrypted_regex / unencrypted_regex / ' +
        'encrypted_suffix / unencrypted_suffix. SOPS rejects such a rule outright; the diff ' +
        'applies them in SOPS’ evaluation order instead.',
    )
  }
  if (knobs === 0) rules.unencryptedSuffix = DEFAULT_UNENCRYPTED_SUFFIX

  for (const [name, source] of [
    ['encrypted_regex', rules.encryptedRegex],
    ['unencrypted_regex', rules.unencryptedRegex],
  ] as const) {
    if (!source) continue
    try {
      compileGoRegex(source)
    } catch (err) {
      warnings.push(`${name} is not a valid regular expression and will be ignored: ${String(err)}`)
      if (name === 'encrypted_regex') delete rules.encryptedRegex
      else delete rules.unencryptedRegex
    }
  }

  return { rules, warnings }
}

/**
 * SOPS picks the first creation rule whose `path_regex` matches the file path
 * taken relative to the directory holding `.sops.yaml`, and a rule without a
 * `path_regex` matches everything.
 *
 * `candidates` normally holds the same path twice — once with `/` separators and
 * once with the platform's. SOPS only ever tests the native form, so on Windows a
 * `path_regex` written the usual way (`k8s/.*\.yaml$`) would never match. Testing
 * both keeps such a config working here.
 */
export function resolveRuleForPath(config: SopsConfigFile, candidates: readonly string[]): RuleMatch | undefined {
  const creationRules = config.creation_rules
  if (!creationRules?.length) return undefined

  for (let index = 0; index < creationRules.length; index++) {
    const rule = creationRules[index]!
    const { rules, warnings } = rulesFromCreationRule(rule)

    if (!rule.path_regex) {
      return { index, rules, warnings }
    }

    let re: RegExp
    try {
      re = compileGoRegex(rule.path_regex)
    } catch (err) {
      warnings.push(`path_regex of rule #${index} is not a valid regular expression: ${String(err)}`)
      continue
    }

    const matchedPath = candidates.find((candidate) => re.test(candidate))
    if (matchedPath !== undefined) {
      return { index, pathRegex: rule.path_regex, matchedPath, rules, warnings }
    }
  }

  return undefined
}
