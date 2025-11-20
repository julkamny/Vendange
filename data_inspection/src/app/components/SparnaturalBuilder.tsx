import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SparnaturalElement, SparnaturalQueryIfc, RDFTerm } from 'sparnatural'
import '../vendor/jquery-global'
import '../vendor/select2'
import '../assets/sparnatural.css'

import 'sparnatural'
import {
  BASE_NS,
  PROP_NS,
  REL_NS,
  SPAR_CONTROLLED_VALUE_PREDICATE,
  SUBFIELD_VALUE_PREDICATE,
} from '../sparql/sparnaturalConfig'
import { ensureGraphWrapping } from '../sparql/queryUtils'
import { CONTROLLED_SUBFIELD_LISTS } from '../data/controlledListsData'

const BASE_PREFIX = `${BASE_NS}/`
const REL_PREFIX = REL_NS
const PROP_PREFIX = PROP_NS

export type ControlledValueOption = {
  ark: string
  label: string
}

export type SparnaturalBuilderProps = {
  datasetId: string | null
  language: string
  config: string
  controlledValues: ControlledValueOption[]
  disabled?: boolean
  onQueryChange: (query: string) => void
  onSubmit?: () => void
  onReset?: () => void
}

type SparnaturalQueryEvent = CustomEvent<{
  queryString: string
  queryJson: SparnaturalQueryIfc
}>

export function SparnaturalBuilder({
  datasetId,
  language,
  config,
  controlledValues,
  disabled = false,
  onQueryChange,
  onSubmit,
  onReset,
}: SparnaturalBuilderProps) {
  const elementRef = useRef<SparnaturalElement | null>(null)
  const lastQueryRef = useRef<string>('')

  const handleRef = useCallback((node: SparnaturalElement | null) => {
    elementRef.current = node
  }, [])

  const controlledItems = useMemo(
    () =>
      controlledValues.map(({ ark, label }) => ({
        term: { type: 'literal', value: ark } satisfies RDFTerm,
        label,
      })),
    [controlledValues],
  )

  const relatorItems = useMemo(() => {
    const collator = new Intl.Collator(language, { sensitivity: 'accent' })
    const lists = [
      "Code Fonction associé à l'Item",
      "Code Fonction Créateur ou Associé à l'Œuvre",
      "Code Fonction Créateur de la Manifestation ou Associé à la Manifestation",
    ] as const
    const seen = new Set<string>()
    const values: string[] = []
    lists.forEach(key => {
      const options = CONTROLLED_SUBFIELD_LISTS[key] as string[] | undefined
      if (!options) return
      options.forEach(option => {
        if (seen.has(option)) return
        seen.add(option)
        values.push(option)
      })
    })
    values.sort((a, b) => collator.compare(a, b))
    return values.map(value => ({
      term: { type: 'literal', value } satisfies RDFTerm,
      label: value,
    }))
  }, [language])

  const listItems = useMemo(() => {
    const union: Array<{ term: RDFTerm; label: string }> = []
    const seen = new Set<string>()
    for (const entry of [...controlledItems, ...relatorItems]) {
      const key = `${entry.term.type}:${entry.term.value}`
      if (seen.has(key)) continue
      union.push(entry)
      seen.add(key)
    }
    return union
  }, [controlledItems, relatorItems])

  useEffect(() => {
    if (!datasetId) {
      lastQueryRef.current = ''
    }
  }, [datasetId])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    const handleInit = () => {
      el.customization = {
        list: {
          dataProvider: {
            init() {},
            getListContent(
          _domain: string,
          predicate: string,
          _range: string,
          callback: (items: Array<{ term: RDFTerm; label: string }>) => void,
        ) {
          if (predicate === SPAR_CONTROLLED_VALUE_PREDICATE || predicate === SUBFIELD_VALUE_PREDICATE) {
            callback(listItems)
          } else {
            callback([])
          }
        },
      },
        },
      }
    }
    el.addEventListener('init', handleInit as EventListener)
    return () => {
      el.removeEventListener('init', handleInit as EventListener)
    }
  }, [listItems])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    const handleQueryUpdated = (event: Event) => {
      if (disabled || !datasetId) return
      const detail = (event as SparnaturalQueryEvent).detail
      if (!detail || !detail.queryString) {
        onQueryChange('')
        lastQueryRef.current = ''
        return
      }
      const expanded = ensureGraphWrapping(el.expandSparql(detail.queryString))
      if (expanded === lastQueryRef.current) return
      lastQueryRef.current = expanded
      onQueryChange(expanded)
    }

    const handleSubmit = () => {
      if (onSubmit) onSubmit()
    }

    const handleReset = () => {
      lastQueryRef.current = ''
      onQueryChange('')
      if (onReset) onReset()
    }

    el.addEventListener('queryUpdated', handleQueryUpdated as EventListener)
    el.addEventListener('submit', handleSubmit)
    el.addEventListener('reset', handleReset)

    return () => {
      el.removeEventListener('queryUpdated', handleQueryUpdated as EventListener)
      el.removeEventListener('submit', handleSubmit)
      el.removeEventListener('reset', handleReset)
    }
  }, [datasetId, disabled, onQueryChange, onSubmit, onReset])

  return (
    <div className={`sparql-builder__canvas${disabled ? ' sparql-builder__canvas--disabled' : ''}`}>
      <spar-natural
        ref={handleRef}
        src={config}
        lang={language}
        defaultLang="en"
        endpoint="about:blank"
        limit="200"
        distinct="true"
        prefixes={`vend:${BASE_PREFIX} vendrel:${REL_PREFIX} vendprop:${PROP_PREFIX}`}
      />
      {disabled ? <div className="sparql-builder__overlay" /> : null}
    </div>
  )
}
