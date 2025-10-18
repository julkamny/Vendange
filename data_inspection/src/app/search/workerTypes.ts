import type { RecordRow } from '../types'
import type { QueryExecutionResult } from './types'
import type { BuildProgressUpdate, SearchGraphMetadata } from './graph'

export type BuildRequest = {
  type: 'build'
  requestId: number
  records: RecordRow[]
}

export type QueryRequest = {
  type: 'query'
  requestId: number
  query: string
}

export type ResetRequest = {
  type: 'reset'
}

export type WorkerRequest = BuildRequest | QueryRequest | ResetRequest

export type BuildProgressResponse = {
  type: 'progress'
  requestId: number
  progress: BuildProgressUpdate
}

export type BuildSuccessResponse = {
  type: 'built'
  requestId: number
  metadata: SearchGraphMetadata
}

export type BuildErrorResponse = {
  type: 'build-error'
  requestId: number
  error: string
}

export type QueryResultResponse = {
  type: 'query-result'
  requestId: number
  result: QueryExecutionResult
}

export type QueryErrorResponse = {
  type: 'query-error'
  requestId: number
  error: string
}

export type WorkerResponse =
  | BuildProgressResponse
  | BuildSuccessResponse
  | BuildErrorResponse
  | QueryResultResponse
  | QueryErrorResponse
