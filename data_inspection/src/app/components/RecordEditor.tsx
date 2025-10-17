import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import type { Intermarc } from '../lib/intermarc'
import type { RecordRow } from '../types'
import { useTranslation } from '../hooks/useTranslation'

const EDITOR_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      color: 'var(--color-text)',
      fontFamily: 'Menlo, Consolas, "Roboto Mono", "SFMono-Regular", monospace',
      fontSize: '0.9rem',
    },
    '.cm-content': {
      caretColor: 'var(--color-link)',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
    },
    '&.cm-editor.cm-focused': {
      outline: '2px solid color-mix(in srgb, var(--color-link) 50%, transparent)',
      outlineOffset: '2px',
    },
    '.cm-gutters': {
      backgroundColor: 'color-mix(in srgb, var(--color-surface-alt) 92%, var(--color-bg))',
      color: 'var(--color-text-muted)',
      border: 'none',
    },
  },
  { dark: true },
)

type RecordEditorProps = {
  record: RecordRow
  readOnly?: boolean
  readOnlyReason?: string | null
  onSave: (next: Intermarc) => void
}

export function RecordEditor({ record, readOnly = false, readOnlyReason, onSave }: RecordEditorProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialDoc = useMemo(() => JSON.stringify(record.intermarc, null, 2), [record])

  useEffect(() => {
    const parent = containerRef.current
    if (!parent) return
    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    setDirty(false)
    setError(null)

    const updateListener = EditorView.updateListener.of(update => {
      if (update.docChanged) {
        setDirty(update.state.doc.toString() !== initialDoc)
      }
    })

    const extensions = [
      history(),
      keymap.of([...defaultKeymap, indentWithTab, ...historyKeymap]),
      json(),
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      EDITOR_THEME,
      updateListener,
      EditorView.editable.of(!readOnly),
    ]

    const state = EditorState.create({
      doc: initialDoc,
      extensions,
    })

    const view = new EditorView({ state, parent })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [initialDoc, readOnly])

  const handleSave = () => {
    const view = viewRef.current
    if (!view) return
    try {
      const text = view.state.doc.toString()
      const parsed = JSON.parse(text) as Intermarc
      if (!parsed || !Array.isArray((parsed as Intermarc).zones)) {
        throw new Error('Invalid Intermarc: missing zones')
      }
      onSave(parsed)
      setError(null)
      setDirty(false)
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err)
      setError(t('messages.saveFailed', { error: errorText }))
    }
  }

  return (
    <div className="record-editor">
      <div className="record-editor__editor" ref={containerRef} />
      <div className="record-editor__footer">
        {error ? <p className="record-editor__error">{error}</p> : null}
        {readOnly ? (
          readOnlyReason ? <p className="record-editor__note">{readOnlyReason}</p> : null
        ) : (
          <button type="button" onClick={handleSave} disabled={!dirty}>
            {t('buttons.save')}
          </button>
        )}
      </div>
    </div>
  )
}
