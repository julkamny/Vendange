import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import CodeMirror from '@uiw/react-codemirror'
import type { Completion } from '@codemirror/autocomplete'
import { autocompletion, CompletionContext } from '@codemirror/autocomplete'
import { EditorState, RangeSetBuilder, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { Intermarc } from '../lib/intermarc'
import { prettyPrintIntermarc, parsePrettyPrintedIntermarc, labelFromRecord } from '../lib/intermarc'
import type { RecordRow } from '../types'
import type { AutocompleteSuggestionDto } from '../types'
import { INTERMARC_THEME } from './intermarcTheme'
import { useTranslation } from '../hooks/useTranslation'
import { useToast } from '../providers/ToastContext'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { useAppData } from '../providers/AppDataContext'
import { titleOf, manifestationTitle } from '../core/entities'
import { extractControlledValueLabel } from '../core/controlledValues'
import { labelForAgentRecord } from '../core/agents'
import { fetchEntityAutocomplete } from '../lib/api'

const ARK_PREFIX = 'ark:/'
const COMPLETION_LIMIT = 40

type ParsedSubfield = {
  code: string
  codeStart: number
  codeEnd: number
  valueStart: number
  valueEnd: number
  value: string
}

type ParsedLine = {
  zone: string
  zoneStart: number
  zoneEnd: number
  lineStart: number
  lineEnd: number
  subfields: ParsedSubfield[]
}

type SubfieldContext = {
  zone: string
  code?: string
  inValue: boolean
}

class ArkLabelWidget extends WidgetType {
  private readonly label: string
  private readonly ark: string
  private readonly zone: string
  private readonly subfield: string

  constructor(
    label: string,
    ark: string,
    zone: string,
    subfield: string,
  ) {
    super()
    this.label = label
    this.ark = ark
    this.zone = zone
    this.subfield = subfield
  }

  eq(other: ArkLabelWidget): boolean {
    return (
      other.label === this.label &&
      other.ark === this.ark &&
      other.zone === this.zone &&
      other.subfield === this.subfield
    )
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'ark-link has-tooltip'
    span.textContent = this.label
    span.setAttribute('data-ark', this.ark)
    const tooltip = this.label === this.ark ? this.ark : `${this.ark}`
    span.setAttribute('data-tooltip', tooltip)
    span.setAttribute('aria-label', tooltip)
    span.setAttribute('data-tooltip-placement', 'above')
    span.setAttribute('tabindex', '0')
    span.setAttribute('role', 'button')
    span.setAttribute('data-zone', this.zone)
    span.setAttribute('data-subfield', this.subfield)
    return span
  }
}

function normalizeSubfieldCode(zone: string, rawCode: string): string {
  if (!rawCode) return zone
  if (rawCode.includes('$')) {
    if (rawCode.startsWith('$')) return `${zone}${rawCode}`
    return rawCode
  }
  return `${zone}$${rawCode}`
}

function parseLine(lineText: string, lineStart: number): ParsedLine | null {
  if (!lineText.trim()) return null
  const zoneMatch = lineText.match(/^(\S+)/)
  if (!zoneMatch) return null
  const zone = zoneMatch[1]
  const zoneStart = lineStart
  const zoneEnd = lineStart + zone.length
  let cursor = zone.length
  const subfields: ParsedSubfield[] = []
  const length = lineText.length

  while (cursor < length) {
    while (cursor < length && lineText[cursor] === ' ') cursor++
    if (cursor >= length) break
    if (lineText[cursor] !== '$') break
    const codeStartRel = cursor
    cursor++
    while (cursor < length && lineText[cursor] !== ' ' && lineText[cursor] !== '$') cursor++
    const codeEndRel = cursor
    while (cursor < length && lineText[cursor] === ' ') cursor++
    const valueStartRel = cursor
    let valueEndRel = length
    let walker = cursor
    while (walker < length) {
      if (lineText[walker] === ' ' && walker + 1 < length && lineText[walker + 1] === '$') {
        valueEndRel = walker
        break
      }
      walker++
    }
    cursor = walker
    const code = lineText.slice(codeStartRel, codeEndRel)
    const normalizedCode = normalizeSubfieldCode(zone, code)
    const value = lineText.slice(valueStartRel, valueEndRel)
    subfields.push({
      code: normalizedCode,
      codeStart: lineStart + codeStartRel,
      codeEnd: lineStart + codeEndRel,
      valueStart: lineStart + valueStartRel,
      valueEnd: lineStart + valueEndRel,
      value,
    })
  }

  return {
    zone,
    zoneStart,
    zoneEnd,
    lineStart,
    lineEnd: lineStart + lineText.length,
    subfields,
  }
}

function parseIntermarcLines(doc: Text): ParsedLine[] {
  const lines: ParsedLine[] = []
  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i)
    const parsed = parseLine(line.text, line.from)
    if (parsed) lines.push(parsed)
  }
  return lines
}

