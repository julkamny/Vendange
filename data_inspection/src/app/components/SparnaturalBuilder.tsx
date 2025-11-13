import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { SparnaturalElement, SparnaturalQueryIfc, RDFTerm } from 'sparnatural'
import '../assets/sparnatural.css'
import 'sparnatural'
import { SPAR_CONTROLLED_VALUE_PREDICATE } from '../sparql/sparnaturalConfig'

const BASE_NS = 'https://vendange.bnf.fr'
const REL_NS = `${BASE_NS}/relation/`
const PROP_NS = `${BASE_NS}/property/`
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

  useEffect(() => {
    if (!datasetId) {
      lastQueryRef.current = ''
    }
  }, [datasetId])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return
    el.setAttribute('src', config)
    el.setAttribute('lang', language)
    el.setAttribute('defaultLang', 'en')
    el.setAttribute('endpoint', 'about:blank')
    el.setAttribute('limit', '200')
    el.setAttribute('distinct', 'true')
    el.setAttribute('prefixes', `vend:${BASE_PREFIX} vendrel:${REL_PREFIX} vendprop:${PROP_PREFIX}`)
  }, [config, language])

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
              if (predicate === SPAR_CONTROLLED_VALUE_PREDICATE) {
                callback(controlledItems)
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
  }, [controlledItems])

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
      const expanded = el.expandSparql(detail.queryString)
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
      <spar-natural ref={handleRef} />
      {disabled ? <div className="sparql-builder__overlay" /> : null}
    </div>
  )
}
