import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isClusterAnchorCreated, type Intermarc } from '../src/app/lib/intermarc'

test('manual cluster anchor is protected when marked as created', () => {
  const im: Intermarc = {
    zones: [
      {
        code: '90F',
        affectedByCuration: 'manual',
        sousZones: [
          { code: '90F$3', valeur: 'ark:/manual/target', affectedByCuration: 'manual' },
          { code: '90F$q', valeur: 'Clusterisation manuelle', affectedByCuration: 'manual' },
        ],
      },
    ],
  }
  assert.equal(isClusterAnchorCreated(im), true)
})

test('script cluster anchor is protected when any field is marked as created', () => {
  const im: Intermarc = {
    zones: [
      {
        code: '90F',
        sousZones: [
          { code: '90F$a', valeur: 'ark:/script/target' },
          { code: '90F$q', valeur: 'Clusterisation script', affectedByCuration: 'created' },
          { code: '90F$d', valeur: '2025-01-01' },
        ],
      },
    ],
  }
  assert.equal(isClusterAnchorCreated(im), true)
})

test('legacy cluster without curation flag is not treated as protected anchor', () => {
  const im: Intermarc = {
    zones: [
      {
        code: '90F',
        sousZones: [
          { code: '90F$3', valeur: 'ark:/manual/legacy' },
          { code: '90F$q', valeur: 'Clusterisation manuelle' },
        ],
      },
    ],
  }
  assert.equal(isClusterAnchorCreated(im), false)
})
