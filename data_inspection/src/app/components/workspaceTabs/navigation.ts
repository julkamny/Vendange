import type { AgentTabState, WorkspaceTabState, WorkspaceTabStateWorkspace } from '../../workspace/types'
import { isAgentTab } from '../../workspace/types'

type NavigationDirection = 'up' | 'down'

type WorkListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  workId: string
  workArk: string
}

type ExpressionListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  expressionId: string
  expressionArk: string
}

type ManifestationListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  manifestationId: string
}

type AgentListEntry = {
  row: HTMLElement
  trigger: HTMLElement
  agentId: string
}

export function navigateList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (state.viewMode === 'works') {
    navigateWorkList(direction, state, rootDocument)
  } else if (state.viewMode === 'expressions') {
    navigateExpressionList(direction, state, rootDocument)
  } else if (state.viewMode === 'manifestations') {
    navigateManifestationList(direction, state, rootDocument)
  }
}

export function navigateAgentList(
  direction: NavigationDirection,
  state: AgentTabState,
  setTabs: (updater: (prev: WorkspaceTabState[]) => WorkspaceTabState[]) => void,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector(`.workspace-tab-panel[data-tab-id="${state.id}"] .work-list-panel`)
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row'))
  if (!rows.length) return

  const entries: AgentListEntry[] = rows
    .map(row => {
      const trigger = row
      const agentId = row.dataset.agentId || ''
      if (!agentId) return null
      return { row, trigger, agentId }
    })
    .filter((entry): entry is AgentListEntry => !!entry && !!entry.agentId)

  if (!entries.length) return

  const currentId = state.selectedAgentId
  const currentIndex = currentId ? entries.findIndex(entry => entry.agentId === currentId) : -1
  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  const target = entries[nextIndex]
  activateEntry(target)
  setTabs(prev =>
    prev.map(tab =>
      isAgentTab(tab) && tab.id === state.id
        ? { ...tab, selectedAgentId: target.agentId, highlightedAgentId: target.agentId }
        : tab,
    ),
  )
}

export function navigateWorkList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector(`.workspace-tab-panel[data-tab-id="${state.id}"] .work-list-panel`)
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--work'))
  if (!rows.length) return

  const entries = rows
    .map(row => {
      const trigger =
        row.classList.contains('cluster-header-row') ? row.querySelector<HTMLElement>('.cluster-header') : row
      if (!trigger) return null
      return {
        row,
        trigger,
        workId: row.dataset.workId || '',
        workArk: row.dataset.workArk || '',
      }
    })
    .filter((entry): entry is WorkListEntry => !!entry && (!!entry.workId || !!entry.workArk))

  if (!entries.length) return

  const currentWorkId = state.selectedEntity?.entityType === 'work' ? state.selectedEntity.id : null
  const currentWorkArk =
    state.selectedEntity?.entityType === 'work'
      ? state.selectedEntity.workArk ?? null
      : state.highlightedWorkArk ?? null

  const currentIndex = entries.findIndex(entry => {
    if (currentWorkId && entry.workId === currentWorkId) return true
    if (currentWorkArk && entry.workArk === currentWorkArk) return true
    return false
  })

  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

export function navigateExpressionList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector(
    `.workspace-tab-panel[data-tab-id="${state.id}"] .expression-groups`,
  )
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--expression'))
  if (!rows.length) return

  const entries = rows
    .map(row => ({
      row,
      trigger: row,
      expressionId: row.dataset.expressionId || '',
      expressionArk: row.dataset.expressionArk || '',
    }))
    .filter((entry): entry is ExpressionListEntry => !!entry.expressionId || !!entry.expressionArk)

  if (!entries.length) return

  let currentExpressionId: string | null = null
  let currentExpressionArk: string | null = null
  const selected = state.selectedEntity
  if (selected?.entityType === 'expression') {
    currentExpressionId = selected.expressionId ?? selected.id
    currentExpressionArk = selected.expressionArk ?? null
  } else if (selected?.entityType === 'manifestation') {
    currentExpressionId = selected.expressionId ?? null
    currentExpressionArk = selected.expressionArk ?? null
  } else {
    currentExpressionArk = state.highlightedExpressionArk ?? null
  }

  const currentIndex = entries.findIndex(entry => {
    if (currentExpressionId && entry.expressionId === currentExpressionId) return true
    if (currentExpressionArk && entry.expressionArk === currentExpressionArk) return true
    return false
  })

  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

export function navigateManifestationList(
  direction: NavigationDirection,
  state: WorkspaceTabStateWorkspace,
  rootDocument: Document,
) {
  if (typeof document === 'undefined') return
  const panel = rootDocument.querySelector(
    `.workspace-tab-panel[data-tab-id="${state.id}"] .manifestation-panel`,
  )
  if (!panel) return
  const rows = Array.from(panel.querySelectorAll<HTMLElement>('.entity-row--manifestation'))
  if (!rows.length) return

  const entries = rows
    .map(row => {
      const trigger = row.querySelector<HTMLElement>('.manifestation-item__main') ?? row
      if (!trigger) return null
      return {
        row,
        trigger,
        manifestationId: row.dataset.manifestationId || '',
      }
    })
    .filter((entry): entry is ManifestationListEntry => !!entry && !!entry.manifestationId)

  if (!entries.length) return

  const currentId = state.selectedEntity?.entityType === 'manifestation' ? state.selectedEntity.id : null
  const currentIndex = currentId ? entries.findIndex(entry => entry.manifestationId === currentId) : -1
  const nextIndex = computeNextIndex(entries.length, currentIndex, direction)
  if (nextIndex === null) return
  activateEntry(entries[nextIndex])
}

function computeNextIndex(length: number, currentIndex: number, direction: NavigationDirection): number | null {
  if (!length) return null
  const delta = direction === 'down' ? 1 : -1
  let index = currentIndex
  if (index === -1) index = direction === 'down' ? -1 : length
  let next = index + delta
  if (next < 0) next = 0
  if (next >= length) next = length - 1
  if (currentIndex >= 0 && next === currentIndex) return null
  return next
}

function activateEntry(entry: { row: HTMLElement; trigger: HTMLElement }) {
  entry.trigger.click()
  if (entry.row.scrollIntoView) {
    entry.row.scrollIntoView({ block: 'center', behavior: 'auto' })
  }
}
