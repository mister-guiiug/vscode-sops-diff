import { describe, expect, it } from 'vitest'
import { detectFormat, detectSops, normalize } from '../src/normalize'
import { DEFAULT_RULES } from '../src/sops/rules'
import { fixture, options } from './helpers'

const FIXTURE_RULES = { encryptedRegex: '^(password|token|apiKey)$' }

describe('detectFormat', () => {
  it('goes by extension', () => {
    expect(detectFormat('a/b/values.yaml', '')).toBe('yaml')
    expect(detectFormat('a/b/values.yml', '')).toBe('yaml')
    expect(detectFormat('a/b/values.json', '')).toBe('json')
    expect(detectFormat('a/b/settings.ini', '')).toBe('ini')
    expect(detectFormat('a/b/.env', '')).toBe('env')
    expect(detectFormat('a/b/.env.production', '')).toBe('env')
    expect(detectFormat('a/b/notes.txt', 'hello')).toBe('text')
  })

  it('recognises SOPS’ binary envelope whatever the extension says', () => {
    expect(detectFormat('a/b/archive.tar.gz', '{ "data": "ENC[AES256_GCM,data:x,type:str]" }')).toBe('json')
  })

  it('handles a Windows path', () => {
    expect(detectFormat('C:\\src\\secrets\\values.yaml', '')).toBe('yaml')
  })
})

describe('detectSops', () => {
  it('spots the metadata block of an encrypted file', () => {
    expect(detectSops(fixture('secrets/values.enc.yaml'), 'yaml')).toBe(true)
  })

  it('leaves a cleartext file alone', () => {
    expect(detectSops(fixture('secrets/values.clear.yaml'), 'yaml')).toBe(false)
  })

  it('does not mistake an ordinary bracket for a ciphertext', () => {
    expect(detectSops('note: see ENC[whatever] for details\n', 'yaml')).toBe(false)
  })
})

describe('normalize (yaml)', () => {
  it('renders a cleartext file and its encrypted counterpart identically', () => {
    const clear = normalize(fixture('secrets/values.clear.yaml'), 'yaml', options(FIXTURE_RULES))
    const encrypted = normalize(fixture('secrets/values.enc.yaml'), 'yaml', options(FIXTURE_RULES))

    expect(encrypted.text).toBe(clear.text)
    expect(clear.text).toContain('password: ENC[***]')
    // Values outside encrypted_regex stay visible on both sides.
    expect(clear.text).toContain('host: db.internal')
    expect(clear.text).toContain('env: prod')
  })

  it('strips the metadata block and the comments SOPS encrypted', () => {
    const encrypted = normalize(fixture('secrets/values.enc.yaml'), 'yaml', options(FIXTURE_RULES))

    expect(encrypted.metadataStripped).toBe(true)
    expect(encrypted.text).not.toContain('sops:')
    expect(encrypted.text).not.toContain('lastmodified')
    expect(encrypted.text).not.toContain('#')
    expect(encrypted.text.trimEnd().endsWith('password: ENC[***]')).toBe(true)
  })

  it('masks a value inside a sequence, which inherits the key above it', () => {
    const clear = normalize(fixture('secrets/values.clear.yaml'), 'yaml', options(FIXTURE_RULES))

    expect(clear.text).toContain('- name: r1')
    expect(clear.text).not.toContain('pw-one')
  })

  it('never masks the metadata block itself, even under the catch-all default rules', () => {
    const encrypted = normalize(
      fixture('secrets/values.enc.yaml'),
      'yaml',
      options(DEFAULT_RULES, { stripMetadata: false }),
    )

    expect(encrypted.text).toContain('version: 3.9.0')
    expect(encrypted.text).toContain('lastmodified: "2026-07-16T09:00:00Z"')
    // The ciphertext inside the metadata is still unreadable, so it is masked.
    expect(encrypted.text).toContain('mac: ENC[***]')
  })

  it('collapses the difference between a quoted and an unquoted secret', () => {
    const rules = { encryptedRegex: '^password$' }
    const single = normalize("password: 'hunter2'\n", 'yaml', options(rules))
    const double = normalize('password: "hunter2"\n', 'yaml', options(rules))
    const plain = normalize('password: hunter2\n', 'yaml', options(rules))

    expect(single.text).toBe('password: ENC[***]\n')
    expect(double.text).toBe(single.text)
    expect(plain.text).toBe(single.text)
  })

  it('leaves null and empty scalars alone, as SOPS does', () => {
    const result = normalize('password:\ntoken: null\napiKey: ""\n', 'yaml', options(FIXTURE_RULES))
    expect(result.text).toBe('password:\ntoken: null\napiKey: ""\n')
    expect(result.masked).toBe(0)
  })

  it('keeps comments when asked to compare them', () => {
    const result = normalize('# a note\npassword: hunter2\n', 'yaml', options(DEFAULT_RULES, { compareComments: true }))
    expect(result.text).toBe('# a note\npassword: ENC[***]\n')
  })

  it('masks ciphertext even where the rules claim the key is in the clear', () => {
    const result = normalize(
      'kind: Secret\npassword: ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]\n',
      'yaml',
      options({ encryptedRegex: '^nothing$' }, { maskClearValues: false }),
    )
    expect(result.text).toBe('kind: Secret\npassword: ENC[***]\n')
  })

  it('falls back to line-based handling when the YAML does not parse', () => {
    const broken = 'password: hunter2\n\tbad: indent\n'
    const result = normalize(broken, 'yaml', options({ encryptedRegex: '^password$' }))
    expect(result.text).toContain('password: ENC[***]')
  })

  it('handles a multi-document file', () => {
    const source = 'password: one\n---\npassword: two\n'
    const result = normalize(source, 'yaml', options({ encryptedRegex: '^password$' }))
    expect(result.text).toBe('password: ENC[***]\n---\npassword: ENC[***]\n')
  })
})

