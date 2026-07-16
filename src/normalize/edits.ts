export interface Edit {
  start: number
  end: number
  replacement: string
}

/** A SOPS ciphertext scalar, e.g. `ENC[AES256_GCM,data:…,iv:…,tag:…,type:str]`. */
const ENC_SOURCE = String.raw`ENC\[[A-Z0-9_]+,data:[^\]\n]*\]`

export function containsEnc(text: string): boolean {
  return new RegExp(ENC_SOURCE).test(text)
}

/** Replace every literal ciphertext left in `text`, whatever the creation rules say. */
export function maskEncLiterals(text: string, placeholder: string): { text: string; masked: number } {
  let masked = 0
  const out = text.replace(new RegExp(ENC_SOURCE, 'g'), () => {
    masked++
    return placeholder
  })
  return { text: out, masked }
}

/** Grow a range to cover the whole lines it touches, so removing it leaves no blank line behind. */
export function expandToWholeLines(text: string, start: number, end: number): { start: number; end: number } {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const outStart = /^[ \t]*$/.test(text.slice(lineStart, start)) ? lineStart : start
  const nextEol = text.indexOf('\n', end)
  const outEnd = nextEol === -1 ? text.length : nextEol + 1
  return { start: outStart, end: outEnd }
}

/**
 * An edit that deletes a comment: a comment sitting alone takes its line with it,
 * a trailing comment takes only the whitespace that separated it from the value.
 */
export function commentEdit(text: string, start: number, end: number): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    const nextEol = text.indexOf('\n', end)
    return { start: lineStart, end: nextEol === -1 ? text.length : nextEol + 1, replacement: '' }
  }
  let from = start
  while (from > lineStart && /[ \t]/.test(text[from - 1]!)) from--
  return { start: from, end, replacement: '' }
}

/**
 * Apply edits left to right, dropping any that overlap one already applied. That
 * is what lets a metadata removal swallow the masks and comments nested inside it
 * without the caller having to track containment.
 */
export function applyEdits(text: string, edits: readonly Edit[]): string {
  const sorted = [...edits].sort((a, b) => a.start - b.start || b.end - a.end)
  const out: string[] = []
  let cursor = 0
  for (const edit of sorted) {
    if (edit.start < cursor) continue
    out.push(text.slice(cursor, edit.start), edit.replacement)
    cursor = edit.end
  }
  out.push(text.slice(cursor))
  return out.join('')
}

/**
 * Restore the source's trailing-newline state. Removing a block that runs to the
 * end of the file — a `[sops]` section, say — otherwise takes the final newline
 * with it and turns the last line into a difference of its own.
 */
export function matchTrailingNewline(source: string, output: string): string {
  if (!output || !source.endsWith('\n') || output.endsWith('\n')) return output
  return `${output}\n`
}

/** Split on `\n` while keeping track of a `\r` that belongs to the line ending. */
export function splitLines(text: string): { body: string; cr: string }[] {
  return text.split('\n').map((line) => {
    const hasCr = line.endsWith('\r')
    return { body: hasCr ? line.slice(0, -1) : line, cr: hasCr ? '\r' : '' }
  })
}

export function joinLines(lines: readonly { body: string; cr: string }[]): string {
  return lines.map((l) => l.body + l.cr).join('\n')
}
