import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Store, namedNode, blankNode, literal, quad } from 'oxigraph'
import { ensureGraphWrapping } from '../src/app/sparql/queryUtils'

const BASE = 'https://vendange.bnf.fr'
const CLASS = `${BASE}/class/`
const REL = `${BASE}/relation/`
const SUBFIELD_VALUE = `${BASE}/subfieldValue`
const HAS_FIELD = `${BASE}/hasField`
const HAS_SUBFIELD = `${BASE}/hasSubfield`

test('ensureGraphWrapping isolates entity triples into their named graphs', () => {
  const store = new Store()

  const person = namedNode(`${BASE}/entity/person1`)
  const workA = namedNode(`${BASE}/entity/workA`)
  const workB = namedNode(`${BASE}/entity/workB`)
  const gPerson = namedNode(`${BASE}/graph/person1`)
  const gWorkA = namedNode(`${BASE}/graph/workA`)
  const gWorkB = namedNode(`${BASE}/graph/workB`)

  // Person type in its own graph
  store.add(quad(person, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode(`${CLASS}PublicIdentity`), gPerson))

  // Work A with relation to person and a $3 subfield pointing to another ark
  const fieldA1 = blankNode('b-workA-f-0')
  const subA1 = blankNode('b-workA-f-0-s-0')
  store.add(quad(workA, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode(`${CLASS}Work`), gWorkA))
  store.add(quad(workA, namedNode(`${REL}700s3`), person, gWorkA))
  store.add(quad(workA, namedNode(HAS_FIELD), fieldA1, gWorkA))
  store.add(quad(fieldA1, namedNode(HAS_SUBFIELD), subA1, gWorkA))
  store.add(quad(subA1, namedNode(SUBFIELD_VALUE), literal('ark:/12148/cb1000059494'), gWorkA))

  // Work B with another relation to same person and different $3 value
  const fieldB1 = blankNode('b-workB-f-0')
  const subB1 = blankNode('b-workB-f-0-s-0')
  store.add(quad(workB, namedNode('http://www.w3.org/1999/02/22-rdf-syntax-ns#type'), namedNode(`${CLASS}Work`), gWorkB))
  store.add(quad(workB, namedNode(`${REL}700s3`), person, gWorkB))
  store.add(quad(workB, namedNode(HAS_FIELD), fieldB1, gWorkB))
  store.add(quad(fieldB1, namedNode(HAS_SUBFIELD), subB1, gWorkB))
  store.add(quad(subB1, namedNode(SUBFIELD_VALUE), literal('ark:/12148/cb100005951f'), gWorkB))

  const raw = `
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX vend: <https://vendange.bnf.fr/>
SELECT DISTINCT ?Person_1 WHERE {
  ?Person_1 rdf:type <https://vendange.bnf.fr/class/PublicIdentity> .
  ?Person_1 ^(<https://vendange.bnf.fr/relation/700s3>|<https://vendange.bnf.fr/relation/701s3>|<https://vendange.bnf.fr/relation/702s3>) ?Work_7 .
  ?Work_7 rdf:type <https://vendange.bnf.fr/class/Work> ;
    vend:hasField ?Field_9 .
  ?Field_9 vend:hasSubfield ?Subfield_11 .
  ?Subfield_11 vend:subfieldValue "ark:/12148/cb1000059494" .
  ?Person_1 ^(<https://vendange.bnf.fr/relation/700s3>|<https://vendange.bnf.fr/relation/701s3>|<https://vendange.bnf.fr/relation/702s3>) ?Work_15 .
  ?Work_15 rdf:type <https://vendange.bnf.fr/class/Work> ;
    vend:hasField ?Field_17 .
  ?Field_17 vend:hasSubfield ?Subfield_19 .
  ?Subfield_19 vend:subfieldValue "ark:/12148/cb100005951f" .
}
LIMIT 200
`

  const rewritten = ensureGraphWrapping(raw)
  const results = Array.from(store.query(rewritten))
  assert.equal(results.length, 1)
  const personBinding = results[0].get('Person_1')
  assert.ok(personBinding)
  assert.equal(personBinding?.value, `${BASE}/entity/person1`)
})
