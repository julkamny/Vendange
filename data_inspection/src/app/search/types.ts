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

export type SearchGraphMetadata = {
  recordNodeById: Record<string, string>
  recordNodeByArk: Record<string, string>
}

export type BuildProgressPhase = 'indexing' | 'building'

export type BuildProgressUpdate = {
  phase: BuildProgressPhase
  current: number
  total: number
}

export type BuildResponse = {
  jobId: string
}

export type JobStatusResponse = {
  status: 'building' | 'ready' | 'error'
  progress?: BuildProgressUpdate | null
  metadata?: SearchGraphMetadata | null
  error?: string | null
}

export type QueryRequestPayload = {
  query: string
}
