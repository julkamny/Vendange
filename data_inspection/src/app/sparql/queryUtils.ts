import {
  Generator,
  Parser,
  type BgpPattern,
  type Pattern,
  type Query,
  type Term,
  type Triple,
  type VariableTerm,
} from 'sparqljs'
import type { Term as RdfTerm } from '@rdfjs/types'
import { BASE_NS, CLASS_NS, REL_NS } from './sparnaturalConfig'

const GRAPH_REGEX = /\bGRAPH\b/i
const RDF_TYPE_IRI = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

const parser = new Parser({ skipUngroupedVariableCheck: true })
const generator = new Generator({ allPrefixes: true })
const graphVariableCache = new Map<string, VariableTerm>()

export function ensureGraphWrapping(rawQuery: string): string {
  const query = rawQuery.trim()
  if (!query) return query
  const stripped = stripComments(query)

  const entityScoped = tryScopeEntitiesByGraph(query)
  if (entityScoped) return entityScoped

  if (GRAPH_REGEX.test(stripped)) return query

  return wrapWholeQuery(query)
}

function tryScopeEntitiesByGraph(query: string): string | null {
  let parsed: Query
  try {
    const result = parser.parse(query)
    if (result.type !== 'query') return null
    parsed = result
  } catch {
    return null
  }

  if (!parsed.where || parsed.where.length === 0) return null

  const allTriples: Triple[] = []
  parsed.where.forEach(pattern => {
    if (pattern.type === 'bgp') {
      allTriples.push(...pattern.triples)
    }
  })

  const entityVariables = collectEntityVariables(allTriples)
  if (!entityVariables.size) return null

  const tracker = new ScopeTracker(entityVariables)
  for (const triple of allTriples) {
    const subject = getVariableName(triple.subject)
    const object = getVariableName(triple.object)
    if (!subject || !object) continue
    if (isRelationPredicate(triple.predicate)) continue
    if (isStructuralPredicate(triple.predicate)) {
      tracker.union(subject, object)
      continue
    }
    tracker.union(subject, object)
  }

  let changed = false
  const rewrittenWhere: Pattern[] = []

  for (const pattern of parsed.where) {
    if (pattern.type !== 'bgp') {
      rewrittenWhere.push(pattern)
      continue
    }
    const replacements = splitBgpByEntityGraphs(pattern, entityVariables, tracker)
    if (!replacements) {
      rewrittenWhere.push(pattern)
      continue
    }
    changed = true
    rewrittenWhere.push(...replacements)
  }

  if (!changed) return null

  const nextQuery: Query = { ...parsed, where: rewrittenWhere }
  return generator.stringify(nextQuery)
}

function splitBgpByEntityGraphs(
  pattern: BgpPattern,
  entityVariables: Set<string>,
  tracker: ScopeTracker,
): Pattern[] | null {
  if (!pattern.triples.length) return null

  const grouped = new Map<string, { triples: Triple[]; index: number }>()
  const leftovers: Triple[] = []

  pattern.triples.forEach((triple, index) => {
    const subject = getVariableName(triple.subject)
    const object = getVariableName(triple.object)
    const targetVariable = isRelationPredicate(triple.predicate)
      ? pickRelationTargetVariable(triple, subject, object)
      : subject
    if (!targetVariable) {
      leftovers.push(triple)
      return
    }
    const scope = tracker.find(targetVariable)
    if (!scope || !entityVariables.has(scope)) {
      leftovers.push(triple)
      return
    }
    let group = grouped.get(scope)
    if (!group) {
      group = { triples: [], index }
      grouped.set(scope, group)
    }
    group.triples.push(triple)
  })

  if (!grouped.size) return null

  const patterns: Pattern[] = Array.from(grouped.entries())
    .sort((a, b) => a[1].index - b[1].index)
    .map(([scope, { triples }]) => ({
      type: 'graph',
      name: getGraphVariable(scope),
      patterns: [{ type: 'bgp', triples }],
    }))

  if (leftovers.length) {
    patterns.push({ type: 'bgp', triples: leftovers })
  }

  return patterns
}

function collectEntityVariables(triples: Triple[]): Set<string> {
  const entities = new Set<string>()
  for (const triple of triples) {
    if (!isEntityTypeTriple(triple)) continue
    const subject = getVariableName(triple.subject)
    if (subject) entities.add(subject)
  }
  return entities
}

