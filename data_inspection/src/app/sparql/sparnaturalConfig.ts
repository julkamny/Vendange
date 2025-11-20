export const BASE_NS = 'https://vendange.bnf.fr'
export const CLASS_NS = `${BASE_NS}/class/`
export const REL_NS = `${BASE_NS}/relation/`
export const PROP_NS = `${BASE_NS}/property/`
const SPAR_NS = `${BASE_NS}/sparnatural#`

export const SPAR_CONTROLLED_VALUE_PREDICATE = `${SPAR_NS}subfieldControlledValue`
export const SPAR_SUBFIELD_VALUE_PREDICATE = `${SPAR_NS}subfieldValue`
export const SUBFIELD_VALUE_PREDICATE = `${BASE_NS}/subfieldValue`

export function buildSparnaturalConfig(): string {
  return `
@prefix : <${SPAR_NS}> .
@prefix vendclass: <${CLASS_NS}> .
@prefix vendrel: <${REL_NS}> .
@prefix vendprop: <${PROP_NS}> .
@prefix vend: <${BASE_NS}/> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix dash: <http://datashapes.org/dash#> .
@prefix core: <http://data.sparna.fr/ontologies/sparnatural-config-core#> .
@prefix volipi: <http://data.sparna.fr/ontologies/volipi#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<${SPAR_NS}config> a owl:Ontology .

:Work a sh:NodeShape ;
  sh:order "1"^^xsd:integer ;
  sh:targetClass vendclass:Work ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-book" ;
  rdfs:label "Work"@en , "Oeuvre"@fr ;
  sh:property :entityField , :entityArk , :workExpression , :workPerson , :workCollective , :workFamily .

:Expression a sh:NodeShape ;
  sh:order "2"^^xsd:integer ;
  sh:targetClass vendclass:Expression ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-scroll-old" ;
  rdfs:label "Expression"@en , "Expression"@fr ;
  sh:property :entityField , :entityArk , :expressionWork , :expressionManifestation , :expressionPerson , :expressionCollective , :expressionFamily .

:Manifestation a sh:NodeShape ;
  sh:order "3"^^xsd:integer ;
  sh:targetClass vendclass:Manifestation ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-layer-group" ;
  rdfs:label "Manifestation"@en , "Manifestation"@fr ;
  sh:property :entityField , :entityArk , :manifestationExpression , :manifestationPerson , :manifestationCollective , :manifestationFamily .

:Person a sh:NodeShape ;
  sh:order "4"^^xsd:integer ;
  sh:targetClass vendclass:PublicIdentity ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-user" ;
  rdfs:label "Person"@en , "Personne"@fr ;
  sh:property :entityField , :entityArk , :personWork , :personExpression , :personManifestation .

:Collective a sh:NodeShape ;
  sh:order "5"^^xsd:integer ;
  sh:targetClass vendclass:Collective ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-users" ;
  rdfs:label "Collective"@en , "Collectivité"@fr ;
  sh:property :entityField , :entityArk , :collectiveWork , :collectiveExpression , :collectiveManifestation .

:Family a sh:NodeShape ;
  sh:order "6"^^xsd:integer ;
  sh:targetClass vendclass:Family ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-people-roof" ;
  rdfs:label "Family"@en , "Famille"@fr ;
  sh:property :entityField , :entityArk , :familyWork , :familyExpression , :familyManifestation .

:Field a sh:NodeShape ;
  sh:order "10"^^xsd:integer ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-table" ;
  rdfs:label "Field (zone)"@en , "Zone"@fr ;
  sh:property :fieldCode , :fieldSubfield ;
  sh:deactivated true .

:Subfield a sh:NodeShape ;
  sh:order "11"^^xsd:integer ;
  sh:nodeKind sh:IRI ;
  volipi:iconName "fa-regular fa-square-ellipsis-vertical" ;
  rdfs:label "Subfield (sous-zone)"@en , "Sous-zone"@fr ;
  sh:property :subfieldCode , :subfieldValue , :subfieldControlledValue ;
  sh:deactivated true .

:Text a sh:NodeShape ;
  sh:order "50"^^xsd:integer ;
  sh:nodeKind sh:Literal ;
  volipi:iconName "fa-regular fa-font-case" ;
  rdfs:label "Text"@en , "Texte"@fr .

:entityField a sh:PropertyShape ;
  sh:path <${BASE_NS}/hasField> ;
  sh:name "Field"@en , "Zone MARC"@fr ;
  sh:node :Field ;
  dash:searchWidget core:NonSelectableProperty .

:fieldSubfield a sh:PropertyShape ;
  sh:path <${BASE_NS}/hasSubfield> ;
  sh:name "Subfield"@en , "Sous-zone"@fr ;
  sh:node :Subfield ;
  dash:searchWidget core:NonSelectableProperty .

:fieldCode a sh:PropertyShape ;
  sh:path <${BASE_NS}/fieldCode> ;
  sh:name "Field code"@en , "Code de zone"@fr ;
  sh:node :Text ;
  dash:searchWidget core:SearchProperty .

:subfieldCode a sh:PropertyShape ;
  sh:path <${BASE_NS}/subfieldCode> ;
  sh:name "Subfield code"@en , "Code de sous-zone"@fr ;
  sh:node :Text ;
  dash:searchWidget core:SearchProperty .

:subfieldValue a sh:PropertyShape ;
  sh:path <${BASE_NS}/subfieldValue> ;
  sh:name "Value contains"@en , "Valeur contient"@fr ;
  sh:node :Text ;
  dash:searchWidget core:SearchProperty .

:subfieldControlledValue a sh:PropertyShape ;
  sh:path <${BASE_NS}/subfieldValue> ;
  sh:name "Controlled value"@en , "Valeur contrôlée"@fr ;
  sh:node :Text ;
  dash:searchWidget core:LiteralListProperty .

:fieldRelatorCode a sh:PropertyShape ;
  sh:path <${BASE_NS}/subfieldValue> ;
  sh:name "Relator code"@en , "Code de fonction"@fr ;
  sh:node :Text ;
  dash:searchWidget core:LiteralListProperty .

:manifestationExpression a sh:PropertyShape ;
  sh:path <${REL_NS}740s3> ;
  sh:name "Linked expression"@en , "Expression reliée"@fr ;
  sh:node :Expression ;
  dash:searchWidget core:NonSelectableProperty .

:expressionWork a sh:PropertyShape ;
  sh:path <${REL_NS}750s3> ;
  sh:name "Linked work"@en , "Oeuvre reliée"@fr ;
  sh:node :Work ;
  dash:searchWidget core:NonSelectableProperty .

:expressionManifestation a sh:PropertyShape ;
  sh:path [ sh:inversePath <${REL_NS}740s3> ] ;
  sh:name "Linked manifestation"@en , "Manifestation reliée"@fr ;
  sh:node :Manifestation ;
  dash:searchWidget core:NonSelectableProperty .

:workExpression a sh:PropertyShape ;
  sh:path [ sh:inversePath <${REL_NS}750s3> ] ;
  sh:name "Linked expression"@en , "Expression reliée"@fr ;
  sh:node :Expression ;
  dash:searchWidget core:NonSelectableProperty .

:workPerson a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ;
  sh:name "Linked person"@en , "Personne liée"@fr ;
  sh:node :Person ;
  dash:searchWidget core:NonSelectableProperty .

:workCollective a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ;
  sh:name "Linked collective"@en , "Collectivité liée"@fr ;
  sh:node :Collective ;
  dash:searchWidget core:NonSelectableProperty .

:workFamily a sh:PropertyShape ;
  sh:path <${REL_NS}712s3> ;
  sh:name "Linked family"@en , "Famille liée"@fr ;
  sh:node :Family ;
  dash:searchWidget core:NonSelectableProperty .

:expressionPerson a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ;
  sh:name "Linked person"@en , "Personne liée"@fr ;
  sh:node :Person ;
  dash:searchWidget core:NonSelectableProperty .

:expressionCollective a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ;
  sh:name "Linked collective"@en , "Collectivité liée"@fr ;
  sh:node :Collective ;
  dash:searchWidget core:NonSelectableProperty .

:expressionFamily a sh:PropertyShape ;
  sh:path <${REL_NS}712s3> ;
  sh:name "Linked family"@en , "Famille liée"@fr ;
  sh:node :Family ;
  dash:searchWidget core:NonSelectableProperty .

:manifestationPerson a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ;
  sh:name "Linked person"@en , "Personne liée"@fr ;
  sh:node :Person ;
  dash:searchWidget core:NonSelectableProperty .

:manifestationCollective a sh:PropertyShape ;
  sh:path [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ;
  sh:name "Linked collective"@en , "Collectivité liée"@fr ;
  sh:node :Collective ;
  dash:searchWidget core:NonSelectableProperty .

:manifestationFamily a sh:PropertyShape ;
  sh:path <${REL_NS}712s3> ;
  sh:name "Linked family"@en , "Famille liée"@fr ;
  sh:node :Family ;
  dash:searchWidget core:NonSelectableProperty .

:personWork a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ] ;
  sh:name "Linked work"@en , "Oeuvre liée"@fr ;
  sh:node :Work ;
  dash:searchWidget core:NonSelectableProperty .

:personExpression a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ] ;
  sh:name "Linked expression"@en , "Expression liée"@fr ;
  sh:node :Expression ;
  dash:searchWidget core:NonSelectableProperty .

:personManifestation a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}700s3> <${REL_NS}701s3> <${REL_NS}702s3> ) ] ] ;
  sh:name "Linked manifestation"@en , "Manifestation liée"@fr ;
  sh:node :Manifestation ;
  dash:searchWidget core:NonSelectableProperty .

:collectiveWork a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ] ;
  sh:name "Linked work"@en , "Oeuvre liée"@fr ;
  sh:node :Work ;
  dash:searchWidget core:NonSelectableProperty .

:collectiveExpression a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ] ;
  sh:name "Linked expression"@en , "Expression liée"@fr ;
  sh:node :Expression ;
  dash:searchWidget core:NonSelectableProperty .

:collectiveManifestation a sh:PropertyShape ;
  sh:path [ sh:inversePath [ sh:alternativePath ( <${REL_NS}710s3> <${REL_NS}711s3> ) ] ] ;
  sh:name "Linked manifestation"@en , "Manifestation liée"@fr ;
  sh:node :Manifestation ;
  dash:searchWidget core:NonSelectableProperty .

:familyWork a sh:PropertyShape ;
  sh:path [ sh:inversePath <${REL_NS}712s3> ] ;
  sh:name "Linked work"@en , "Oeuvre liée"@fr ;
  sh:node :Work ;
  dash:searchWidget core:NonSelectableProperty .

:familyExpression a sh:PropertyShape ;
  sh:path [ sh:inversePath <${REL_NS}712s3> ] ;
  sh:name "Linked expression"@en , "Expression liée"@fr ;
  sh:node :Expression ;
  dash:searchWidget core:NonSelectableProperty .

:familyManifestation a sh:PropertyShape ;
  sh:path [ sh:inversePath <${REL_NS}712s3> ] ;
  sh:name "Linked manifestation"@en , "Manifestation liée"@fr ;
  sh:node :Manifestation ;
  dash:searchWidget core:NonSelectableProperty .

:entityArk a sh:PropertyShape ;
  sh:path <${PROP_NS}ark> ;
  sh:name "ARK"@en , "ARK"@fr ;
  sh:node :Text ;
  dash:searchWidget core:SearchProperty .
`.trim()
}
