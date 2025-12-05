import type { RecordRow } from '../../types'

export type WorkspaceContextMenuState = {
  position: { x: number; y: number }
  record: RecordRow
  source: 'entity-row' | 'intermarc-link' | 'backlinks-link' | 'ark-link'
}
