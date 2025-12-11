import {
  Generator,
  Parser,
  type FilterPattern,
  type Pattern,
  type Query,
  type Triple,
  type VariableTerm,
} from 'sparqljs'
import {
  BASE_NS,
  PROP_COLLECTIVE_TITLE_PREDICATE,
  PROP_ENTITY_WIDE_PREDICATE,
  PROP_EXPRESSION_TITLE_PREDICATE,
  PROP_FAMILY_TITLE_PREDICATE,
  PROP_FIELD_WIDE_PREDICATE,
  PROP_MANIFESTATION_TITLE_PREDICATE,
  PROP_PERSON_TITLE_PREDICATE,
  PROP_WORK_TITLE_PREDICATE,
  SUBFIELD_VALUE_PREDICATE,
} from './sparnaturalConfig'

const HAS_FIELD = `${BASE_NS}/hasField`
const HAS_SUBFIELD = `${BASE_NS}/hasSubfield`
const FIELD_CODE = `${BASE_NS}/fieldCode`
const SUBFIELD_CODE = `${BASE_NS}/subfieldCode`

type RewriteContext = {
  usedVariables: Set<string>
  changed: boolean
  multiValueTargets: Set<string>
}

type TripleReplacement = {
  triples: Triple[]
  extraPatterns: Pattern[]
}

type TitleRule = {
  predicate: string
  fieldCode: string
  allowedSubfields?: string[]
  excludedSubfields?: string[]
}

const TITLE_RULES: TitleRule[] = [
  { predicate: PROP_WORK_TITLE_PREDICATE, fieldCode: '150', allowedSubfields: ['150sa', '150su'] },
  { predicate: PROP_EXPRESSION_TITLE_PREDICATE, fieldCode: '140', excludedSubfields: ['140s3'] },
  { predicate: PROP_MANIFESTATION_TITLE_PREDICATE, fieldCode: '245', allowedSubfields: ['245sa', '245se', '245sf'] },
  { predicate: PROP_PERSON_TITLE_PREDICATE, fieldCode: '100', allowedSubfields: ['100sa', '100sm', '100sd'] },
  { predicate: PROP_COLLECTIVE_TITLE_PREDICATE, fieldCode: '110', allowedSubfields: ['110sa', '110sq'] },
  { predicate: PROP_FAMILY_TITLE_PREDICATE, fieldCode: '120', allowedSubfields: ['120sa', '120sm', '120se'] },
]

const parser = new Parser({ skipUngroupedVariableCheck: true })
const generator = new Generator({ allPrefixes: true })

/**
 * Rewrites Sparnatural short-hand predicates (title / entity-wide / field-wide)
 * into the concrete MARC field/subfield triples our Oxigraph store exposes.
 * Falls back to the original query when parsing fails.
 */
export function rewriteSparnaturalShortcuts(rawQuery: string): string {
  let parsed: Query
  try {
    const result = parser.parse(rawQuery)
    if (result.type !== 'query') return rawQuery
    parsed = result
  } catch {
    return rawQuery
  }

  if (!parsed.where) return rawQuery

  const context: RewriteContext = { usedVariables: collectVariables(parsed), changed: false, multiValueTargets: new Set<string>() }
  const rewrittenWhere = parsed.where.flatMap(pattern => rewritePattern(pattern, context))

  if (!context.changed) return rawQuery

  return generator.stringify({ ...parsed, where: rewrittenWhere })
}

function rewritePattern(pattern: Pattern, context: RewriteContext): Pattern[] {
  switch (pattern.type) {
    case 'bgp':
      return rewriteBgp(pattern, context)
    case 'graph':
      return [{ ...pattern, patterns: pattern.patterns.flatMap(child => rewritePattern(child, context)) }]
    case 'group':
      return [{ ...pattern, patterns: pattern.patterns.flatMap(child => rewritePattern(child, context)) }]
    case 'optional':
      return [{ ...pattern, patterns: pattern.patterns.flatMap(child => rewritePattern(child, context)) }]
    case 'union': {
      const branches = pattern.patterns.map(branch => branch.flatMap(child => rewritePattern(child, context)))
      return [{ ...pattern, patterns: branches }]
    }
    case 'filter':
      return rewriteFilterPattern(pattern, context)
    default:
      return [pattern]
  }
}

