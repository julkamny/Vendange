import type { InventoryScope, SelectedEntity } from '../types'

export type ViewMode = 'works' | 'expressions' | 'manifestations'

export type WorkspaceTabKind = 'workspace' | 'sql'

export type SqlQueryRow = Record<string, unknown>

export type SqlQueryResult = { columns: string[]; rows: SqlQueryRow[] }

export type WorkspaceTabStateWorkspace = {
  kind: 'workspace'
  id: string
  title: string
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
}

export type WorkspaceTabStateSql = {
  kind: 'sql'
  id: string
  title: string
  query: string
  lastRunSql: string | null
  lastRunError: string | null
  isExecuting: boolean
  result: SqlQueryResult | null
  hiddenColumns: Set<string>
  sort: { column: string; direction: 'asc' | 'desc' } | null
}

export type WorkspaceTabState = WorkspaceTabStateWorkspace | WorkspaceTabStateSql

export const DEFAULT_WORKSPACE_STATE: Omit<WorkspaceTabStateWorkspace, 'id' | 'title'> = {
  kind: 'workspace',
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
}

export function createDefaultSqlState(id: string, title: string): WorkspaceTabStateSql {
  return {
    kind: 'sql',
    id,
    title,
    query: '',
    lastRunSql: null,
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

export function isSqlTab(tab: WorkspaceTabState): tab is WorkspaceTabStateSql {
  return tab.kind === 'sql'
}
