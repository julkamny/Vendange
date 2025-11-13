const BASE_NS = 'https://vendange.bnf.fr'
const CLASS_NS = `${BASE_NS}/class/`
const REL_NS = `${BASE_NS}/relation/`
const PROP_NS = `${BASE_NS}/property/`
const SPAR_NS = `${BASE_NS}/sparnatural#`

export const SPAR_CONTROLLED_VALUE_PREDICATE = `${SPAR_NS}subfieldControlledValue`
export const SPAR_SUBFIELD_VALUE_PREDICATE = `${SPAR_NS}subfieldValue`

export function buildSparnaturalConfig(): string {
  return `
@prefix : <${SPAR_NS}> .
@prefix vendclass: <${CLASS_NS}> .
@prefix vendrel: <${REL_NS}> .
@prefix vendprop: <${PROP_NS}> .
@prefix vend: <${BASE_NS}/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix core: <http://data.sparna.fr/ontologies/sparnatural-config-core#> .

<${SPAR_NS}config> a owl:Ontology ;
  owl:imports <http://data.sparna.fr/ontologies/sparnatural-config-core> .

:Work a owl:Class ;
  rdfs:subClassOf core:SparnaturalClass ;
  core:sparqlString "<${CLASS_NS}Work>" ;
  core:faIcon "fa-regular fa-book" ;
  rdfs:label "Work"@en , "Oeuvre"@fr .

:Expression a owl:Class ;
  rdfs:subClassOf core:SparnaturalClass ;
  core:sparqlString "<${CLASS_NS}Expression>" ;
  core:faIcon "fa-regular fa-scroll-old" ;
  rdfs:label "Expression"@en , "Expression"@fr .

:Manifestation a owl:Class ;
  rdfs:subClassOf core:SparnaturalClass ;
  core:sparqlString "<${CLASS_NS}Manifestation>" ;
  core:faIcon "fa-regular fa-layer-group" ;
  rdfs:label "Manifestation"@en , "Manifestation"@fr .

:Field a owl:Class ;
  rdfs:subClassOf core:NotInstantiatedClass ;
  core:faIcon "fa-regular fa-table" ;
  rdfs:label "Field (zone)"@en , "Zone"@fr .

:Subfield a owl:Class ;
  rdfs:subClassOf core:NotInstantiatedClass ;
  core:faIcon "fa-regular fa-square-ellipsis-vertical" ;
  rdfs:label "Subfield (sous-zone)"@en , "Sous-zone"@fr .

:Text a owl:Class ;
  rdfs:subClassOf rdfs:Literal ;
  core:faIcon "fa-regular fa-font-case" ;
  rdfs:label "Text"@en , "Texte"@fr .

:entityField a owl:ObjectProperty ;
  rdfs:subPropertyOf core:NonSelectableProperty ;
  rdfs:domain [ a owl:Class ; owl:unionOf ( :Work :Expression :Manifestation ) ] ;
  rdfs:range :Field ;
  core:sparqlString "<${BASE_NS}/hasField>" ;
  rdfs:label "Field"@en , "Zone MARC"@fr .

:fieldSubfield a owl:ObjectProperty ;
  rdfs:subPropertyOf core:NonSelectableProperty ;
  rdfs:domain :Field ;
  rdfs:range :Subfield ;
  core:sparqlString "<${BASE_NS}/hasSubfield>" ;
  rdfs:label "Subfield"@en , "Sous-zone"@fr .

:fieldCode a owl:ObjectProperty ;
  rdfs:subPropertyOf core:SearchProperty ;
  rdfs:domain :Field ;
  rdfs:range :Text ;
  core:sparqlString "<${BASE_NS}/fieldCode>" ;
  rdfs:label "Field code"@en , "Code de zone"@fr .

:subfieldCode a owl:ObjectProperty ;
  rdfs:subPropertyOf core:SearchProperty ;
  rdfs:domain :Subfield ;
  rdfs:range :Text ;
  core:sparqlString "<${BASE_NS}/subfieldCode>" ;
  rdfs:label "Subfield code"@en , "Code de sous-zone"@fr .

:subfieldValue a owl:ObjectProperty ;
  rdfs:subPropertyOf core:SearchProperty ;
  rdfs:domain :Subfield ;
  rdfs:range :Text ;
  core:sparqlString "<${BASE_NS}/subfieldValue>" ;
  rdfs:label "Value contains"@en , "Valeur contient"@fr .

:subfieldControlledValue a owl:ObjectProperty ;
  rdfs:subPropertyOf core:LiteralListProperty ;
  rdfs:domain :Subfield ;
  rdfs:range :Text ;
  core:sparqlString "<${BASE_NS}/subfieldValue>" ;
  rdfs:label "Controlled value"@en , "Valeur contrôlée"@fr .

:manifestationExpression a owl:ObjectProperty ;
  rdfs:subPropertyOf core:NonSelectableProperty ;
  rdfs:domain :Manifestation ;
  rdfs:range :Expression ;
  core:sparqlString "<${REL_NS}740s3>" ;
  rdfs:label "linked expression"@en , "Expression reliée"@fr .

:expressionWork a owl:ObjectProperty ;
  rdfs:subPropertyOf core:NonSelectableProperty ;
  rdfs:domain :Expression ;
  rdfs:range :Work ;
  core:sparqlString "<${REL_NS}750s3>" ;
  rdfs:label "linked work"@en , "Oeuvre reliée"@fr .

:entityArk a owl:ObjectProperty ;
  rdfs:subPropertyOf core:SearchProperty ;
  rdfs:domain [ a owl:Class ; owl:unionOf ( :Work :Expression :Manifestation ) ] ;
  rdfs:range :Text ;
  core:sparqlString "<${PROP_NS}ark>" ;
  rdfs:label "ARK"@en , "ARK"@fr .
`.trim()
}
