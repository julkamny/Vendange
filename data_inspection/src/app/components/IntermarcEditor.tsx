import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import type { Completion } from '@codemirror/autocomplete'
import { autocompletion, CompletionContext } from '@codemirror/autocomplete'
import { EditorState, RangeSetBuilder, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { Intermarc } from '../lib/intermarc'
import { prettyPrintIntermarc, parsePrettyPrintedIntermarc, buildLabelFromIntermarc } from '../lib/intermarc'
import type { RecordRow } from '../types'
import { INTERMARC_THEME } from './intermarcTheme'
import { useTranslation } from '../hooks/useTranslation'
import { useToast } from '../providers/ToastContext'
import { useRecordLookup } from '../hooks/useRecordLookup'
import { useAppData } from '../providers/AppDataContext'
import { titleOf, manifestationTitle } from '../core/entities'
import { extractControlledValueLabel } from '../core/controlledValues'
import { labelForAgentRecord } from '../core/agents'
import { getControlledListsForLabel, getControlledListsForSubfield } from '../core/controlledLists'
import { getAllowedKindsForSubfield, inferEntityKind, type AutocompleteEntityKind } from '../core/autocompleteRules'

const ARK_PREFIX = 'ark:/'
const COMPLETION_LIMIT = 40
const EXCLUDED_AUTOCOMPLETE_TYPES = new Set(['oeuvre', 'expression', 'manifestation'])

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

type EntitySuggestion = {
  ark: string
  label: string
  labelNormalized: string
  type: string
  isControlled: boolean
  kind: AutocompleteEntityKind
  controlledLists: readonly string[]
}

class ArkLabelWidget extends WidgetType {
  constructor(
    private readonly label: string,
    private readonly ark: string,
    private readonly zone: string,
    private readonly subfield: string,
  ) {
    super()
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
    span.setAttribute('data-tooltip', this.ark)
    span.setAttribute('aria-label', this.ark)
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
      return { zone: parsed.zone, code: subfield.code.toUpperCase(), inValue: true }
    }
    if (pos >= subfield.codeStart && pos <= subfield.codeEnd) {
      return { zone: parsed.zone, code: subfield.code.toUpperCase(), inValue: false }
    }
  }
  return { zone: parsed.zone, inValue: false }
}

function looksLikeArk(value: string): boolean {
  return !!value && value.trim().startsWith(ARK_PREFIX)
}

function recordDisplayLabel(record: RecordRow): string {
  const normalized = record.typeNorm.toLowerCase()
  if (normalized === 'identite publique de personne' || normalized === 'collectivite') {
    const agentLabel = labelForAgentRecord(record)
    if (agentLabel) return agentLabel
  }
  const intermarcLabel = buildLabelFromIntermarc(record.intermarc, record.type)
  if (intermarcLabel) return intermarcLabel
  if (normalized === 'manifestation') {
    return manifestationTitle(record) || record.id
  }
  if (normalized === 'valeur controlee') {
    return extractControlledValueLabel(record) || record.id
  }
  return titleOf(record) || record.id
}

