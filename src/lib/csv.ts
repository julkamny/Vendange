export function parseCsv(text: string, delimiter = ';'): { headers: string[]; rows: string[][] } {
  // Simple CSV parser for delimiter-separated values, quote-aware
  const rows: string[][] = []
  let i = 0
  const n = text.length
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  function endCell() {
    row.push(cell)
    cell = ''
  }
  function endRow() {
    rows.push(row)
    row = []
  }

  while (i < n) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < n && text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        } else {
          inQuotes = false
          i++
          continue
        }
      } else {
        cell += ch
        i++
        continue
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
        continue
      }
      if (ch === delimiter) {
        endCell()
        i++
        continue
      }
      if (ch === '\n') {
        endCell()
        endRow()
        i++
        continue
      }
      if (ch === '\r') {
        // handle CRLF
        i++
        continue
      }
      cell += ch
      i++
    }
  }
  // flush last cell/row
  endCell()
  if (row.length) endRow()

  const headers = rows[0] || []
  return { headers, rows }
}

export function stringifyCsv(data: { headers: string[]; rows: string[][] }): string {
  function esc(s: string): string {
    if (s == null) s = ''
    if (/[";\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const lines: string[] = []
  lines.push(data.headers.map(esc).join(';'))
  for (const row of data.rows) {
    lines.push(row.map(esc).join(';'))
  }
  return lines.join('\n')
}
