// Utilities for working with CSV headers in a more fault-tolerant way.

// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/g

export function normalizeHeaderName(value: string): string {
  const cleaned = value.replace(/\uFEFF/g, '').replace(CONTROL_CHAR_REGEX, '').replace(/"/g, '')
  const normalized = cleaned.normalize ? cleaned.normalize('NFKC') : cleaned
  return normalized.trim().toLowerCase()
}

export function buildHeaderLookup(headers: string[]): Map<string, number> {
  const lookup = new Map<string, number>()
  for (let idx = 0; idx < headers.length; idx++) {
    const normalized = normalizeHeaderName(headers[idx])
    if (!normalized || lookup.has(normalized)) continue
    lookup.set(normalized, idx)
  }
  return lookup
}
