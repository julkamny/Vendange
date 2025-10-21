export function deriveInternalIdFromArk(rawArk: string | null | undefined): string | null {
  if (!rawArk) return null
  const normalized = rawArk.trim()
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  const cbIndex = lower.indexOf('cb')
  if (cbIndex === -1 || cbIndex + 2 >= normalized.length) return null
  const withoutPrefix = normalized
    .slice(cbIndex + 2)
    .replace(/[^0-9a-z]+/gi, '')
  if (withoutPrefix.length <= 1) return null
  return withoutPrefix.slice(0, withoutPrefix.length - 1)
}
