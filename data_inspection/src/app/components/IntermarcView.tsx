import { useEffect, useMemo, useRef, useState } from 'react'
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
  onArkClick?: (ark: string, context: { zone: string; subfield: string }) => void
}

type IntermarcRender = {
  doc: string
  decorations: DecorationSet
}

export function IntermarcView({ record, onArkClick }: IntermarcViewProps) {
  const [result, setResult] = useState<PrettyIntermarcResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    setResult(null)
    setError(null)
    prettyPrintIntermarc(record.intermarc, { arkLabels: record.arkLabels })
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const computePlacement = (target: HTMLElement) => {
      const scroller = container.querySelector<HTMLElement>('.cm-scroller')
      const referenceRect = (scroller ?? container).getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      const offsetTop = targetRect.top - referenceRect.top
      const placement = offsetTop < 56 ? 'below' : 'above'
      target.dataset.tooltipPlacement = placement
    }

    const handlePointer = (event: Event) => {
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ark-link.has-tooltip')
      if (!target) return
      computePlacement(target)
    }

    const handleScroll = () => {
      const active =
        container.querySelector<HTMLElement>('.ark-link.has-tooltip:hover') ||
        container.querySelector<HTMLElement>('.ark-link.has-tooltip:focus')
      if (active) computePlacement(active)
    }

    container.addEventListener('pointerenter', handlePointer, true)
    container.addEventListener('pointermove', handlePointer, true)
    container.addEventListener('focusin', handlePointer)

    const scroller = container.querySelector<HTMLElement>('.cm-scroller')
    scroller?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      container.removeEventListener('pointerenter', handlePointer, true)
      container.removeEventListener('pointermove', handlePointer, true)
      container.removeEventListener('focusin', handlePointer)
      scroller?.removeEventListener('scroll', handleScroll)
    }
  }, [result])

  useEffect(() => {
    if (!onArkClick) return undefined
    const container = containerRef.current
    if (!container) return undefined

    const invoke = (target: HTMLElement) => {
      const ark = target.getAttribute('data-ark')
      if (!ark) return
      const zone = target.getAttribute('data-zone') ?? ''
      const subfield = target.getAttribute('data-subfield') ?? ''
      onArkClick(ark, { zone, subfield })
    }

    const handleClick = (event: MouseEvent) => {
      const root = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ark-link')
      if (!root) return
      event.preventDefault()
      invoke(root)
    }

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      const target = event.target as HTMLElement | null
      if (!target || !target.classList.contains('ark-link')) return
      event.preventDefault()
      invoke(target)
    }

    container.addEventListener('click', handleClick)
    container.addEventListener('keydown', handleKeydown)
    return () => {
      container.removeEventListener('click', handleClick)
      container.removeEventListener('keydown', handleKeydown)
    }
  }, [onArkClick, result])

  if (error) return <pre className="intermarc-view error">{error}</pre>
  if (!display) return <pre className="intermarc-view loading">…</pre>

  return (
    <div className="intermarc-view" ref={containerRef}>
      <CodeMirror
        key={record.id}
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
