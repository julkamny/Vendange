import type { Intermarc } from '../lib/intermarc'

export function cloneIntermarc(im: Intermarc): Intermarc {
  return {
    zones: im.zones.map(z => ({
      code: z.code,
      sousZones: z.sousZones.map(sz => ({ code: sz.code, valeur: sz.valeur })),
    })),
  }
}

