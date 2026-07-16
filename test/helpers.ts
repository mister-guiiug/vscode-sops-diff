import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EncryptionRules, NormalizeOptions } from '../src/types'

export const FIXTURES = join(process.cwd(), 'test', 'fixtures')

export function fixture(relativePath: string): string {
  return readFileSync(join(FIXTURES, relativePath), 'utf8')
}

export function options(rules: EncryptionRules, overrides: Partial<NormalizeOptions> = {}): NormalizeOptions {
  return {
    rules,
    placeholder: 'ENC[***]',
    stripMetadata: true,
    maskClearValues: true,
    compareComments: false,
    ...overrides,
  }
}
