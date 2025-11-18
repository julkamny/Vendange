import type { InventoryScope, SelectedEntity } from '../types'

export type ViewMode = 'works' | 'expressions' | 'manifestations'

export type WorkspaceTabKind = 'workspace' | 'sparql'

export type SparqlQueryRow = Record<string, unknown>

export type SparqlQueryResult = { columns: string[]; rows: SparqlQueryRow[] }

export type WorkspaceTabStateWorkspace = {
  kind: 'workspace'
  id: string
  title: string
  mode: 'inline' | 'detached'
  detachedWindowId: string | null
  listScope: InventoryScope
  viewMode: ViewMode
  activeWorkAnchorId: string | null
  highlightedWorkArk: string | null | undefined
  activeExpressionAnchorId: string | null
  highlightedExpressionArk: string | null
  expressionFilterArk: string | null
  selectedEntity: SelectedEntity | null
  inventoryExpressionFilterArk: string | null
  inventoryFocusWorkId: string | null
  inventoryFocusExpressionId: string | null
  listScrollTop: number
  detailsScrollTop: number
}

export type WorkspaceTabStateSparql = {
  kind: 'sparql'
  id: string
  title: string
  query: string
  lastRunQuery: string | null
  lastRunError: string | null
  isExecuting: boolean
  result: SparqlQueryResult | null
  hiddenColumns: Set<string>
  sort: { column: string; direction: 'asc' | 'desc' } | null
}

export type WorkspaceTabState = WorkspaceTabStateWorkspace | WorkspaceTabStateSparql

export const DEFAULT_WORKSPACE_STATE: Omit<WorkspaceTabStateWorkspace, 'id' | 'title'> = {
  kind: 'workspace',
  mode: 'inline',
  detachedWindowId: null,
  listScope: 'clusters',
  viewMode: 'works',
  activeWorkAnchorId: null,
  highlightedWorkArk: undefined,
  activeExpressionAnchorId: null,
  highlightedExpressionArk: null,
  expressionFilterArk: null,
  selectedEntity: null,
  inventoryExpressionFilterArk: null,
  inventoryFocusWorkId: null,
  inventoryFocusExpressionId: null,
  listScrollTop: 0,
  detailsScrollTop: 0,
}

export function createDefaultSparqlState(id: string, title: string): WorkspaceTabStateSparql {
  return {
    kind: 'sparql',
    id,
    title,
    query: '',
    lastRunQuery: null,
    lastRunError: null,
    isExecuting: false,
    result: null,
    hiddenColumns: new Set(),
    sort: null,
  }
}

export function isWorkspaceTab(tab: WorkspaceTabState): tab is WorkspaceTabStateWorkspace {
  return tab.kind === 'workspace'
}

export function isSparqlTab(tab: WorkspaceTabState): tab is WorkspaceTabStateSparql {
  return tab.kind === 'sparql'
}
