export type AutocompleteEntityKind =
  | 'work'
  | 'expression'
  | 'manifestation'
  | 'person'
  | 'collective'
  | 'brand'
  | 'family'
  | 'controlledValue'
  | 'deweyConcept'
  | 'concept'
  | 'event'
  | 'genreForm'
  | 'timeLapse'
  | 'place'
  | 'other'

const TYPE_KIND_MAP: Record<string, AutocompleteEntityKind> = {
  oeuvre: 'work',
  expression: 'expression',
  manifestation: 'manifestation',
  'identite publique de personne': 'person',
  collectivite: 'collective',
  marque: 'brand',
  famille: 'family',
  'valeur controlee': 'controlledValue',
  'concept dewey': 'deweyConcept',
  concept: 'concept',
  evenement: 'event',
  'genre / forme': 'genreForm',
  'laps de temps': 'timeLapse',
  lieu: 'place',
}

export const ALL_AUTOCOMPLETE_ENTITY_KINDS: readonly AutocompleteEntityKind[] = [
  'work',
  'expression',
  'manifestation',
  'person',
  'collective',
  'brand',
  'family',
  'controlledValue',
  'deweyConcept',
  'concept',
  'event',
  'genreForm',
  'timeLapse',
  'place',
  'other',
]

const SUBFIELD_KIND_RULES = new Map<string, Set<AutocompleteEntityKind>>()

function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

function registerAllowedKinds(codes: readonly string[], kinds: readonly AutocompleteEntityKind[]) {
  codes.forEach(raw => {
    const normalized = normalizeCode(raw)
    if (!normalized) return
    if (!SUBFIELD_KIND_RULES.has(normalized)) SUBFIELD_KIND_RULES.set(normalized, new Set())
    const set = SUBFIELD_KIND_RULES.get(normalized)!
    kinds.forEach(kind => set.add(kind))
  })
}

function registerAllowAllExcept(codes: readonly string[], excluded: readonly AutocompleteEntityKind[]) {
  const allowed = ALL_AUTOCOMPLETE_ENTITY_KINDS.filter(kind => !excluded.includes(kind))
  registerAllowedKinds(codes, allowed)
}

const COLLECTIVE_CODES = [
  '150$3',
  '440$w3',
  '450$3',
  '500$3',
  '500$w3',
  '506$0',
  '506$3',
  '506$q',
  '509$3',
  '50E$3',
  '50E$w3',
  '50N$3',
  '512$3',
  '514$3',
  '516$3',
  '517$3',
  '51Z$3',
  '542$w3',
  '54C$w3',
  '54P$w3',
  '54T$w3',
  '550$w3',
  '551$w3',
  '552$w3',
  '553$w3',
  '554$w3',
  '555$w3',
  '556$w3',
  '557$w3',
  '558$w3',
  '559$w3',
  '55A$w3',
  '55B$w3',
  '55C$w3',
  '55E$w3',
  '55F$w3',
  '55M$w3',
  '55P$w3',
  '55R$w3',
  '55S$w3',
  '55Z$w3',
  '563$3',
  '570$3',
  '571$3',
  '610$3',
  '700$3',
  '701$3',
  '702$3',
  '703$3',
  '705$3',
  '710$3',
  '711$3',
  '713$3',
  '714$3',
  '715$3',
  '960$3',
]

const PERSON_CODES = [
  '150$3',
  '440$w3',
  '450$3',
  '500$3',
  '500$w3',
  '506$0',
  '506$3',
  '506$q',
  '509$3',
  '50E$3',
  '50E$w3',
  '50N$3',
  '510$3',
  '512$3',
  '513$3',
  '514$3',
  '516$3',
  '517$3',
  '51Z$3',
  '542$w3',
  '54C$w3',
  '54P$w3',
  '54T$w3',
  '550$w3',
  '551$w3',
  '552$w3',
  '553$w3',
  '554$w3',
  '555$w3',
  '556$w3',
  '557$w3',
  '558$w3',
  '559$w3',
  '55A$w3',
  '55B$w3',
  '55C$w3',
  '55E$w3',
  '55F$w3',
  '55M$w3',
  '55P$w3',
  '55R$w3',
  '55S$w3',
  '55Z$w3',
  '563$3',
  '571$3',
  '610$3',
  '700$3',
  '701$3',
  '702$3',
  '703$3',
  '705$3',
  '710$3',
  '711$3',
  '713$3',
  '714$3',
  '715$3',
  '960$3',
]

