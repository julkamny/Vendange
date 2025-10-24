import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState, type Extension, type Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import type { RecordRow } from '../types'
import { prettyPrintIntermarc, type PrettyIntermarcResult } from '../lib/intermarc'
import { INTERMARC_THEME } from './intermarcTheme'

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
  const docParts: string[] = []
  const ranges: Range<Decoration>[] = []
  let offset = 0

  result.lines.forEach((line, index) => {
    docParts.push(line.text)
    ranges.push(Decoration.line({ class: 'intermarc-line' }).range(offset))
    line.marks.forEach(mark => {
      if (mark.to <= mark.from) return
      ranges.push(
        Decoration.mark({ class: mark.className, attributes: mark.attributes }).range(
          offset + mark.from,
          offset + mark.to,
        ),
      )
    })
    offset += line.text.length
    if (index < result.lines.length - 1) {
      offset += 1
    }
  })

  const decorations =
    ranges.length > 0 ? Decoration.set([...ranges].sort((a, b) => a.from - b.from), true) : Decoration.none

  return {
    doc: docParts.join('\n'),
    decorations,
  }
}
