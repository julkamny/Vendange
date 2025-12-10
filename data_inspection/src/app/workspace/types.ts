import type { InventoryScope, SelectedEntity } from '../types'

export type ViewMode = 'works' | 'expressions' | 'manifestations'

export type WorkspaceTabKind = 'workspace' | 'sparql' | 'agent'

export type SparqlQueryRow = Record<string, unknown>

export type SparqlQueryResult = { columns: string[]; rows: SparqlQueryRow[] }

export type WorkspaceTabStateWorkspace = {
  kind: 'workspace'
  id: string
  title: string
  mode: 'inline' | 'detached'
  detachedWindowId: string | null
  intermarcFullView: boolean
  backlinksExpanded: boolean
  listCollapsed: boolean
  listScope: InventoryScope
  viewMode: ViewMode
  activeWorkAnchorId: string | null
  highlightedWorkArk: string | null | undefined
  activeExpressionAnchorId: string | null
  highlightedExpressionArk: string | null
  expressionFilterArk: string | null
  selectedEntity: SelectedEntity | null
  listScrollTop: number
  detailsScrollTop: number
}

export type AgentTabState = {
  kind: 'agent'
  id: string
  title: string
  mode: 'inline' | 'detached'
  detachedWindowId: string | null
  intermarcFullView: boolean
  backlinksExpanded: boolean
  listCollapsed: boolean
  selectedAgentId: string | null
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
  arkFilterColumns: {
    work: string[]
    agent: string[]
  }
}

export type WorkspaceTabState = WorkspaceTabStateWorkspace | WorkspaceTabStateSparql | AgentTabState

/**
 * Tabs that rely on the workspace layout (list + details + backlinks/intermarc controls).
 * This covers both the WEM workspace and the Agents workspace.
 */
export type WorkspaceLayoutTabState = WorkspaceTabStateWorkspace | AgentTabState

export type ArkFilterColumns = {
  work: string[]
  agent: string[]
}

export type ArkFilterSource = {
  tabId: string
  tabTitle: string
  workColumns: string[]
  agentColumns: string[]
}

export type ArkFilterPayload = {
  workArks: string[]
  agentArks: string[]
  source: ArkFilterSource
}

export type GlobalArkFilterState = {
  workArks: string[]
  agentArks: string[]
  source: ArkFilterSource | null
}

export const DEFAULT_WORKSPACE_STATE: Omit<WorkspaceTabStateWorkspace, 'id' | 'title'> = {
  kind: 'workspace',
  mode: 'inline',
  detachedWindowId: null,
  intermarcFullView: false,
  backlinksExpanded: false,
  listCollapsed: false,
  listScope: 'clusters',
  viewMode: 'works',
  activeWorkAnchorId: null,
  highlightedWorkArk: undefined,
  activeExpressionAnchorId: null,
  highlightedExpressionArk: null,
  expressionFilterArk: null,
  selectedEntity: null,
  listScrollTop: 0,
  detailsScrollTop: 0,
}

export const DEFAULT_AGENT_STATE: Omit<AgentTabState, 'id' | 'title'> = {
  kind: 'agent',
  mode: 'inline',
  detachedWindowId: null,
  intermarcFullView: false,
  backlinksExpanded: false,
  listCollapsed: false,
  selectedAgentId: null,
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
    arkFilterColumns: { work: [], agent: [] },
  }
}

export function isWorkspaceTab(tab: WorkspaceTabState): tab is WorkspaceTabStateWorkspace {
  return tab.kind === 'workspace'
}

export function isSparqlTab(tab: WorkspaceTabState): tab is WorkspaceTabStateSparql {
  return tab.kind === 'sparql'
}

export function isAgentTab(tab: WorkspaceTabState): tab is AgentTabState {
  return tab.kind === 'agent'
}

export function isWorkspaceLayoutTab(tab: WorkspaceTabState): tab is WorkspaceLayoutTabState {
  return tab.kind === 'workspace' || tab.kind === 'agent'
}