function buildDecorations(doc: Text, options: { getLabelForArk: (ark: string) => string | undefined }): DecorationSet {
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
        const label = options.getLabelForArk(rawValue)
        if (label) {
          const widget = Decoration.replace({
            widget: new ArkLabelWidget(label, rawValue, line.zone, subfield.code),
            inclusive: false,
          })
          builder.add(subfield.valueStart, subfield.valueEnd, widget)
          continue
        }
        const fallback = Decoration.mark({
          class: 'ark-link has-tooltip',
          attributes: {
            'data-ark': rawValue.trim(),
            'data-tooltip': rawValue.trim(),
            'aria-label': rawValue.trim(),
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

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function controlledListsForRecord(record: RecordRow): readonly string[] {
  if (record.typeNorm !== 'valeur controlee') return []
  const label = extractControlledValueLabel(record)
  if (!label) return []
  return getControlledListsForLabel(label)
}

function buildEntitySuggestions(records: RecordRow[], language: string): EntitySuggestion[] {
  const seen = new Set<string>()
  const entries: EntitySuggestion[] = []
  for (const record of records) {
    const ark = record.ark?.trim()
    if (!ark || seen.has(ark)) continue
    const normalizedType = record.typeNorm?.toLowerCase()
    if (!normalizedType || EXCLUDED_AUTOCOMPLETE_TYPES.has(normalizedType)) continue
    const label = recordDisplayLabel(record)
    if (!label) continue
    const kind = inferEntityKind(record.typeNorm)
    const controlledLists = controlledListsForRecord(record)
    entries.push({
      ark,
      label,
      labelNormalized: normalizeText(label),
      type: record.type,
      isControlled: kind === 'controlledValue',
      kind,
      controlledLists,
    })
    seen.add(ark)
  }
  return entries.sort((a, b) => a.label.localeCompare(b.label, language, { sensitivity: 'accent' }))
}

function filterCompletions(
  suggestions: EntitySuggestion[],
  query: string,
  options: { allowedKinds: readonly AutocompleteEntityKind[] | null; allowedControlledLists: readonly string[] },
): Completion[] {
  const normalized = normalizeText(query)
  const allowedKinds = options.allowedKinds && options.allowedKinds.length ? options.allowedKinds : null
  const allowedKindSet = allowedKinds ? new Set(allowedKinds) : null
  const allowedControlledSet =
    options.allowedControlledLists && options.allowedControlledLists.length
      ? new Set(options.allowedControlledLists)
      : null
  const completions: Completion[] = []
  for (const suggestion of suggestions) {
    if (allowedKindSet) {
      if (!allowedKindSet.has(suggestion.kind)) continue
    } else if (!suggestion.isControlled) {
      continue
    }
    if (suggestion.isControlled) {
      if (!allowedControlledSet) continue
      const matchesList = suggestion.controlledLists.some(list => allowedControlledSet.has(list))
      if (!matchesList) continue
    }
    if (normalized && !suggestion.labelNormalized.startsWith(normalized)) continue
    completions.push({
      label: suggestion.label,
      detail: suggestion.type,
      apply: suggestion.ark,
    })
    if (completions.length >= COMPLETION_LIMIT) break
  }
  return completions
}

function createIntermarcCompletionSource(params: { suggestions: EntitySuggestion[] }) {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/[^\s$]*/u)
    if (!match) return null
    if (match.from === match.to && !context.explicit) return null
    const info = getSubfieldContext(context.state.doc, match.from)
    if (!info || !info.inValue) return null
    const subfieldCode = info.code ?? ''
    const query = match.text.trim()
    if (!query && !context.explicit) return null
    const allowedControlledLists = getControlledListsForSubfield(subfieldCode)
    const allowedKinds = getAllowedKindsForSubfield(subfieldCode)
    if ((!allowedKinds || allowedKinds.length === 0) && allowedControlledLists.length === 0) {
      return null
    }
    const options = filterCompletions(params.suggestions, query, {
      allowedKinds,
      allowedControlledLists,
    })
    if (!options.length) return null
    return {
      from: match.from,
      options,
      validFor: /[^\s$]*/u,
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
  const { curated } = useAppData()
  const { getByArk } = useRecordLookup()
  const [doc, setDoc] = useState('')
  const [recordDoc, setRecordDoc] = useState('')
  const [baselineDoc, setBaselineDoc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const statusResetRef = useRef<number | null>(null)

  const suggestions = useMemo(
    () => buildEntitySuggestions(curated?.records ?? [], language),
    [curated?.records, language],
  )

  const getLabelForArk = useCallback(
    (ark: string) => {
      const target = getByArk(ark)
      if (!target) return undefined
      return recordDisplayLabel(target)
    },
    [getByArk],
  )

  const decorationExtension = useMemo<Extension>(
    () => createIntermarcDecorationField({ getLabelForArk }),
    [getLabelForArk],
  )

  const completionSource = useMemo(() => createIntermarcCompletionSource({ suggestions }), [suggestions])

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
  const saveButtonClassName = `save-button${
    saveStatus === 'success' ? ' is-success' : saveStatus === 'error' ? ' is-error' : ''
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
