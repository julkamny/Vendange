import { test } from 'node:test'
import assert from 'node:assert/strict'
import { expressionsShareParentWork } from '../src/app/core/entities'
import {
  rebuildExpressionCluster90FEntries,
  type Intermarc,
  isClusterAnchorCreated,
} from '../src/app/lib/intermarc'
import { worksClusteredTogether } from '../src/app/core/entities'
import type { Cluster } from '../src/app/types'

const baseExpression = (ark: string, parent: string) => {
  const intermarc: Intermarc = {
    zones: [
      {
        code: '750',
        sousZones: [{ code: '750$3', valeur: parent }],
      },
    ],
  }
  return {
    id: ark,
    typeNorm: 'expression',
    type: 'Expression',
    ark,
    rowIndex: 0,
    intermarcStr: JSON.stringify(intermarc),
    intermarc,
    raw: [],
  }
}

test('expressionsShareParentWork returns true for shared 750$3', () => {
  const a = baseExpression('ark:/expr/a', 'ark:/work/1')
  const b = baseExpression('ark:/expr/b', 'ark:/work/1')
  assert.equal(expressionsShareParentWork(a, b), true)
})

test('expressionsShareParentWork returns false for different parents', () => {
  const a = baseExpression('ark:/expr/a', 'ark:/work/1')
  const b = baseExpression('ark:/expr/b', 'ark:/work/2')
  assert.equal(expressionsShareParentWork(a, b), false)
})

test('rebuildExpressionCluster90FEntries writes manual vs script correctly', () => {
  const im: Intermarc = { zones: [] }
  const next = rebuildExpressionCluster90FEntries(im, [
    { ark: 'ark:/expr/child', origin: 'manual' },
    { ark: 'ark:/expr/child2', origin: 'script', date: '2025-01-02' },
  ])
  const manualZone = next.zones.find(z => z.sousZones.some(sz => sz.code === '90F$3'))
  const scriptZone = next.zones.find(z => z.sousZones.some(sz => sz.code === '90F$3'))
  assert.ok(manualZone && scriptZone)
  assert.equal(
    manualZone?.sousZones.find(sz => sz.code === '90F$q')?.valeur,
    'Clusterisation manuelle',
  )
  assert.equal(
    scriptZone?.sousZones.find(sz => sz.code === '90F$q')?.valeur,
    'Clusterisation script',
  )
})

test('isClusterAnchorCreated detects expression anchors with manual flags', () => {
  const im: Intermarc = {
    zones: [
      {
        code: '90F',
        affectedByCuration: 'manual',
        sousZones: [
          { code: '90F$3', valeur: 'ark:/expr/child', affectedByCuration: 'manual' },
          { code: '90F$q', valeur: 'Clusterisation manuelle', affectedByCuration: 'manual' },
        ],
      },
    ],
  }
  assert.equal(isClusterAnchorCreated(im), true)
})

test('worksClusteredTogether true when in same cluster', () => {
  const clusters: Cluster[] = [
    {
      anchorId: 'w1',
      anchorArk: 'ark:/work/1',
      anchorTitle: 'A',
      items: [{ ark: 'ark:/work/2', accepted: true, origin: 'script' }],
      expressionGroups: [],
      independentExpressions: [],
    },
  ]
  assert.equal(worksClusteredTogether('ark:/work/1', 'ark:/work/2', clusters), true)
  assert.equal(worksClusteredTogether('ark:/work/2', 'ark:/work/1', clusters), true)
})

test('worksClusteredTogether false when not linked', () => {
  const clusters: Cluster[] = []
  assert.equal(worksClusteredTogether('ark:/work/1', 'ark:/work/2', clusters), false)
})
