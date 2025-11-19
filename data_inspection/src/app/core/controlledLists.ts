import { CONTROLLED_LIST_VALUES, CONTROLLED_SUBFIELD_LISTS, CONTROLLED_SUBFIELD_WILDCARDS } from '../data/controlledListsData'

const EMPTY: readonly string[] = []

type LabelLookup = Record<string, readonly string[]>

function createMap(source: Record<string, readonly string[]>): Map<string, readonly string[]> {
  const map = new Map<string, readonly string[]>()
  Object.entries(source).forEach(([key, lists]) => {
    const normalized = key.trim()
    if (!normalized) return
    const unique = Array.from(new Set(lists.filter(Boolean)))
    map.set(normalized, unique)
  })
  return map
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildLabelLookup(): LabelLookup {
  const entries: LabelLookup = {}
  Object.entries(CONTROLLED_LIST_VALUES).forEach(([listName, values]) => {
    values.forEach(label => {
      const normalized = normalizeLabel(label)
      if (!normalized) return
      if (!entries[normalized]) entries[normalized] = []
      if (!entries[normalized].includes(listName)) {
        entries[normalized] = [...entries[normalized], listName]
      }
    })
  })
  return entries
}

const CONTROLLED_SUBFIELD_MAP = createMap(CONTROLLED_SUBFIELD_LISTS)
const CONTROLLED_SUBFIELD_WILDCARD_MAP = createMap(CONTROLLED_SUBFIELD_WILDCARDS)
const CONTROLLED_LABEL_LOOKUP = buildLabelLookup()

export const CONTROLLED_LIST_NAMES = Object.keys(CONTROLLED_LIST_VALUES)

function wildcardKey(subfield: string): string | null {
  const idx = subfield.indexOf('$')
  if (idx === -1) return null
  return subfield.slice(idx)
}

export function getControlledListsForSubfield(subfield: string | undefined | null): readonly string[] {
  if (!subfield) return EMPTY
  const normalized = subfield.trim()
  if (!normalized) return EMPTY
  const direct = CONTROLLED_SUBFIELD_MAP.get(normalized)
  if (direct && direct.length) return direct
  const wildcard = wildcardKey(normalized)
  if (wildcard) {
    const wildcardLists = CONTROLLED_SUBFIELD_WILDCARD_MAP.get(wildcard)
    if (wildcardLists && wildcardLists.length) return wildcardLists
  }
  return EMPTY
}

export function getControlledListsForLabel(label: string | undefined | null): readonly string[] {
  if (!label) return EMPTY
  const normalized = normalizeLabel(label)
  if (!normalized) return EMPTY
  return CONTROLLED_LABEL_LOOKUP[normalized] ?? EMPTY
}

export function hasControlledListsForSubfield(subfield: string | undefined | null): boolean {
  const lists = getControlledListsForSubfield(subfield)
  return lists.length > 0
}

export function getControlledListValues(listName: string): readonly string[] {
  return (CONTROLLED_LIST_VALUES[listName] as readonly string[]) ?? EMPTY
}
