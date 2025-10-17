import type { InventoryScope, SelectedEntity } from '../types'

export type ViewMode = 'works' | 'expressions' | 'manifestations'

export type WorkspaceTabState = {
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

export const DEFAULT_WORKSPACE_STATE: Omit<WorkspaceTabState, 'id' | 'title'> = {
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
