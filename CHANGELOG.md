# Changelog

## Unreleased

- **Compare Selected (SOPS, decrypted)**: a second Explorer command that runs `sops -d` with your keys and diffs the real values, for when masking cannot answer whether two secrets match. Decryption is all-or-nothing across the pair, and falls back to the masked comparison — with a notification saying why — when a file will not decrypt. The plain command is unchanged and still never decrypts.
- Setting: `sopsDiff.sopsPath`.

## 0.1.0

Initial release.

- Compare two files from the Explorer context menu, one of them SOPS-encrypted, without decrypting anything.
- Ciphertext and the cleartext values the creation rules mark as encrypted collapse to a shared placeholder, so a line counts as identical when its prefix matches.
- `.sops.yaml` discovery by walking up to the workspace root, with SOPS' own rule selection (`path_regex`, first match wins, catch-all last) and encryption semantics (`encrypted_regex`, `unencrypted_regex`, `encrypted_suffix`, `unencrypted_suffix`, subtree inheritance, `_unencrypted` default).
- SOPS metadata and encrypted comments removed from the diff.
- YAML (multi-document), JSON, `.env`, INI and SOPS' binary envelope, with a line-based fallback for everything else.
- Settings: `encryptedPlaceholder`, `stripMetadata`, `maskClearValues`, `compareComments`.
