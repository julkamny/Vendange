import type { Intermarc } from './lib/intermarc'

export type CsvTable = { headers: string[]; rows: string[][] }

export type RecordRow = {
  id: string
  type: string
  typeNorm: string
  ark?: string
  rowIndex: number
  intermarcStr: string
  intermarc: Intermarc
  raw: string[]
}

export type DatasetStats = {
  entityCount: number
  quadCount: number
  sizeBytes: number
}

export type DatasetSummary = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  sourceFilename?: string | null
  lastClusteredAt?: string | null
  stats: DatasetStats
}

export type ClusterItem = {
  ark: string
  id?: string
  title?: string
  accepted: boolean
  date?: string
  origin: 'script' | 'manual'
}
export type ManifestationItem = {
  id: string
  ark: string
  title?: string
  expressionArk: string
  expressionId?: string
  originalExpressionArk: string
}

export type ExpressionItem = {
  id: string
  ark: string
  title?: string
  workArk: string
  workId?: string
  manifestations: ManifestationItem[]
}

export type ExpressionClusterItem = ExpressionItem & {
  anchorExpressionId: string
  accepted: boolean
  date?: string
  origin: 'script' | 'manual'
}

export type ManifestationDragPayload = {
  clusterAnchorId: string
  sourceAnchorExpressionId: string | null
  sourceExpressionArk: string
  manifestationId: string
}

export type SelectedEntity = {
  id: string
  source: 'curated'
  entityType?:
    | 'work'
    | 'expression'
    | 'manifestation'
    | 'person'
    | 'collective'
    | 'brand'
    | 'deweyConcept'
    | 'concept'
    | 'controlled'
  clusterAnchorId?: string
  isAnchor?: boolean
  workArk?: string
  expressionId?: string
  expressionArk?: string
}

export type ExpressionAnchorGroup = {
  anchor: ExpressionItem
  clustered: ExpressionClusterItem[]
}

export type Cluster = {
  anchorId: string
  anchorArk: string
  anchorTitle?: string
  items: ClusterItem[]
  expressionGroups: ExpressionAnchorGroup[]
  independentExpressions: ExpressionItem[]
}

export type EntitySummary = {
  counts?: { expressions?: number; manifestations?: number }
  relationships?: { outgoing: number; incoming: number }
  mediaKinds?: { emoji: string; label: string; kindCode: string }[]
}

export type ManifestationItemViewDto = {
  id: string
  ark?: string | null
  title?: string | null
  expression_ark?: string | null
  expression_id?: string | null
  original_expression_ark?: string | null
  summary?: EntitySummary | null
}

export type ExpressionItemViewDto = {
  id: string
  ark?: string | null
  title?: string | null
  work_ark?: string | null
  work_id?: string | null
  manifestations?: ManifestationItemViewDto[]
  summary?: EntitySummary | null
}

export type ExpressionClusterItemViewDto = ExpressionItemViewDto & {
  anchor_expression_id: string
  accepted: boolean
  date?: string | null
  origin: 'script' | 'manual'
}

export type ExpressionAnchorGroupViewDto = {
  anchor: ExpressionItemViewDto
  clustered: ExpressionClusterItemViewDto[]
}

export type WorkClusterItemDto = {
  ark: string
  id?: string | null
  title?: string | null
  accepted: boolean
  date?: string | null
  origin: 'script' | 'manual'
  summary?: EntitySummary | null
}

export type WorkClusterDto = {
  anchor_id: string
  anchor_ark?: string | null
  anchor_title?: string | null
  anchor_summary?: EntitySummary | null
  items: WorkClusterItemDto[]
  expression_groups: ExpressionAnchorGroupViewDto[]
  independent_expressions: ExpressionItemViewDto[]
}

export type WorkListRowDto = {
  id: string
  ark?: string | null
  title?: string | null
  type_norm: string
  summary?: EntitySummary | null
}

export type WorkspaceWorksResponse = {
  clusters: WorkClusterDto[]
  unclustered_works: WorkListRowDto[]
}

export type AgentClusterItemDto = {
  ark: string
  id?: string | null
  label?: string | null
}

export type AgentClusterDto = {
  anchor_id: string
  anchor_ark?: string | null
  anchor_label?: string | null
  items: AgentClusterItemDto[]
}

export type AgentListRowDto = {
  id: string
  ark?: string | null
  label?: string | null
  type_norm: string
}

export type WorkspaceAgentsResponse = {
  clusters: AgentClusterDto[]
  unclustered_agents: AgentListRowDto[]
}

export type WorkRecordPayload = {
  id: string
  type: string
  ark?: string | null
  intermarc: string
}

export type InventoryEntityType =
  | 'work'
  | 'expression'
  | 'manifestation'
  | 'person'
  | 'collective'
  | 'brand'
  | 'deweyConcept'
  | 'concept'
  | 'controlled'

export type InventoryScope = 'clusters'

export type EntityPillKind =
  | 'work'
  | 'expression'
  | 'manifestation'
  | 'person'
  | 'collective'
  | 'family'
  | 'brand'
  | 'deweyConcept'
  | 'concept'
  | 'controlled'

export type EntityBadgeSpec = {
  type: EntityPillKind
  text: string
  tooltip?: string
}

export type EntityTitleSegment = {
  code: string
  label: string
  value: string
}

export type CountBadgeKind = 'expressions' | 'manifestations' | 'works' | 'workLinks' | 'expressionLinks'

export type InventoryEntityContext = {
  workArk?: string | null
  expressionId?: string | null
  expressionArk?: string | null
}

export type InventoryRow =
  | { kind: 'header'; label: string; count: number }
  | {
      kind: 'entity'
      entityType: InventoryEntityType
      record: RecordRow
      source: 'curated'
      title: string
      subtitle?: string
      badges?: EntityBadgeSpec[]
      counts?: Partial<Record<CountBadgeKind, number>>
      context?: InventoryEntityContext
    }

export type InventoryEntityRow = Extract<InventoryRow, { kind: 'entity' }>

export type ThemeMode = 'light' | 'dark'

export type ShortcutAction =
  | 'focusUp'
  | 'focusDown'
  | 'listUp'
  | 'listDown'
  | 'nextWorkspace'
  | 'previousWorkspace'
  | 'toggleBacklinks'
  | 'toggleList'
  | 'toggleIntermarc'
  | 'toggleDetachTab'
  | 'arrangeTile'
  | 'arrangeCascade'

export type ShortcutConfig = {
  action: ShortcutAction
  labelKey: string
  descriptionKey: string
  defaultBinding: string
}