describe('normalize (json)', () => {
  const CLEAR = '{\n  "host": "db.internal",\n  "password": "hunter2"\n}\n'
  const ENCRYPTED =
    '{\n  "host": "db.internal",\n' +
    '  "password": "ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]",\n' +
    '  "sops": {\n' +
    '    "mac": "ENC[AES256_GCM,data:bQ==,iv:aXY=,tag:dGFn,type:str]",\n' +
    '    "version": "3.9.0"\n' +
    '  }\n}\n'

  it('renders both sides identically and drops the metadata object', () => {
    const rules = { encryptedRegex: '^password$' }
    const clear = normalize(CLEAR, 'json', options(rules))
    const encrypted = normalize(ENCRYPTED, 'json', options(rules))

    expect(clear.text).toBe('{\n  "host": "db.internal",\n  "password": "ENC[***]"\n}\n')
    expect(encrypted.text).toBe(clear.text)
    expect(encrypted.metadataStripped).toBe(true)
  })

  it('keeps the placeholder a valid JSON string when masking a number', () => {
    const result = normalize('{ "port": 5432 }', 'json', options({ encryptedRegex: '^port$' }))
    expect(result.text).toBe('{ "port": "ENC[***]" }')
  })
})

describe('normalize (env)', () => {
  it('renders both sides identically and drops the sops_ entries', () => {
    const rules = { encryptedRegex: '^DB_PASSWORD$' }
    const clear = normalize('DB_HOST=db.internal\nDB_PASSWORD=hunter2\n', 'env', options(rules))
    const encrypted = normalize(
      'DB_HOST=db.internal\n' +
        'DB_PASSWORD=ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]\n' +
        'sops_lastmodified=2026-07-16T09:00:00Z\n' +
        'sops_version=3.9.0\n',
      'env',
      options(rules),
    )

    expect(clear.text).toBe('DB_HOST=db.internal\nDB_PASSWORD=ENC[***]\n')
    expect(encrypted.text).toBe(clear.text)
  })
})

describe('normalize (ini)', () => {
  it('renders both sides identically and drops the [sops] section', () => {
    const rules = { encryptedRegex: '^password$' }
    const clear = normalize('[db]\nhost = db.internal\npassword = hunter2\n', 'ini', options(rules))
    const encrypted = normalize(
      '[db]\nhost = db.internal\n' +
        'password = ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]\n' +
        '[sops]\nversion = 3.9.0\n',
      'ini',
      options(rules),
    )

    expect(clear.text).toBe('[db]\nhost = db.internal\npassword = ENC[***]\n')
    expect(encrypted.text).toBe(clear.text)
  })

  it('scopes a rule to its section', () => {
    const rules = { encryptedRegex: '^db$' }
    const result = normalize('[db]\nhost = h\n[web]\nhost = w\n', 'ini', options(rules))
    expect(result.text).toBe('[db]\nhost = ENC[***]\n[web]\nhost = w\n')
  })
})

describe('normalize (trailing newline)', () => {
  it('keeps a trailing newline when the metadata block runs to the end of the file', () => {
    const source = '[db]\npassword = ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]\n[sops]\nversion = 3.9.0\n'
    expect(normalize(source, 'ini', options(DEFAULT_RULES)).text.endsWith('\n')).toBe(true)
  })

  it('does not invent a trailing newline the source never had', () => {
    expect(normalize('password: hunter2', 'yaml', options(DEFAULT_RULES)).text).toBe('password: ENC[***]')
  })
})

describe('normalize (text)', () => {
  it('keeps the line prefix and masks whatever follows the separator', () => {
    const rules = { encryptedRegex: 'password' }
    const clear = normalize('db.host: db.internal\ndb.password: hunter2\n', 'text', options(rules))
    const encrypted = normalize(
      'db.host: db.internal\ndb.password: ENC[AES256_GCM,data:aA==,iv:aXY=,tag:dGFn,type:str]\n',
      'text',
      options(rules),
    )

    expect(clear.text).toBe('db.host: db.internal\ndb.password: ENC[***]\n')
    expect(encrypted.text).toBe(clear.text)
  })
})
