import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Parser, type Triple } from 'sparqljs'
import {
  BASE_NS,
  CLASS_NS,
  PROP_NS,
  PROP_EXPRESSION_TITLE_PREDICATE,
  PROP_FIELD_WIDE_PREDICATE,
  PROP_WORK_TITLE_PREDICATE,
  PROP_ENTITY_WIDE_PREDICATE,
} from '../src/app/sparql/sparnaturalConfig'
import { rewriteSparnaturalShortcuts } from '../src/app/sparql/sparnaturalRewrite'

const parser = new Parser({ skipUngroupedVariableCheck: true })

test('work title rewrites to field 150 subfields', () => {
  const query = `
PREFIX vend: <${BASE_NS}/>
PREFIX vendclass: <${CLASS_NS}>
PREFIX vendprop: <${PROP_NS}>
SELECT ?Work_1 WHERE {
  ?Work_1 a <${CLASS_NS}Work> .
  ?Work_1 <${PROP_WORK_TITLE_PREDICATE}> ?Text_2 .
  FILTER(REGEX(STR(?Text_2), "roses", "i"))
}
`
  const rewritten = rewriteSparnaturalShortcuts(query)
  assert.ok(!rewritten.includes(PROP_WORK_TITLE_PREDICATE))

  const triples = collectPredicates(rewritten)
  assert.ok(triples.has(`${BASE_NS}/hasField`))
  assert.ok(triples.has(`${BASE_NS}/fieldCode`))
  assert.ok(triples.has(`${BASE_NS}/hasSubfield`))
  assert.ok(triples.has(`${BASE_NS}/subfieldValue`))
  assert.match(rewritten, /150s[au]/)
})

test('expression title excludes 140s3 subfield', () => {
  const query = `
PREFIX vend: <${BASE_NS}/>
PREFIX vendclass: <${CLASS_NS}>
SELECT ?Expression_1 WHERE {
  ?Expression_1 a <${CLASS_NS}Expression> .
  ?Expression_1 <${PROP_EXPRESSION_TITLE_PREDICATE}> ?Text_2 .
  FILTER(REGEX(STR(?Text_2), "roman", "i"))
}
`
  const rewritten = rewriteSparnaturalShortcuts(query)
  assert.ok(!rewritten.includes(PROP_EXPRESSION_TITLE_PREDICATE))
  assert.match(rewritten, /fieldCode "140"/)
  assert.match(rewritten, /!= "140s3"/)
})

test('entity wide text pipes through every subfield', () => {
  const query = `
PREFIX vend: <${BASE_NS}/>
PREFIX vendclass: <${CLASS_NS}>
SELECT ?Manifestation_1 WHERE {
  ?Manifestation_1 a <${CLASS_NS}Manifestation> .
  ?Manifestation_1 <${PROP_ENTITY_WIDE_PREDICATE}> ?Text_2 .
  FILTER(REGEX(STR(?Text_2), "anemone", "i"))
}
`
  const rewritten = rewriteSparnaturalShortcuts(query)
  const predicates = collectPredicates(rewritten)
  assert.ok(predicates.has(`${BASE_NS}/hasField`))
  assert.ok(predicates.has(`${BASE_NS}/hasSubfield`))
  assert.ok(predicates.has(`${BASE_NS}/subfieldValue`))
})

test('field wide text walks through subfields of the selected field', () => {
  const query = `
PREFIX vend: <${BASE_NS}/>
SELECT ?Field_1 WHERE {
  ?Field_1 <${PROP_FIELD_WIDE_PREDICATE}> ?Text_2 .
  FILTER(REGEX(STR(?Text_2), "opera", "i"))
}
`
  const rewritten = rewriteSparnaturalShortcuts(query)
  const predicates = collectPredicates(rewritten)
  assert.ok(predicates.has(`${BASE_NS}/hasSubfield`))
  assert.ok(predicates.has(`${BASE_NS}/subfieldValue`))
  assert.ok(!predicates.has(PROP_FIELD_WIDE_PREDICATE))
})

function collectPredicates(query: string): Set<string> {
  const parsed = parser.parse(query)
  const predicates = new Set<string>()
  const visitPattern = (patterns: unknown): void => {
    if (!patterns) return
    if (Array.isArray(patterns)) {
      patterns.forEach(visitPattern)
      return
    }
    const pattern = patterns as { type?: string; triples?: Triple[]; patterns?: unknown }
    if (pattern.type === 'bgp' && Array.isArray(pattern.triples)) {
      pattern.triples.forEach(triple => {
        if (triple.predicate && typeof triple.predicate === 'object' && 'value' in triple.predicate) {
          predicates.add((triple.predicate as { value: string }).value)
        }
      })
      return
    }
    if ('patterns' in pattern && pattern.patterns) {
      visitPattern(pattern.patterns)
    }
  }

  visitPattern((parsed as { where?: unknown }).where)
  return predicates
}
