import initOxigraph, {
  Store,
  namedNode,
  literal,
  quad,
  blankNode,
  type NamedNode,
  type BlankNode,
} from 'oxigraph/web.js'
import oxigraphWasmUrl from 'oxigraph/web_bg.wasm?url'
import { manifestationExpressionArks, expressionWorkArks, manifestationTitle, titleOf } from '../core/entities'
import type { RecordRow } from '../types'
import { CLASSES, ENTITY_NS, PREDICATES } from './constants'
import { extractAgentRelations } from '../core/agents'
import { extractGeneralRelationshipTargets } from '../core/generalRelationships'

type SubjectNode = NamedNode | BlankNode

let oxigraphInitPromise: Promise<void> | null = null

async function ensureOxigraphInitialized(): Promise<void> {
  if (!oxigraphInitPromise) {
    oxigraphInitPromise = initOxigraph(oxigraphWasmUrl)
      .then(() => {})
      .catch((err: unknown) => {
        oxigraphInitPromise = null
        throw err
      })
  }
  await oxigraphInitPromise
}

let rdfTypeNode: NamedNode | null = null
let xsdIntegerNode: NamedNode | null = null

function getRdfTypeNode(): NamedNode {
  if (!rdfTypeNode) {
    rdfTypeNode = namedNode(PREDICATES.type)
  }
  return rdfTypeNode
}

function getXsdIntegerNode(): NamedNode {
  if (!xsdIntegerNode) {
    xsdIntegerNode = namedNode('http://www.w3.org/2001/XMLSchema#integer')
  }
  return xsdIntegerNode
}

export type SearchGraphMetadata = {
  recordNodeById: Map<string, string>
  recordNodeByArk: Map<string, string>
}

export type SearchGraphBuildResult = {
  store: Store
  metadata: SearchGraphMetadata
}

export type BuildProgressPhase = 'indexing' | 'building'

export type BuildProgressUpdate = {
  phase: BuildProgressPhase
  current: number
  total: number
}

type BuildGraphOptions = {
  onProgress?: (update: BuildProgressUpdate) => void
}

type PredicateCacheEntry = {
  value: NamedNode
  normalized: NamedNode
}

