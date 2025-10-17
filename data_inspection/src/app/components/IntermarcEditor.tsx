import { useEffect, useMemo, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Intermarc } from '../lib/intermarc'
import { prettyPrintIntermarc, parsePrettyPrintedIntermarc } from '../lib/intermarc'
import type { RecordRow } from '../types'
import { INTERMARC_THEME } from './intermarcTheme'
import { useTranslation } from '../hooks/useTranslation'

type IntermarcEditorProps = {
  record: RecordRow
  onCancel: () => void
  onSave: (next: Intermarc) => void
}

export function IntermarcEditor({ record, onCancel, onSave }: IntermarcEditorProps) {
  const { t } = useTranslation()
  const [doc, setDoc] = useState('')
  const [initialDoc, setInitialDoc] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    prettyPrintIntermarc(record.intermarc, { resolveLabels: false })
      .then(res => {
        if (!cancelled) {
          setDoc(res.text)
          setInitialDoc(res.text)
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

  const extensions = useMemo(
    () => [EditorView.lineWrapping, EditorState.tabSize.of(2), INTERMARC_THEME],
    [],
  )

  const handleSave = () => {
    try {
      const parsed = parsePrettyPrintedIntermarc(doc)
      onSave(parsed)
      setError(null)
      setInitialDoc(doc)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('messages.saveFailed', { error: message }))
    }
  }

  const handleReset = () => {
    setDoc(initialDoc)
    setError(null)
  }

  const isDirty = doc !== initialDoc

  return (
    <div className="intermarc-editor">
      <div className="intermarc-view">
        <CodeMirror
          value={doc}
          height="auto"
          onChange={value => setDoc(value)}
          extensions={extensions}
          basicSetup={{
            lineNumbers: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: false,
            foldGutter: false,
            autocompletion: false,
            bracketMatching: false,
            allowMultipleSelections: false,
          }}
        />
      </div>
      <div className="editor-actions">
        <button type="button" onClick={handleSave} disabled={!isDirty}>
          {t('buttons.save')}
        </button>
        <button type="button" onClick={handleReset} disabled={!isDirty}>
          {t('buttons.reset')}
        </button>
        <button type="button" onClick={onCancel}>
          {t('buttons.closeEditor')}
        </button>
      </div>
      {error ? <p className="record-editor__error">{error}</p> : null}
    </div>
  )
}