const FAMILY_CODES = [
  '150$3',
  '440$w3',
  '450$3',
  '500$3',
  '500$w3',
  '506$0',
  '506$3',
  '506$q',
  '509$3',
  '50E$3',
  '50E$w3',
  '50N$3',
  '512$3',
  '514$3',
  '516$3',
  '517$3',
  '51Z$3',
  '542$w3',
  '54C$w3',
  '54P$w3',
  '54T$w3',
  '550$w3',
  '551$w3',
  '552$w3',
  '553$w3',
  '554$w3',
  '555$w3',
  '556$w3',
  '557$w3',
  '558$w3',
  '559$w3',
  '55A$w3',
  '55B$w3',
  '55C$w3',
  '55E$w3',
  '55F$w3',
  '55M$w3',
  '55P$w3',
  '55R$w3',
  '55S$w3',
  '55Z$w3',
  '563$3',
  '571$3',
  '610$3',
  '700$3',
  '701$3',
  '702$3',
  '703$3',
  '705$3',
  '710$3',
  '711$3',
  '713$3',
  '714$3',
  '715$3',
  '960$3',
]

const DEWEY_CODES = ['680$3']
const CONCEPT_CODES = [
  '561$3',
  '627$3',
  '627$3x',
  '960$3x',
  '962$3x',
  '963$3x',
  '964$3x',
  '965$3x',
  '966$3',
  '966$3x',
  '967$3x',
  '968$3x',
  '969$3x',
  '96C$3x',
  '96E$3x',
  '96G$3x',
  '96S$3x',
  '96T$3x',
]
const EVENT_CODES = [
  '51A$3',
  '96E$3',
  '627$3z',
  '960$3z',
  '962$3z',
  '963$3z',
  '964$3z',
  '965$3z',
  '966$3z',
  '967$3z',
  '968$3z',
  '969$3z',
  '96C$3z',
  '96E$3z',
  '96G$3z',
  '96S$3z',
]
const GENRE_FORM_CODES = ['968$3']
const TIME_LAPSE_CODES = [
  '96T$3',
  '627$3z',
  '960$3z',
  '962$3z',
  '963$3z',
  '964$3z',
  '965$3z',
  '966$3z',
  '967$3z',
  '968$3z',
  '969$3z',
  '96C$3z',
  '96E$3z',
  '96G$3z',
  '96S$3z',
]
const PLACE_CODES = [
  '040$3l',
  '519$3',
  '572$0',
  '627$3y',
  '960$3y',
  '962$3y',
  '963$3y',
  '964$3y',
  '965$3y',
  '966$3y',
  '967$3',
  '967$3y',
  '968$3y',
  '969$3y',
  '96C$3y',
  '96E$3y',
  '96G$3',
  '96G$3y',
  '96S$3y',
  '96T$3y',
]
const BRAND_CODES = ['518$3', '53M$3', '969$3']
const RESTRICTED_GENERAL_CODES = ['500$3', '506$0', '506$3', '506$q', '509$3', '50N$3', '610$3']

registerAllowedKinds(COLLECTIVE_CODES, ['collective'])
registerAllowedKinds(PERSON_CODES, ['person'])
registerAllowedKinds(FAMILY_CODES, ['family'])
registerAllowedKinds(DEWEY_CODES, ['deweyConcept'])
registerAllowedKinds(CONCEPT_CODES, ['concept'])
registerAllowedKinds(EVENT_CODES, ['event'])
registerAllowedKinds(GENRE_FORM_CODES, ['genreForm'])
registerAllowedKinds(TIME_LAPSE_CODES, ['timeLapse'])
registerAllowedKinds(PLACE_CODES, ['place'])
registerAllowedKinds(BRAND_CODES, ['brand'])
registerAllowAllExcept(RESTRICTED_GENERAL_CODES, ['controlledValue', 'work', 'expression', 'manifestation'])

export function getAllowedKindsForSubfield(subfieldCode: string | undefined | null): readonly AutocompleteEntityKind[] | null {
  if (!subfieldCode) return null
  const normalized = normalizeCode(subfieldCode)
  if (!normalized) return null
  const set = SUBFIELD_KIND_RULES.get(normalized)
  if (!set) return null
  return Array.from(set)
}

export function inferEntityKind(typeNorm: string | undefined | null): AutocompleteEntityKind {
  if (!typeNorm) return 'other'
  const normalized = typeNorm.trim().toLowerCase()
  return TYPE_KIND_MAP[normalized] ?? 'other'
}