function normalizeValue(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function safeEncodeId(id: string): string {
  return encodeURIComponent(id)
}

function parseSubfieldCode(code: string): { zone: string; sub: string } {
  if (!code) return { zone: '', sub: '' }
  const dollarIndex = code.indexOf('$')
  if (dollarIndex === -1) {
    return { zone: code, sub: '' }
  }
  return { zone: code.slice(0, dollarIndex), sub: code.slice(dollarIndex + 1) }
}

function sanitizeSegment(segment: string): string {
  if (!segment) return 'value'
  return segment.replace(/[^A-Za-z0-9]/g, '_')
}

function ensureSubfieldPredicate(
  cache: Map<string, PredicateCacheEntry>,
  code: string,
): PredicateCacheEntry {
  const existing = cache.get(code)
  if (existing) return existing
  const { zone, sub } = parseSubfieldCode(code)
  const safeZone = sanitizeSegment(zone)
  const safeSub = sanitizeSegment(sub)
  const base = `${PREDICATES.fieldPredicatePrefix}${safeZone}/${safeSub}`
  const entry: PredicateCacheEntry = {
    value: namedNode(base),
    normalized: namedNode(`${base}${PREDICATES.normalizedSuffix}`),
  }
  cache.set(code, entry)
  return entry
}

function classForRecord(record: RecordRow): string {
  switch (record.typeNorm) {
    case 'oeuvre':
    case 'work':
      return CLASSES.Work
    case 'expression':
      return CLASSES.Expression
    case 'manifestation':
      return CLASSES.Manifestation
    case 'identite publique de personne':
    case 'personne':
      return CLASSES.Agent
    case 'collectivite':
      return CLASSES.Collective
    case 'marque':
      return CLASSES.Brand
    case 'concept dewey':
      return CLASSES.Concept
    case 'valeur controlee':
      return CLASSES.Controlled
    default:
      return CLASSES.Controlled
  }
}

function labelForRecord(record: RecordRow): string {
  if (record.typeNorm === 'manifestation') {
    return manifestationTitle(record) || titleOf(record) || record.id
  }
  const title = titleOf(record)
  if (title && title.length) return title
  return manifestationTitle(record) || record.id
}

function addStringLiteral(subject: SubjectNode, predicate: string, value: string, store: Store) {
  if (!value) return
  store.add(quad(subject, namedNode(predicate), literal(value)))
}

export async function buildSearchGraph(
  records: RecordRow[],
  options: BuildGraphOptions = {},
): Promise<SearchGraphBuildResult> {
  await ensureOxigraphInitialized()
  const RDF_TYPE = getRdfTypeNode()
  const XSD_INTEGER = getXsdIntegerNode()
  const store = new Store()
  const nodeById = new Map<string, NamedNode>()
  const nodeByArk = new Map<string, NamedNode>()
  const predicateCache = new Map<string, PredicateCacheEntry>()
  const byArk = new Map<string, RecordRow>()
  const processed = new Set<string>()

  const totalRecords = records.length
  options.onProgress?.({ phase: 'indexing', current: 0, total: totalRecords })
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    const ark = record.ark?.trim()
    if (ark) {
      byArk.set(ark.toLowerCase(), record)
    }
    options.onProgress?.({ phase: 'indexing', current: index + 1, total: totalRecords })
  }

  const nodeForRecord = (rec: RecordRow): NamedNode => {
    const existing = nodeById.get(rec.id)
    if (existing) return existing
    const node = namedNode(`${ENTITY_NS}${safeEncodeId(rec.id)}`)
    nodeById.set(rec.id, node)
    const ark = rec.ark?.trim()
    if (ark) {
      nodeByArk.set(ark.toLowerCase(), node)
    }
    return node
  }

  const ensureTargetForArk = (ark: string): NamedNode | null => {
    const normalized = ark.trim().toLowerCase()
    if (!normalized) return null
    const existing = nodeByArk.get(normalized)
    if (existing) return existing
    const targetRecord = byArk.get(normalized)
    if (!targetRecord) return null
    return nodeForRecord(targetRecord)
  }

  const attachFieldData = (record: RecordRow, recordNode: NamedNode) => {
    record.intermarc.zones.forEach((zone, zoneIndex) => {
      const fieldNode = blankNode()
      store.add(quad(recordNode, namedNode(PREDICATES.hasField), fieldNode))
      store.add(quad(fieldNode, RDF_TYPE, namedNode(CLASSES.Field)))
      addStringLiteral(fieldNode, PREDICATES.zoneCode, zone.code, store)
      store.add(quad(fieldNode, namedNode(PREDICATES.fieldIndex), literal(String(zoneIndex), XSD_INTEGER)))
      store.add(quad(fieldNode, namedNode(PREDICATES.belongsTo), recordNode))

      zone.sousZones.forEach((sub, subIndex) => {
        if (typeof sub.valeur !== 'string') return
        const raw = sub.valeur.trim()
        if (!raw) return
        const predicateEntry = ensureSubfieldPredicate(predicateCache, sub.code)
        store.add(quad(recordNode, predicateEntry.value, literal(raw)))
        const normalized = normalizeValue(raw)
        if (normalized) {
          store.add(quad(recordNode, predicateEntry.normalized, literal(normalized)))
        }

        const subfieldNode = blankNode()
        store.add(quad(fieldNode, namedNode(PREDICATES.hasSubfield), subfieldNode))
        store.add(quad(subfieldNode, RDF_TYPE, namedNode(CLASSES.Subfield)))
        store.add(quad(subfieldNode, namedNode(PREDICATES.belongsTo), recordNode))
        addStringLiteral(subfieldNode, PREDICATES.subfieldCode, sub.code, store)
        store.add(quad(subfieldNode, namedNode(PREDICATES.subfieldIndex), literal(String(subIndex), XSD_INTEGER)))
        addStringLiteral(subfieldNode, PREDICATES.subfieldValue, raw, store)
        if (normalized) {
          addStringLiteral(subfieldNode, PREDICATES.subfieldValueNormalized, normalized, store)
        }

        if (raw.startsWith('ark:/')) {
          addStringLiteral(subfieldNode, PREDICATES.subfieldArk, raw, store)
          const target = ensureTargetForArk(raw)
          if (target) {
            store.add(quad(subfieldNode, namedNode(PREDICATES.referencesEntity), target))
          }
        }
      })
    })
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (processed.has(record.id)) continue
    processed.add(record.id)

    const node = nodeForRecord(record)
    store.add(quad(node, RDF_TYPE, namedNode(classForRecord(record))))
    addStringLiteral(node, PREDICATES.label, labelForRecord(record), store)
    addStringLiteral(node, PREDICATES.typeNorm, record.typeNorm, store)
    if (record.ark) addStringLiteral(node, PREDICATES.ark, record.ark, store)

    attachFieldData(record, node)

    if (record.typeNorm === 'manifestation') {
      manifestationExpressionArks(record).forEach(ark => {
        addStringLiteral(node, PREDICATES.hasExpressionArk, ark, store)
        const target = ensureTargetForArk(ark)
        if (target) {
          store.add(quad(node, namedNode(PREDICATES.hasExpression), target))
          store.add(quad(target, namedNode(PREDICATES.hasManifestation), node))
        }
      })
    }

    if (record.typeNorm === 'expression') {
      expressionWorkArks(record).forEach(ark => {
        addStringLiteral(node, PREDICATES.hasWorkArk, ark, store)
        const target = ensureTargetForArk(ark)
        if (target) {
          store.add(quad(node, namedNode(PREDICATES.hasWork), target))
          store.add(quad(target, namedNode(PREDICATES.hasExpression), node))
        }
      })
    }

    const relationships = extractGeneralRelationshipTargets(record)
    relationships.forEach(rel => {
      const relNode = blankNode()
      store.add(quad(node, namedNode(PREDICATES.hasRelationship), relNode))
      store.add(quad(relNode, RDF_TYPE, namedNode(CLASSES.Relationship)))
      addStringLiteral(relNode, PREDICATES.relationshipZone, rel.zone, store)
      addStringLiteral(relNode, PREDICATES.relatedToArk, rel.ark, store)
      const target = ensureTargetForArk(rel.ark)
      if (target) {
        store.add(quad(relNode, namedNode(PREDICATES.relationshipTarget), target))
        store.add(quad(node, namedNode(PREDICATES.relatedTo), target))
      }
    })

    const agents = extractAgentRelations(record)
    agents.forEach(agent => {
      addStringLiteral(node, PREDICATES.hasAgentArk, agent.ark, store)
      addStringLiteral(node, PREDICATES.agentZone, agent.zone, store)
      if (agent.subfield) addStringLiteral(node, PREDICATES.agentSubfield, agent.subfield, store)
      const target = ensureTargetForArk(agent.ark)
      if (target) {
        store.add(quad(node, namedNode(PREDICATES.hasAgent), target))
      }
    })
    options.onProgress?.({ phase: 'building', current: index + 1, total: totalRecords })
  }

  const metadata: SearchGraphMetadata = {
    recordNodeById: new Map(Array.from(nodeById.entries(), ([id, node]) => [id, node.value])),
    recordNodeByArk: new Map(Array.from(nodeByArk.entries(), ([ark, node]) => [ark, node.value])),
  }

  return { store, metadata }
}
