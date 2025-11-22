import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react'
import type { RecordRow } from '../../types'
import type { WorkspaceTabStateWorkspace } from '../../workspace/types'
import { deriveInternalIdFromArk } from '../../lib/ark'
import type { WorkspaceContextMenuState } from './types'

type Params = {
  state: WorkspaceTabStateWorkspace
  onStateChange: (updater: (prev: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  getById: (id: string) => RecordRow | null
  getByArk: (ark: string) => RecordRow | null
  openRecordForArk: (ark: string, options?: { detach?: boolean }) => void
}

export function useWorkspaceInteractions({ state, onStateChange, getById, getByArk, openRecordForArk }: Params) {
  const listPanelRef = useRef<HTMLElement | null>(null)
  const detailsPanelRef = useRef<HTMLElement | null>(null)
  const lastScrollKeyRef = useRef<string>('')
  const [contextMenu, setContextMenu] = useState<WorkspaceContextMenuState | null>(null)

  useLayoutEffect(() => {
    const listNode = listPanelRef.current
    if (!listNode) return
    if (Math.abs(listNode.scrollTop - state.listScrollTop) > 1) {
      listNode.scrollTop = state.listScrollTop
    }
  }, [state.listScrollTop])

  useLayoutEffect(() => {
    const detailsNode = detailsPanelRef.current
    if (!detailsNode) return
    if (Math.abs(detailsNode.scrollTop - state.detailsScrollTop) > 1) {
      detailsNode.scrollTop = state.detailsScrollTop
    }
  }, [state.detailsScrollTop])

  const handleListScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const target = event.currentTarget
      const next = target.scrollTop
      onStateChange(prev => (Math.abs(prev.listScrollTop - next) < 0.5 ? prev : { ...prev, listScrollTop: next }))
    },
    [onStateChange],
  )

  const handleDetailsScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const target = event.currentTarget
      const next = target.scrollTop
      onStateChange(prev => (Math.abs(prev.detailsScrollTop - next) < 0.5 ? prev : { ...prev, detailsScrollTop: next }))
    },
    [onStateChange],
  )

  const scrollHighlightedEntityIntoView = useCallback(() => {
    if (typeof window === 'undefined') return
    const container = listPanelRef.current
    if (!container) return
    window.requestAnimationFrame(() => {
      const target =
        container.querySelector<HTMLElement>('.entity-row.selected') ||
        container.querySelector<HTMLElement>('.entity-row.highlight') ||
        container.querySelector<HTMLElement>('.manifestation-section.highlight')
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'auto' })
    })
  }, [])

  useEffect(() => {
    const selectedKey = state.selectedEntity ? `${state.selectedEntity.entityType}:${state.selectedEntity.id}` : ''
    const key = `${state.viewMode}|${state.listScope}|${selectedKey}|${state.highlightedWorkArk ?? ''}|${state.highlightedExpressionArk ?? ''}`
    if (lastScrollKeyRef.current === key) return
    lastScrollKeyRef.current = key
    scrollHighlightedEntityIntoView()
  }, [
    scrollHighlightedEntityIntoView,
    state.highlightedExpressionArk,
    state.highlightedWorkArk,
    state.listScope,
    state.selectedEntity,
    state.selectedEntity?.entityType,
    state.selectedEntity?.id,
    state.viewMode,
  ])

  const resolveRecordFromRow = useCallback(
    (row: HTMLElement): RecordRow | null => {
      if (row.classList.contains('entity-row--work')) {
        const workId = row.dataset.workId
        const workArk = row.dataset.workArk
        const record = (workId ? getById(workId) : undefined) ?? (workArk ? getByArk(workArk) : undefined)
        return record ?? null
      }
      if (row.classList.contains('entity-row--expression')) {
        const expressionId = row.dataset.expressionId
        const expressionArk = row.dataset.expressionArk
        const record =
          (expressionId ? getById(expressionId) : undefined) ??
          (expressionArk ? getByArk(expressionArk) : undefined)
        return record ?? null
      }
      if (row.classList.contains('entity-row--manifestation')) {
        const manifestationId = row.dataset.manifestationId
        const record = manifestationId ? getById(manifestationId) ?? getByArk(manifestationId) : undefined
        return record ?? null
      }
      return null
    },
    [getByArk, getById],
  )

  const handleRecordContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null
      const arkLink = target?.closest<HTMLElement>('.ark-link')
      if (!arkLink) return
      const rawArk = arkLink.getAttribute('data-ark')
      if (!rawArk) return
      const trimmedArk = rawArk.trim()
      if (!trimmedArk) return
      let targetRecord = getByArk(trimmedArk)
      if (!targetRecord) {
        const fallbackId = deriveInternalIdFromArk(trimmedArk)
        if (fallbackId) targetRecord = getById(fallbackId)
      }
      if (!targetRecord) return
      event.preventDefault()
      setContextMenu({ position: { x: event.clientX, y: event.clientY }, record: targetRecord })
    },
    [getByArk, getById],
  )

  const handleCloseContextMenu = useCallback(() => setContextMenu(null), [])

  useEffect(() => {
    if (!contextMenu) return undefined
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      if (!target) return
      if (target.closest('.workspace-context-menu')) return
      if (target.closest('.ark-link')) return
      if (target.closest('.entity-row')) return
      handleCloseContextMenu()
    }
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCloseContextMenu()
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [contextMenu, handleCloseContextMenu])

  useEffect(() => {
    const listNode = listPanelRef.current
    if (!listNode) return undefined
    const handleContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null
      const row = target?.closest<HTMLElement>('.entity-row')
      if (!row) return
      const record = resolveRecordFromRow(row)
      if (!record) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ position: { x: event.clientX, y: event.clientY }, record })
    }
    listNode.addEventListener('contextmenu', handleContextMenu)
    return () => listNode.removeEventListener('contextmenu', handleContextMenu)
  }, [resolveRecordFromRow])

  const handleArkClick = useCallback(
    (ark: string, context: { zone: string; subfield: string }) => {
      const zone = context.zone?.trim()
      if (!zone) return
      if (zone === '140' || zone === '750' || zone === '740' || zone === '540') {
        openRecordForArk(ark)
      }
    },
    [openRecordForArk],
  )

  return {
    listPanelRef,
    detailsPanelRef,
    contextMenu,
    setContextMenu,
    handleListScroll,
    handleDetailsScroll,
    handleRecordContextMenu,
    handleArkClick,
    handleCloseContextMenu,
  }
}
