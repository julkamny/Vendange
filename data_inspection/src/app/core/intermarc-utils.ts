import type { Intermarc } from '../lib/intermarc'

export function cloneIntermarc(im: Intermarc): Intermarc {
  return {
    zones: im.zones.map(z => ({
      code: z.code,
      fieldCompactValue: z.fieldCompactValue,
      affectedByCuration: z.affectedByCuration,
      sousZones: z.sousZones.map(sz => ({ code: sz.code, valeur: sz.valeur, affectedByCuration: sz.affectedByCuration })),
    })),
  }
}

export function rewriteManifestationExpressionLinks(
  intermarc: Intermarc,
  options: { remove: string[]; add: string; partialArk?: string | null },
): Intermarc {
  const detachSet = new Set(options.remove.map(entry => entry.trim()).filter(Boolean))
  const next = cloneIntermarc(intermarc)
  next.zones = next.zones.filter(zone => {
    if (zone.code !== '740') return true
    const hasDetach = zone.sousZones.some(
      sub => sub.code === '740$3' && detachSet.has((sub.valeur ?? '').trim()),
    )
    return !hasDetach
  })

  const alreadyLinked = next.zones.some(
    zone => zone.code === '740' && zone.sousZones.some(sub => sub.code === '740$3' && sub.valeur === options.add),
  )
  if (!alreadyLinked) {
    const partialSubfield =
      options.partialArk && options.partialArk.trim()
        ? [{ code: '740$q', valeur: options.partialArk.trim(), affectedByCuration: 'modified' as const }]
        : []
    next.zones.push({
      code: '740',
      affectedByCuration: 'modified',
      sousZones: [
        { code: '740$3', valeur: options.add, affectedByCuration: 'modified' },
        ...partialSubfield,
      ],
    })
  }

  return next
}
