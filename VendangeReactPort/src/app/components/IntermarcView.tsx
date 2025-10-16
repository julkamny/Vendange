import { useEffect, useState } from 'react'
import type { RecordRow } from '../types'
import {
  prettyPrintIntermarc,
  ARK_TOKEN_START,
  ARK_TOKEN_END,
  type PrettyIntermarcResult,
} from '../lib/intermarc'

type IntermarcViewProps = {
  record: RecordRow
}

export function IntermarcView({ record }: IntermarcViewProps) {
  const [result, setResult] = useState<PrettyIntermarcResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    prettyPrintIntermarc(record.intermarc)
      .then(res => {
        if (!cancelled) {
          setResult(res)
          setError(null)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [record])

  if (error) return <pre className="intermarc-view error">{error}</pre>
  if (!result) return <pre className="intermarc-view loading">…</pre>

  const content = renderWithTokens(result)
  return <pre className="intermarc-view" dangerouslySetInnerHTML={{ __html: content }} />
}

function renderWithTokens(result: PrettyIntermarcResult): string {
  if (!result.tokens.length) return escapeHtml(result.text)
  const tokenMap = new Map<number, string>()
  result.tokens.forEach(token => {
    tokenMap.set(token.index, token.ark)
  })

  let output = ''
  let buffer = ''
  let captureIndex = ''
  let capturing = false
  for (const ch of result.text) {
    if (ch === ARK_TOKEN_START) {
      capturing = true
      if (buffer) {
        output += escapeHtml(buffer)
        buffer = ''
      }
      captureIndex = ''
      continue
    }
    if (ch === ARK_TOKEN_END) {
      const [indexStr, label] = captureIndex.split('|')
      const index = Number(indexStr)
      const ark = tokenMap.get(index) ?? ''
      output += `<span class="ark-token" data-ark="${escapeHtml(ark)}">${escapeHtml(label)}</span>`
      capturing = false
      continue
    }
    if (capturing) {
      captureIndex += ch
    } else {
      buffer += ch
    }
  }
  if (buffer) output += escapeHtml(buffer)
  return output
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPE[ch] ?? ch)
}

const HTML_ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}
