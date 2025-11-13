const GRAPH_REGEX = /\bGRAPH\b/i

export function ensureGraphWrapping(rawQuery: string): string {
  const query = rawQuery.trim()
  if (!query) return query
  if (GRAPH_REGEX.test(stripComments(query))) return query

  const whereMatch = /WHERE\s*\{/i.exec(query)
  if (!whereMatch) return query
  const braceStart = query.indexOf('{', whereMatch.index)
  if (braceStart === -1) return query
  const closingIndex = findMatchingBrace(query, braceStart)
  if (closingIndex === -1) return query

  const before = query.slice(0, braceStart + 1)
  const middle = query.slice(braceStart + 1, closingIndex)
  const after = query.slice(closingIndex)
  const wrapped = `${before}\n  GRAPH ?g {\n${middle}\n  }\n${after}`
  return wrapped
}

function stripComments(value: string): string {
  return value.replace(/#[^\n]*/g, '')
}

function findMatchingBrace(text: string, openingIndex: number): number {
  let depth = 1
  for (let i = openingIndex + 1; i < text.length; i++) {
    const char = text[i]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}
