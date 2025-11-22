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

export type InventoryScope = 'clusters' | 'inventory'

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
