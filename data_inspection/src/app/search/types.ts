import type { Term } from 'oxigraph'

export type QueryTerm = {
  termType: string
  value: string
  language?: string
  datatype?: string
}

export type QueryBindingRow = Record<string, QueryTerm>

export type SelectResult = {
  kind: 'select'
  variables: string[]
  rows: QueryBindingRow[]
}

export type BooleanResult = {
  kind: 'boolean'
  value: boolean
}

export type ConstructResult = {
  kind: 'construct'
  quads: string[]
}

export type EmptyResult = { kind: 'empty' }

export type QueryExecutionResult = SelectResult | BooleanResult | ConstructResult | EmptyResult

export function serializeTerm(term: Term): QueryTerm {
  switch (term.termType) {
    case 'NamedNode':
    case 'BlankNode':
      return { termType: term.termType, value: term.value }
    case 'Literal':
      return {
        termType: term.termType,
        value: term.value,
        language: term.language || undefined,
        datatype: term.datatype?.value,
      }
    default:
      return { termType: term.termType, value: term.value }
  }
}