function isEntityTypeTriple(triple: Triple): boolean {
  if (!isNamedNode(triple.predicate) || triple.predicate.value !== RDF_TYPE_IRI) return false
  return isNamedNode(triple.object) && triple.object.value.startsWith(CLASS_NS)
}

function getVariableName(term: Term | undefined): string | null {
  if (!term) return null
  if ('termType' in term && term.termType === 'Variable') {
    return term.value
  }
  return null
}

function isNamedNode(value: Term | unknown): value is { termType: 'NamedNode'; value: string } {
  return typeof value === 'object' && value !== null && 'termType' in value && (value as Term).termType === 'NamedNode'
}

function isRelationPredicate(predicate: Triple['predicate']): boolean {
  if (isNamedNode(predicate)) return predicate.value.startsWith(REL_NS)
  if (!predicate || typeof predicate !== 'object') return false
  return pathContainsRelation(predicate)
}

function isStructuralPredicate(predicate: Triple['predicate']): boolean {
  if (!predicate || typeof predicate !== 'object') return false
  if (isNamedNode(predicate)) {
    return predicate.value === `${BASE_NS}/hasField` || predicate.value === `${BASE_NS}/hasSubfield`
  }
  return false
}

function isInverseRelationPredicate(predicate: Triple['predicate']): boolean {
  if (!predicate || typeof predicate !== 'object') return false
  return 'pathType' in predicate && (predicate as { pathType?: string }).pathType === '^'
}

function pickRelationTargetVariable(triple: Triple, subject: string | null, object: string | null): string | null {
  if (isInverseRelationPredicate(triple.predicate)) {
    return object ?? subject
  }
  return subject ?? object
}

function pathContainsRelation(value: unknown): boolean {
  if (!value) return false
  if (isNamedNode(value as Term)) return (value as { value: string }).value.startsWith(REL_NS)
  if (Array.isArray(value)) return value.some(pathContainsRelation)
  if (typeof value === 'object' && value !== null) {
    return Object.values(value as Record<string, unknown>).some(pathContainsRelation)
  }
  return false
}

class ScopeTracker {
  private readonly parent = new Map<string, string>()

  private readonly entityVariables: Set<string>

  constructor(entityVariables: Set<string>) {
    this.entityVariables = entityVariables
  }

  find(name: string): string {
    const current = this.parent.get(name)
    if (!current) return name
    const root = this.find(current)
    if (root !== current) {
      this.parent.set(name, root)
    }
    return root
  }

  union(a: string, b: string): void {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return

    const preferred = this.pickPreferredRoot(rootA, rootB)
    const other = preferred === rootA ? rootB : rootA
    this.parent.set(other, preferred)
  }

  private pickPreferredRoot(a: string, b: string): string {
    const aIsEntity = this.entityVariables.has(a)
    const bIsEntity = this.entityVariables.has(b)
    if (aIsEntity && !bIsEntity) return a
    if (!aIsEntity && bIsEntity) return b
    if (aIsEntity && bIsEntity) return a
    return a.localeCompare(b) <= 0 ? a : b
  }
}

function getGraphVariable(name: string): VariableTerm {
  const key = `${name}_graph`
  const cached = graphVariableCache.get(key)
  if (cached) return cached
  const variable: VariableTerm = {
    termType: 'Variable',
    value: key,
    equals(other?: RdfTerm | null): boolean {
      return Boolean(other && other.termType === 'Variable' && other.value === key)
    },
  }
  graphVariableCache.set(key, variable)
  return variable
}

function wrapWholeQuery(query: string): string {
  const whereMatch = /WHERE\s*\{/i.exec(query)
  if (!whereMatch) return query
  const braceStart = query.indexOf('{', whereMatch.index)
  if (braceStart === -1) return query
  const closingIndex = findMatchingBrace(query, braceStart)
  if (closingIndex === -1) return query

  const before = query.slice(0, braceStart + 1)
  const middle = query.slice(braceStart + 1, closingIndex)
  const after = query.slice(closingIndex)
  return `${before}\n  GRAPH ?g {\n${middle}\n  }\n${after}`
}

function stripComments(value: string): string {
  return value.replace(/#[^\n]*/g, '')
}

function findMatchingBrace(text: string, openingIndex: number): number {
  let depth = 1
  for (let i = openingIndex + 1; i < text.length; i++) {
    const char = text[i]
    if (char === '{') {
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}