function getSubfieldContext(doc: Text, pos: number): SubfieldContext | null {
  const line = doc.lineAt(pos)
  const parsed = parseLine(line.text, line.from)
  if (!parsed) return null
  if (pos <= parsed.zoneEnd) {
    return { zone: parsed.zone, inValue: false }
  }
  for (const subfield of parsed.subfields) {
    if (pos >= subfield.valueStart && pos <= subfield.valueEnd) {
      return { zone: parsed.zone, code: subfield.code, inValue: true }
    }
    if (pos >= subfield.codeStart && pos <= subfield.codeEnd) {
      return { zone: parsed.zone, code: subfield.code, inValue: false }
    }
  }
  return { zone: parsed.zone, inValue: false }
}

function looksLikeArk(value: string): boolean {
  return !!value && value.trim().startsWith(ARK_PREFIX)
}

function recordDisplayLabel(record: RecordRow): string {
  const normalized = record.typeNorm.toLowerCase()
  const providedLabel = labelFromRecord(record)
  if (providedLabel) return providedLabel
  if (normalized === 'identite publique de personne' || normalized === 'collectivite') {
    const agentLabel = labelForAgentRecord(record)
    if (agentLabel) return agentLabel
  }
  if (normalized === 'manifestation') return manifestationTitle(record) || record.id
  if (normalized === 'valeur controlee') return extractControlledValueLabel(record) || record.id
  return titleOf(record) || record.id
}

function buildDecorations(
  doc: Text,
  options: { getLabelForArk: (ark: string) => string | undefined; arkLabels?: Record<string, string> },
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const lines = parseIntermarcLines(doc)
  for (const line of lines) {
    builder.add(line.lineStart, line.lineStart, Decoration.line({ class: 'intermarc-line' }))
    builder.add(line.zoneStart, line.zoneEnd, Decoration.mark({ class: 'intermarc-zone' }))
    for (const subfield of line.subfields) {
      const subfieldClass = Decoration.mark({ class: 'intermarc-subfield' })
      builder.add(subfield.codeStart, subfield.valueEnd, subfieldClass)
      builder.add(
        subfield.codeStart,
        subfield.codeEnd,
        Decoration.mark({ class: 'intermarc-subfield-code' }),
      )
      const rawValue = subfield.value.trim()
      if (looksLikeArk(rawValue)) {
        const normalizedArk = rawValue
        const mappedLabel =
          options.arkLabels?.[normalizedArk] ??
          (normalizedArk.toLowerCase() !== normalizedArk ? options.arkLabels?.[normalizedArk.toLowerCase()] : undefined)
        const label = options.getLabelForArk(normalizedArk) ?? mappedLabel
        if (label) {
          const widget = Decoration.replace({
            widget: new ArkLabelWidget(label, normalizedArk, line.zone, subfield.code),
            inclusive: false,
          })
          builder.add(subfield.valueStart, subfield.valueEnd, widget)
          continue
        }
        const tooltipLabel = mappedLabel ? `${normalizedArk}` : normalizedArk
        const fallback = Decoration.mark({
          class: 'ark-link has-tooltip',
          attributes: {
            'data-ark': normalizedArk,
            'data-tooltip': tooltipLabel,
            'aria-label': tooltipLabel,
            'data-tooltip-placement': 'above',
            'data-zone': line.zone,
            'data-subfield': subfield.code,
          },
        })
        builder.add(subfield.valueStart, subfield.valueEnd, fallback)
      }
    }
  }
  return builder.finish()
}

function createIntermarcDecorationField(options: {
  getLabelForArk: (ark: string) => string | undefined
  arkLabels?: Record<string, string>
}): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorations(state.doc, options)
    },
    update(value, tr) {
      if (tr.docChanged) return buildDecorations(tr.state.doc, options)
      return value
    },
    provide: field => EditorView.decorations.from(field),
  })
}


