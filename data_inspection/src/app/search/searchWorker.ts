/// <reference lib="webworker" />

import { buildSearchGraph } from './graph'
import { serializeTerm } from './types'
import type { WorkerRequest, WorkerResponse } from './workerTypes'
import type { QueryResultResponse, QueryErrorResponse } from './workerTypes'

import type { Term } from 'oxigraph'

let currentStore: import('oxigraph/web.js').Store | null = null
let activeBuildRequest: number | null = null

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope

function postMessageSafe(message: WorkerResponse) {
  ctx.postMessage(message)
}

function handleQuery(requestId: number, query: string) {
  if (!currentStore) {
    const errorMessage: QueryErrorResponse = {
      type: 'query-error',
      requestId,
      error: 'Search index is not ready yet',
    }
    postMessageSafe(errorMessage)
    return
  }

  try {
    const result = currentStore.query(query)
    if (typeof result === 'boolean') {
      const payload: QueryResultResponse = {
        type: 'query-result',
        requestId,
        result: { kind: 'boolean', value: result },
      }
      postMessageSafe(payload)
      return
    }

    if (Array.isArray(result)) {
      if (!result.length) {
        const payload: QueryResultResponse = {
          type: 'query-result',
          requestId,
          result: { kind: 'select', variables: [], rows: [] },
        }
        postMessageSafe(payload)
        return
      }
      const first = result[0]
      if (first instanceof Map) {
        const variables = Array.from(first.keys())
        const rows = result.map(row => {
          const rowMap = row as Map<string, Term>
          const converted: Record<string, ReturnType<typeof serializeTerm>> = {}
          for (const variable of variables) {
            const term = rowMap.get(variable)
            if (term) {
              converted[variable] = serializeTerm(term)
            }
          }
          return converted
        })
        const payload: QueryResultResponse = {
          type: 'query-result',
          requestId,
          result: { kind: 'select', variables, rows },
        }
        postMessageSafe(payload)
        return
      }
      const quads = (result as Array<{ toString(): string }>).map(q => q.toString())
      const payload: QueryResultResponse = {
        type: 'query-result',
        requestId,
        result: { kind: 'construct', quads },
      }
      postMessageSafe(payload)
      return
    }

    if (typeof result === 'string') {
      const payload: QueryResultResponse = {
        type: 'query-result',
        requestId,
        result: { kind: 'construct', quads: [result] },
      }
      postMessageSafe(payload)
      return
    }

    const payload: QueryResultResponse = {
      type: 'query-result',
      requestId,
      result: { kind: 'empty' },
    }
    postMessageSafe(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const payload: QueryErrorResponse = { type: 'query-error', requestId, error: message }
    postMessageSafe(payload)
  }
}

ctx.addEventListener('message', event => {
  const data = event.data as WorkerRequest
  if (!data) return
  switch (data.type) {
    case 'reset': {
      activeBuildRequest = null
      currentStore = null
      break
    }
    case 'build': {
      const { requestId, records } = data
      activeBuildRequest = requestId
      currentStore = null
      void buildSearchGraph(records, {
        onProgress: progress => {
          if (activeBuildRequest !== requestId) return
          postMessageSafe({ type: 'progress', requestId, progress })
        },
      })
        .then(result => {
          if (activeBuildRequest !== requestId) return
          currentStore = result.store
          postMessageSafe({ type: 'built', requestId, metadata: result.metadata })
        })
        .catch(error => {
          if (activeBuildRequest !== requestId) return
          const message = error instanceof Error ? error.message : String(error)
          postMessageSafe({ type: 'build-error', requestId, error: message })
        })
      break
    }
    case 'query': {
      handleQuery(data.requestId, data.query)
      break
    }
    default:
      break
  }
})
