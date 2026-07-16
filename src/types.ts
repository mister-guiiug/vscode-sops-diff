/**
 * The four knobs a SOPS creation rule can use to decide which key paths get
 * encrypted. SOPS itself rejects a rule that sets more than one of them.
 */
export interface EncryptionRules {
  encryptedRegex?: string
  unencryptedRegex?: string
  encryptedSuffix?: string
  unencryptedSuffix?: string
}

export interface NormalizeOptions {
  rules: EncryptionRules
  placeholder: string
  stripMetadata: boolean
  /** Mask cleartext values that `rules` say would be encrypted. */
  maskClearValues: boolean
  compareComments: boolean
}

export interface NormalizeResult {
  text: string
  /** Number of values replaced by the placeholder. */
  masked: number
  metadataStripped: boolean
}
