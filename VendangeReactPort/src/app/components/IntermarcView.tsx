import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import type { RecordRow } from '../types'
import {
  prettyPrintIntermarc,
  ARK_TOKEN_START,
  ARK_TOKEN_END,
  type PrettyIntermarcResult,
} from '../lib/intermarc'

const INTERMARC_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      fontFamily: 'Menlo, Consolas, "Roboto Mono", "SFMono-Regular", monospace',
      color: 'var(--color-text)',
    },
    '.cm-editor': {
      backgroundColor: 'transparent',
    },
    '.cm-cursor': {
      display: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-content': {
      fontSize: '0.88rem',
      lineHeight: '1.45',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
    },
    '.cm-selectionBackground': {
      background: 'color-mix(in srgb, var(--color-link) 25%, transparent)',
    },
  },
  { dark: true },
)

const INTERMARC_BASE_EXTENSIONS: Extension[] = [
  EditorView.lineWrapping,
  EditorState.tabSize.of(2),
  EditorView.editable.of(false),
  EditorState.readOnly.of(true),
  INTERMARC_THEME,
]

type IntermarcViewProps = {
  record: RecordRow
}

type LocalMark = {
  from: number
  to: number
  className: string
  attributes?: Record<string, string>
}

type IntermarcRender = {
  doc: string
  decorations: DecorationSet
}

export function IntermarcView({ record }: IntermarcViewProps) {
  const [result, setResult] = useState<PrettyIntermarcResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    prettyPrintIntermarc(record.intermarc)
      .then(res => {
        if (!cancelled) {
          setResult(res)
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [record])

  const display = useMemo(() => (result ? buildIntermarcRender(result) : null), [result])

  const extensions = useMemo(() => {
    if (!display) return INTERMARC_BASE_EXTENSIONS
    const decorations = EditorView.decorations.of(() => display.decorations)
    return [...INTERMARC_BASE_EXTENSIONS, decorations]
  }, [display])

  if (error) return <pre className="intermarc-view error">{error}</pre>
  if (!display) return <pre className="intermarc-view loading">…</pre>

  return (
    <div className="intermarc-view">
      <CodeMirror
        value={display.doc}
        editable={false}
        extensions={extensions}
        basicSetup={{
          lineNumbers: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          foldGutter: false,
          autocompletion: false,
          bracketMatching: false,
        }}
      />
    </div>
  )
}

function buildIntermarcRender(result: PrettyIntermarcResult): IntermarcRender {
  const tokenMap = new Map<number, string>()
  for (const token of result.tokens) {
    tokenMap.set(token.index, token.ark)
  }

  const lines = result.text.split('\n')
  const docParts: string[] = []
  const markSpecs: LocalMark[] = []
  const linePositions: number[] = []
  let offset = 0

  lines.forEach((rawLine, index) => {
    const isLast = index === lines.length - 1
    const trimmed = rawLine.trim()
    let lineText = ''
    const localMarks: LocalMark[] = []

    if (trimmed) {
      const match = trimmed.match(/^(\S+)(.*)$/)
      if (match) {
        const zoneCode = match[1]
        const remainder = match[2].trim()

        const zoneStart = lineText.length
        lineText += zoneCode
        const zoneEnd = lineText.length
        localMarks.push({ className: 'intermarc-zone', from: zoneStart, to: zoneEnd })

        if (remainder) {
          const segments = remainder.split(' $')
          segments.forEach((segment, segIndex) => {
            const cleaned = segment.trim()
            if (!cleaned) return
            const part = segIndex === 0 ? cleaned : `$${cleaned}`

            const subfieldStart = lineText.length
            lineText += ' '
            const codeStart = lineText.length
            let code = part
            let valueText = ''
            const spaceIndex = part.indexOf(' ')
            if (spaceIndex >= 0) {
              code = part.slice(0, spaceIndex)
              valueText = part.slice(spaceIndex + 1).trim()
            }
            lineText += code
            const codeEnd = lineText.length
            localMarks.push({ className: 'intermarc-subfield-code', from: codeStart, to: codeEnd })

            if (valueText) {
              lineText += ' '
              const valueStart = lineText.length
              const rendered = renderArkValue(valueText, tokenMap)
              lineText += rendered.text
              rendered.marks.forEach(mark => {
                localMarks.push({
                  className: mark.className,
                  from: valueStart + mark.from,
                  to: valueStart + mark.to,
                  attributes: mark.attributes,
                })
              })
            }

            const subfieldEnd = lineText.length
            localMarks.push({ className: 'intermarc-subfield', from: subfieldStart, to: subfieldEnd })
          })
        }
      } else {
        const rendered = renderArkValue(trimmed, tokenMap)
        lineText += rendered.text
        localMarks.push(...rendered.marks)
      }
    }

    docParts.push(lineText)
    linePositions.push(offset)
    localMarks.forEach(mark => {
      if (mark.to <= mark.from) return
      markSpecs.push({
        className: mark.className,
        from: offset + mark.from,
        to: offset + mark.to,
        attributes: mark.attributes,
      })
    })
    offset += lineText.length
    if (!isLast) offset += 1
  })

  const ranges = [
    ...linePositions.map(pos => Decoration.line({ class: 'intermarc-line' }).range(pos)),
    ...markSpecs.map(mark =>
      Decoration.mark({ class: mark.className, attributes: mark.attributes }).range(mark.from, mark.to),
    ),
  ]
  const decorations =
    ranges.length > 0 ? Decoration.set([...ranges].sort((a, b) => a.from - b.from), true) : Decoration.none

  return {
    doc: docParts.join('\n'),
    decorations,
  }
}

function renderArkValue(value: string, tokenMap: Map<number, string>): { text: string; marks: LocalMark[] } {
  if (!value) return { text: '', marks: [] }
  let output = ''
  const marks: LocalMark[] = []
  let cursor = 0

  while (cursor < value.length) {
    const start = value.indexOf(ARK_TOKEN_START, cursor)
    if (start === -1) {
      output += value.slice(cursor)
      break
    }
    if (start > cursor) {
      output += value.slice(cursor, start)
    }
    const end = value.indexOf(ARK_TOKEN_END, start + ARK_TOKEN_START.length)
    if (end === -1) {
      output += value.slice(start)
      break
    }

    const tokenContent = value.slice(start + ARK_TOKEN_START.length, end)
    const separatorIdx = tokenContent.indexOf('|')
    if (separatorIdx === -1) {
      output += tokenContent
    } else {
      const indexStr = tokenContent.slice(0, separatorIdx)
      const label = tokenContent.slice(separatorIdx + 1)
      const index = Number.parseInt(indexStr, 10)
      const ark = Number.isNaN(index) ? undefined : tokenMap.get(index)
      if (ark && label) {
        const markStart = output.length
        output += label
        const markEnd = output.length
        marks.push({
          className: 'ark-link has-tooltip',
          from: markStart,
          to: markEnd,
          attributes: {
            'data-ark': ark,
            'data-tooltip': ark,
            'aria-label': ark,
            tabindex: '0',
          },
        })
      } else {
        output += label
      }
    }
    cursor = end + ARK_TOKEN_END.length
  }

  return { text: output, marks }
}