function buildEntitySuggestions(entries: AutocompleteSuggestionDto[], language: string): Completion[] {
  const seen = new Set<string>()
  const collator = new Intl.Collator(language, { sensitivity: 'accent' })
  const sorted = [...entries].sort((a, b) => collator.compare(a.label, b.label))
  const options: Completion[] = []
  for (const entry of sorted) {
    const ark = entry.ark?.trim()
    const label = entry.label?.trim()
    if (!ark || !label || seen.has(ark)) continue
    options.push({ label, detail: entry.type, apply: ark })
    seen.add(ark)
    if (options.length >= COMPLETION_LIMIT) break
  }
  return options
}

function createIntermarcCompletionSource(params: {
  datasetId: string | null
  language: string
  queryClient: ReturnType<typeof useQueryClient>
}) {
  return async (context: CompletionContext) => {
    const match = context.matchBefore(/[^\s$]*/u)
    if (!match) return null
    if (match.from === match.to && !context.explicit) return null
    const info = getSubfieldContext(context.state.doc, match.from)
    if (!info || !info.inValue) return null
    const subfieldCode = info.code ?? ''
    const query = match.text.trim()
    if (!query && !context.explicit) return null
    if (!params.datasetId || !subfieldCode) return null

    try {
      const suggestions = await params.queryClient.fetchQuery({
        queryKey: ['autocomplete', 'entities', params.datasetId, subfieldCode, query],
        queryFn: () =>
          fetchEntityAutocomplete(params.datasetId as string, { subfield: subfieldCode, zone: info.zone, query }),
        staleTime: 5 * 60 * 1000,
      })
      const options = buildEntitySuggestions(suggestions, params.language)
      if (!options.length) return null
      return {
        from: match.from,
        options,
        validFor: /[^\s$]*/u,
      }
    } catch (error) {
      console.error('Autocomplete query failed', error)
      return null
    }
  }
}

type IntermarcEditorProps = {
  record: RecordRow
  baselineRecord?: RecordRow
  onCancel: () => void
  onSave: (next: Intermarc) => void
}

export function IntermarcEditor({ record, baselineRecord, onCancel, onSave }: IntermarcEditorProps) {
  const { t, language } = useTranslation()
  const { showToast } = useToast()
  const { datasetId } = useAppData()
  const { getByArk } = useRecordLookup()
  const queryClient = useQueryClient()
  const [doc, setDoc] = useState('')
  const [recordDoc, setRecordDoc] = useState('')
  const [baselineDoc, setBaselineDoc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const statusResetRef = useRef<number | null>(null)

  const getLabelForArk = useCallback(
    (ark: string) => {
      const normalized = ark.trim()
      const target = getByArk(normalized)
      if (target) return recordDisplayLabel(target)
      return (
        record.arkLabels?.[normalized] ??
        (normalized.toLowerCase() !== normalized ? record.arkLabels?.[normalized.toLowerCase()] : undefined)
      )
    },
    [getByArk, record.arkLabels],
  )

  const decorationExtension = useMemo<Extension>(
    () => createIntermarcDecorationField({ getLabelForArk, arkLabels: record.arkLabels }),
    [getLabelForArk, record.arkLabels],
  )

  const completionSource = useMemo(() => createIntermarcCompletionSource({ datasetId, language, queryClient }), [datasetId, language, queryClient])

  const completionExtension = useMemo(
    () =>
      autocompletion({
        override: [completionSource],
        icons: false,
      }),
    [completionSource],
  )

  useEffect(() => {
    let cancelled = false
    prettyPrintIntermarc(record.intermarc, { resolveLabels: false, arkLabels: record.arkLabels })
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

    prettyPrintIntermarc(baselineRecord.intermarc, {
      resolveLabels: false,
      arkLabels: baselineRecord.arkLabels,
    })
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

  const extensions = useMemo<Extension[]>(
    () => [
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      INTERMARC_THEME,
      decorationExtension,
      completionExtension,
    ],
    [completionExtension, decorationExtension],
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
  const saveButtonClassName = `save-button${saveStatus === 'success' ? ' is-success' : saveStatus === 'error' ? ' is-error' : ''
    }`
  const statusSymbol = saveStatus === 'success' ? '✓' : saveStatus === 'error' ? '!' : null

  return (
    <div className="intermarc-editor">
      <div className="intermarc-view intermarc-view--editing">
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
            autocompletion: true,
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
