import type { NavigationDirection } from '../types'

export type NavigationTarget = {
  id: string
  ark?: string | null
  anchorId?: string | null
  containerIndex: number
}

export function filterNavigationTargets<T extends NavigationTarget>(
  candidates: T[],
  filterIds: Set<string>,
): T[] {
  if (!filterIds.size) return []
  return candidates.filter(candidate => filterIds.has(candidate.id))
}

export function pickCyclicMatch<T extends NavigationTarget>(
  matches: T[],
  currentId: string | null,
  direction: NavigationDirection,
): T | null {
  if (!matches.length) return null
  const delta = direction === 'next' ? 1 : -1
  const currentIndex = currentId ? matches.findIndex(entry => entry.id === currentId) : -1
  if (currentIndex === -1) {
    return direction === 'next' ? matches[0] : matches[matches.length - 1]
  }
  const nextIndex = (currentIndex + delta + matches.length) % matches.length
  return matches[nextIndex]
}
