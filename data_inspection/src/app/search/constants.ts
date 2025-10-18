export const SEARCH_NS = 'https://data.vendange/search#'
export const ENTITY_NS = `${SEARCH_NS}entity/`

export const CLASSES = {
  Work: `${SEARCH_NS}Work`,
  Expression: `${SEARCH_NS}Expression`,
  Manifestation: `${SEARCH_NS}Manifestation`,
  Agent: `${SEARCH_NS}Agent`,
  Collective: `${SEARCH_NS}Collective`,
  Brand: `${SEARCH_NS}Brand`,
  Concept: `${SEARCH_NS}Concept`,
  Controlled: `${SEARCH_NS}Controlled`,
  Field: `${SEARCH_NS}Field`,
  Subfield: `${SEARCH_NS}Subfield`,
  Relationship: `${SEARCH_NS}Relationship`,
}

export const PREDICATES = {
  type: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
  label: 'http://www.w3.org/2000/01/rdf-schema#label',
  ark: `${SEARCH_NS}ark`,
  typeNorm: `${SEARCH_NS}typeNorm`,
  hasField: `${SEARCH_NS}hasField`,
  zoneCode: `${SEARCH_NS}zoneCode`,
  fieldIndex: `${SEARCH_NS}fieldIndex`,
  hasSubfield: `${SEARCH_NS}hasSubfield`,
  belongsTo: `${SEARCH_NS}belongsTo`,
  subfieldCode: `${SEARCH_NS}subfieldCode`,
  subfieldIndex: `${SEARCH_NS}subfieldIndex`,
  subfieldValue: `${SEARCH_NS}value`,
  subfieldValueNormalized: `${SEARCH_NS}valueNormalized`,
  subfieldArk: `${SEARCH_NS}valueArk`,
  referencesEntity: `${SEARCH_NS}references`,
  fieldPredicatePrefix: `${SEARCH_NS}field/`,
  normalizedSuffix: '/normalized',
  hasExpression: `${SEARCH_NS}hasExpression`,
  hasExpressionArk: `${SEARCH_NS}hasExpressionArk`,
  hasManifestation: `${SEARCH_NS}hasManifestation`,
  hasManifestationArk: `${SEARCH_NS}hasManifestationArk`,
  hasWork: `${SEARCH_NS}hasWork`,
  hasWorkArk: `${SEARCH_NS}hasWorkArk`,
  relatedTo: `${SEARCH_NS}relatedTo`,
  relatedToArk: `${SEARCH_NS}relatedToArk`,
  relationshipZone: `${SEARCH_NS}relationshipZone`,
  hasRelationship: `${SEARCH_NS}hasRelationship`,
  relationshipTarget: `${SEARCH_NS}relationshipTarget`,
  hasAgent: `${SEARCH_NS}hasAgent`,
  hasAgentArk: `${SEARCH_NS}hasAgentArk`,
  agentZone: `${SEARCH_NS}agentZone`,
  agentSubfield: `${SEARCH_NS}agentSubfield`,
}

export const DEFAULT_PREFIXES = `PREFIX vendange: <${SEARCH_NS}>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
`
