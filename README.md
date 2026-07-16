# SOPS Diff

A VS Code extension that compares two files the way the built-in compare tool does — but when one of them is encrypted with [SOPS](https://github.com/getsops/sops).

Select two files in the Explorer, right-click, **Compare Selected (SOPS)**. No decryption, no keys, no `sops` binary required.

## The problem

Diffing a SOPS file against anything is useless out of the box:

```yaml
# values.dev.yaml (encrypted)          # values.prod.yaml (cleartext)
host: db.internal                      host: db.internal
password: ENC[AES256_GCM,data:8Fk…]    password: hunter2
```

Every secret shows up as a difference, the metadata block at the bottom of the encrypted file adds forty lines of noise, and two identical secrets still produce different ciphertext because each encryption uses a fresh IV. The interesting question — *do these two files have the same structure and the same non-secret values?* — is buried.

## What it does

Both files are **normalized** before being handed to VS Code's own diff editor:

| | |
|---|---|
| `ENC[AES256_GCM,data:…]` | replaced by a placeholder — ciphertext is never comparable |
| a cleartext value whose key the creation rules mark as encrypted | replaced by **the same placeholder** |
| the SOPS metadata (`sops:` key, `sops_*` entries, `[sops]` section) | removed |
| comments | removed by default, because SOPS encrypts them too |

The first two rules are the point. A line survives the diff as *identical* when everything around the placeholder — its **prefix** — matches:

```yaml
password: hunter2          →  password: ENC[***]
password: ENC[AES256…]     →  password: ENC[***]     # same prefix ⇒ no difference
```

while a genuine difference still comes through:

```yaml
host: db.internal          →  host: db.internal
host: db.staging           →  host: db.staging       # ⇒ difference
```

The two documents open in the normal diff editor, read-only. The original files are never touched.

## `.sops.yaml` support

The extension walks up from each file to the workspace root looking for `.sops.yaml` (or `.sops.yml`), then picks the creation rule the way SOPS does: **the first rule whose `path_regex` matches the file path relative to the config's directory**, with a rule that has no `path_regex` acting as a catch-all.

```yaml
creation_rules:
  - path_regex: secrets/.*\.yaml$
    encrypted_regex: ^(password|token|apiKey)$
    age: age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p
```

From the matched rule it reads `encrypted_regex`, `unencrypted_regex`, `encrypted_suffix` and `unencrypted_suffix`, and applies them with SOPS' own semantics:

- The verdict starts at **encrypted**, and each configured knob overrides it in the order above.
- A match anywhere along a key path applies to **the whole subtree** — `encrypted_regex: ^data$` encrypts `data.nested.leaf`.
- Sequence indices are not part of the path, so every item of a list inherits the verdict of the key holding it — under the rule above, `replicas[0].password` is encrypted, `replicas[0].name` is not.
- With no config, no matching rule, or a rule that sets none of the four knobs, SOPS encrypts everything except keys ending in `_unencrypted` — and so does the diff. Expect nearly every value to be masked in that case; that is faithful, since such a file really is encrypted end to end.
- `null` and empty scalars are left alone, because SOPS does not encrypt them.

The **Output → SOPS Diff** panel reports, for each file, which config and which rule were used. Start there when a diff looks wrong.

## Formats

YAML (including multi-document), JSON, `.env`, INI, and SOPS' binary envelope. Anything else falls back to a line-based pass that masks whatever follows the first `:` or `=`. A file that fails to parse falls back to the same line-based pass rather than failing the diff.

## Commands

| Command | Where |
|---|---|
| **Compare Selected (SOPS)** | right-click with exactly two files selected |
| **Select for Compare (SOPS)** / **Compare with Selected (SOPS)** | right-click, two steps, mirroring the built-in pair |

## Settings

| Setting | Default | |
|---|---|---|
| `sopsDiff.encryptedPlaceholder` | `ENC[***]` | what replaces every masked value |
| `sopsDiff.stripMetadata` | `true` | drop the SOPS metadata block |
| `sopsDiff.maskClearValues` | `true` | mask cleartext values the rules mark as encrypted; only ever applied when one of the two files is encrypted |
| `sopsDiff.compareComments` | `false` | keep comments in the diff |

## Limitations

- **Ciphertext is opaque.** Two files whose secrets differ but whose structure matches will show as identical. The extension tells you the *comparable* parts agree — it cannot tell you the secrets do.
- **Formatting is a difference.** Normalization edits values in place and does not reformat. SOPS re-emits YAML with 4-space indentation, so a hand-written 2-space file compared against a SOPS file will differ on indentation. Compare two SOPS files, or match the indentation.
- `encrypted_comment_regex` / `unencrypted_comment_regex` are not read; comments are governed by `sopsDiff.compareComments` instead.
- Files over 5 MB and binary files are rejected.

## Development

```bash
npm install
npm test          # vitest — pure logic plus an end-to-end pass over test/fixtures
npm run typecheck
npm run build     # esbuild bundle into dist/
```

`F5` launches an extension host on `test/fixtures`, which holds a `.sops.yaml` and a cleartext/encrypted pair to try the command on.

## License

MIT
