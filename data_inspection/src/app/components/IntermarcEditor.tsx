import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Intermarc } from '../lib/intermarc'
import { prettyPrintIntermarc, parsePrettyPrintedIntermarc } from '../lib/intermarc'
import type { RecordRow } from '../types'
import { INTERMARC_THEME } from './intermarcTheme'
import { useTranslation } from '../hooks/useTranslation'
import { useToast } from '../providers/ToastContext'

type IntermarcEditorProps = {
  record: RecordRow
  baselineRecord?: RecordRow
  onCancel: () => void
  onSave: (next: Intermarc) => void
}

export function IntermarcEditor({ record, baselineRecord, onCancel, onSave }: IntermarcEditorProps) {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [doc, setDoc] = useState('')
  const [recordDoc, setRecordDoc] = useState('')
  const [baselineDoc, setBaselineDoc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const statusResetRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    prettyPrintIntermarc(record.intermarc, { resolveLabels: false })
      .then(res => {
        if (!cancelled) {
          setDoc(res.text)
          setRecordDoc(res.text)
          setError(null)
          setSaveStatus('idle')
        }
      })
      .catch(err => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [record])

  useEffect(() => {
    let cancelled = false
    if (!baselineRecord) {
      setBaselineDoc(null)
      return () => {
        cancelled = true
      }
    }

    prettyPrintIntermarc(baselineRecord.intermarc, { resolveLabels: false })
      .then(res => {
        if (!cancelled) setBaselineDoc(res.text)
      })
      .catch(err => {
        if (!cancelled) console.error('Failed to render baseline intermarc', err)
      })

    return () => {
      cancelled = true
    }
  }, [baselineRecord])

  useEffect(() => {
    return () => {
      if (statusResetRef.current !== null) {
        window.clearTimeout(statusResetRef.current)
        statusResetRef.current = null
      }
    }
  }, [])

  const extensions = useMemo(
    () => [EditorView.lineWrapping, EditorState.tabSize.of(2), INTERMARC_THEME],
    [],
  )

  const resetStatusTimer = () => {
    if (statusResetRef.current !== null) {
      window.clearTimeout(statusResetRef.current)
      statusResetRef.current = null
    }
  }

  const handleSave = () => {
    try {
      const parsed = parsePrettyPrintedIntermarc(doc)
      onSave(parsed)
      setError(null)
      setRecordDoc(doc)
      setSaveStatus('success')
      showToast(t('notifications.recordSaved'), { tone: 'success' })
      resetStatusTimer()
      statusResetRef.current = window.setTimeout(() => {
        setSaveStatus('idle')
        statusResetRef.current = null
      }, 1800)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(t('messages.saveFailed', { error: message }))
      setSaveStatus('error')
      showToast(t('notifications.recordSaveFailed'), { tone: 'error' })
      resetStatusTimer()
    }
  }

  const handleReset = () => {
    const target = baselineDoc ?? recordDoc
    setDoc(target)
    setError(null)
    resetStatusTimer()
    setSaveStatus('idle')
    showToast(t('notifications.recordReset'), { tone: 'info' })
  }

  const handleDocChange = (value: string) => {
    setDoc(value)
    if (error) setError(null)
    if (saveStatus !== 'idle') setSaveStatus('idle')
    resetStatusTimer()
  }

  const isDirty = doc !== recordDoc
  const canReset = baselineDoc !== null ? doc !== baselineDoc : doc !== recordDoc
  const saveButtonClassName = `save-button${
    saveStatus === 'success' ? ' is-success' : saveStatus === 'error' ? ' is-error' : ''
  }`
  const statusSymbol = saveStatus === 'success' ? '✓' : saveStatus === 'error' ? '!' : null

  return (
    <div className="intermarc-editor">
      <div className="intermarc-view">
        <CodeMirror
          value={doc}
          height="auto"
          onChange={handleDocChange}
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
        <button type="button" onClick={handleSave} disabled={!isDirty} className={saveButtonClassName}>
          {t('buttons.save')}
          {statusSymbol ? <span className="button-status" aria-hidden="true">{statusSymbol}</span> : null}
        </button>
        <button type="button" onClick={handleReset} disabled={!canReset}>
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