function rewriteBgp(pattern: Extract<Pattern, { type: 'bgp' }>, context: RewriteContext): Pattern[] {
  const triples: Triple[] = []
  const extra: Pattern[] = []

  pattern.triples.forEach(triple => {
    const replacement = rewriteTriple(triple, context)
    if (!replacement) {
      triples.push(triple)
      return
    }
    triples.push(...replacement.triples)
    extra.push(...replacement.extraPatterns)
    context.changed = true
  })

  return [{ ...pattern, triples }, ...extra]
}

function rewriteTriple(triple: Triple, context: RewriteContext): TripleReplacement | null {
  const predicate = getPredicateIri(triple.predicate)
  if (!predicate) return null

  if (predicate === PROP_ENTITY_WIDE_PREDICATE) {
    return rewriteEntityWide(triple, context)
  }

  if (predicate === PROP_FIELD_WIDE_PREDICATE) {
    return rewriteFieldWide(triple, context)
  }

  const titleRule = TITLE_RULES.find(rule => rule.predicate === predicate)
  if (titleRule) {
    return rewriteTitleTriple(triple, titleRule, context)
  }

  return null
}

function rewriteEntityWide(triple: Triple, context: RewriteContext): TripleReplacement {
  const fieldVar = freshVar('Field', context)
  const subfieldVar = freshVar('Subfield', context)

  return {
    triples: [
      { subject: triple.subject, predicate: namedNode(HAS_FIELD), object: fieldVar },
      { subject: fieldVar, predicate: namedNode(HAS_SUBFIELD), object: subfieldVar },
      { subject: subfieldVar, predicate: namedNode(SUBFIELD_VALUE_PREDICATE), object: triple.object },
    ],
    extraPatterns: [],
  }
}

function rewriteFieldWide(triple: Triple, context: RewriteContext): TripleReplacement {
  const subfieldVar = freshVar('Subfield', context)
  if (isVariable(triple.object)) {
    context.multiValueTargets.add(triple.object.value)
  }
  return {
    triples: [
      { subject: triple.subject, predicate: namedNode(HAS_SUBFIELD), object: subfieldVar },
      { subject: subfieldVar, predicate: namedNode(SUBFIELD_VALUE_PREDICATE), object: triple.object },
    ],
    extraPatterns: [],
  }
}

function rewriteTitleTriple(triple: Triple, rule: TitleRule, context: RewriteContext): TripleReplacement {
  const fieldVar = freshVar('Field', context)
  const subfieldVar = freshVar('Subfield', context)
  const codeVar = freshVar('SubfieldCode', context)

  const triples: Triple[] = [
    { subject: triple.subject, predicate: namedNode(HAS_FIELD), object: fieldVar },
    { subject: fieldVar, predicate: namedNode(FIELD_CODE), object: literal(rule.fieldCode) },
    { subject: fieldVar, predicate: namedNode(HAS_SUBFIELD), object: subfieldVar },
    { subject: subfieldVar, predicate: namedNode(SUBFIELD_CODE), object: codeVar },
    { subject: subfieldVar, predicate: namedNode(SUBFIELD_VALUE_PREDICATE), object: triple.object },
  ]

  const filters: Pattern[] = []
  if (rule.allowedSubfields?.length) {
    filters.push(makeInFilter(codeVar, rule.allowedSubfields))
  }
  if (rule.excludedSubfields?.length) {
    rule.excludedSubfields.forEach(code => filters.push(makeNotEqualsFilter(codeVar, code)))
  }

  return { triples, extraPatterns: filters }
}

function rewriteFilterPattern(pattern: FilterPattern, context: RewriteContext): Pattern[] {
  const regexInfo = extractRegexInfo(pattern.expression)
  if (!regexInfo) return [pattern]
  if (!context.multiValueTargets.has(regexInfo.variable.value)) return [pattern]

  const needles = splitMultiValues(regexInfo.literal)
  if (needles.length <= 1) return [pattern]

  const needleVar = freshVar(`${regexInfo.variable.value}_needle`, context)
  const valuesPattern: Pattern = {
    type: 'values',
    values: needles.map(value => ({ [needleVar.value]: literal(value) })),
    variables: [needleVar],
  }

  const filterExpression: FilterPattern['expression'] = {
    type: 'operation',
    operator: 'regex',
    args: [regexInfo.variable, needleVar, literal(regexInfo.flags ?? 'i')],
  }

  context.changed = true
  return [
    valuesPattern,
    { type: 'filter', expression: filterExpression },
  ]
}

function makeInFilter(variable: VariableTerm, values: string[]): FilterPattern {
  return {
    type: 'filter',
    expression: { type: 'operation', operator: 'in', args: [variable, values.map(value => literal(value))] },
  }
}

function makeNotEqualsFilter(variable: VariableTerm, value: string): FilterPattern {
  return {
    type: 'filter',
    expression: { type: 'operation', operator: '!=', args: [variable, literal(value)] },
  }
}

function freshVar(base: string, context: RewriteContext): VariableTerm {
  let attempt = `${base}_1`
  let counter = 1
  while (context.usedVariables.has(attempt)) {
    counter += 1
    attempt = `${base}_${counter}`
  }
  context.usedVariables.add(attempt)
  return variable(attempt)
}

function collectVariables(query: Query): Set<string> {
  const variables = new Set<string>()

  const visitPattern = (pattern: Pattern) => {
    switch (pattern.type) {
      case 'bgp':
        pattern.triples.forEach(triple => {
          collectFromTerm(triple.subject, variables)
          collectFromTerm(triple.predicate, variables)
          collectFromTerm(triple.object, variables)
        })
        break
      case 'group':
      case 'optional':
      case 'graph':
        pattern.patterns.forEach(visitPattern)
        break
      case 'union':
        pattern.patterns.forEach(branch => branch.forEach(visitPattern))
        break
      case 'filter':
        collectFromExpression(pattern.expression, variables)
        break
      case 'bind':
        collectFromExpression(pattern.expression, variables)
        collectFromTerm(pattern.variable, variables)
        break
      case 'values':
        pattern.variables.forEach(term => collectFromTerm(term, variables))
        pattern.values.forEach(row => {
          if (!row) return
          Object.values(row).forEach(value => collectFromTerm(value, variables))
        })
        break
      default:
        break
    }
  }

  query.where?.forEach(visitPattern)
  if ('variables' in query && Array.isArray((query as Query).variables)) {
    ;(query as Query).variables.forEach(variableTerm => collectFromTerm(variableTerm as unknown as Triple['subject'], variables))
  }

  return variables
}

function collectFromTerm(term: unknown, set: Set<string>): void {
  if (isVariable(term)) {
    set.add(term.value)
  }
}

function collectFromExpression(expression: unknown, set: Set<string>): void {
  if (!expression || typeof expression !== 'object') return
  if (Array.isArray((expression as { args?: unknown[] }).args)) {
    ;((expression as { args?: unknown[] }).args as unknown[]).forEach(arg => collectFromExpression(arg, set))
  }
  if ('expression' in (expression as Record<string, unknown>)) {
    collectFromExpression((expression as { expression: unknown }).expression, set)
  }
  collectFromTerm(expression as unknown as Triple['subject'], set)
}

function extractRegexInfo(expression: unknown):
  | { variable: VariableTerm; literal: string; flags?: string }
  | null {
  if (!expression || typeof expression !== 'object') return null
  const candidate = expression as { operator?: string; args?: unknown[] }
  if (candidate.operator?.toLowerCase() !== 'regex' || !Array.isArray(candidate.args) || candidate.args.length < 2) {
    return null
  }
  const [first, second, third] = candidate.args
  if (!isVariable(first) || !isLiteral(second)) return null
  const flags = isLiteral(third) ? third.value : undefined
  return { variable: first, literal: second.value, flags }
}

function splitMultiValues(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map(value => value.trim())
    .filter(Boolean)
}

function getPredicateIri(predicate: Triple['predicate']): string | null {
  if (isNamedNode(predicate)) return predicate.value
  return null
}

function isNamedNode(value: unknown): value is { termType: 'NamedNode'; value: string } {
  return typeof value === 'object' && value !== null && 'termType' in value && (value as { termType?: string }).termType === 'NamedNode'
}

function isVariable(value: unknown): value is VariableTerm {
  return typeof value === 'object' && value !== null && 'termType' in value && (value as { termType?: string }).termType === 'Variable'
}

function isLiteral(value: unknown): value is { termType: 'Literal'; value: string } {
  return typeof value === 'object' && value !== null && 'termType' in value && (value as { termType?: string }).termType === 'Literal'
}

function namedNode(value: string): Triple['predicate'] {
  return { termType: 'NamedNode', value } as const
}

function literal(value: string) {
  return { termType: 'Literal', value } as const
}

function variable(value: string): VariableTerm {
  return { termType: 'Variable', value }
}
