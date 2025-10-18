export const sparnaturalConfigTtl = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix core: <http://data.sparna.fr/ontologies/sparnatural-config-core#> .
@prefix dash: <http://datashapes.org/dash#> .
@prefix vendange: <https://data.vendange/search#> .

vendange:WorkShape a sh:NodeShape ;
  sh:targetClass vendange:Work ;
  rdfs:label "Work"@en , "Œuvre"@fr ;
  core:faIcon "fa-solid fa-book" ;
  sh:property vendange:Work_hasExpression , vendange:Work_fields , vendange:Work_relationships , vendange:Work_agents .

vendange:Work_hasExpression a sh:PropertyShape ;
  sh:path vendange:hasExpression ;
  sh:class vendange:Expression ;
  rdfs:label "has expression"@en , "a pour expression"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Work_fields a sh:PropertyShape ;
  sh:path vendange:hasField ;
  sh:class vendange:Field ;
  rdfs:label "field"@en , "zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Work_relationships a sh:PropertyShape ;
  sh:path vendange:hasRelationship ;
  sh:class vendange:Relationship ;
  rdfs:label "relationship"@en , "relation"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Work_agents a sh:PropertyShape ;
  sh:path vendange:hasAgent ;
  sh:class vendange:Agent ;
  rdfs:label "agent"@en , "agent"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:ExpressionShape a sh:NodeShape ;
  sh:targetClass vendange:Expression ;
  rdfs:label "Expression"@en , "Expression"@fr ;
  core:faIcon "fa-solid fa-scroll" ;
  sh:property vendange:Expression_hasWork , vendange:Expression_manifestations , vendange:Expression_fields , vendange:Expression_relationships , vendange:Expression_agents .

vendange:Expression_hasWork a sh:PropertyShape ;
  sh:path vendange:hasWork ;
  sh:class vendange:Work ;
  rdfs:label "has work"@en , "a pour œuvre"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Expression_manifestations a sh:PropertyShape ;
  sh:path vendange:hasManifestation ;
  sh:class vendange:Manifestation ;
  rdfs:label "has manifestation"@en , "a pour manifestation"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Expression_fields a sh:PropertyShape ;
  sh:path vendange:hasField ;
  sh:class vendange:Field ;
  rdfs:label "field"@en , "zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Expression_relationships a sh:PropertyShape ;
  sh:path vendange:hasRelationship ;
  sh:class vendange:Relationship ;
  rdfs:label "relationship"@en , "relation"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Expression_agents a sh:PropertyShape ;
  sh:path vendange:hasAgent ;
  sh:class vendange:Agent ;
  rdfs:label "agent"@en , "agent"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:ManifestationShape a sh:NodeShape ;
  sh:targetClass vendange:Manifestation ;
  rdfs:label "Manifestation"@en , "Manifestation"@fr ;
  core:faIcon "fa-solid fa-book-open" ;
  sh:property vendange:Manifestation_hasExpression , vendange:Manifestation_fields , vendange:Manifestation_relationships , vendange:Manifestation_agents .

vendange:Manifestation_hasExpression a sh:PropertyShape ;
  sh:path vendange:hasExpression ;
  sh:class vendange:Expression ;
  rdfs:label "has expression"@en , "a pour expression"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Manifestation_fields a sh:PropertyShape ;
  sh:path vendange:hasField ;
  sh:class vendange:Field ;
  rdfs:label "field"@en , "zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Manifestation_relationships a sh:PropertyShape ;
  sh:path vendange:hasRelationship ;
  sh:class vendange:Relationship ;
  rdfs:label "relationship"@en , "relation"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Manifestation_agents a sh:PropertyShape ;
  sh:path vendange:hasAgent ;
  sh:class vendange:Agent ;
  rdfs:label "agent"@en , "agent"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:AgentShape a sh:NodeShape ;
  sh:targetClass vendange:Agent ;
  rdfs:label "Agent"@en , "Agent"@fr ;
  core:faIcon "fa-solid fa-user" ;
  sh:property vendange:Agent_fields , vendange:Agent_linkedWorks .

vendange:Agent_fields a sh:PropertyShape ;
  sh:path vendange:hasField ;
  sh:class vendange:Field ;
  rdfs:label "field"@en , "zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Agent_linkedWorks a sh:PropertyShape ;
  sh:path [ sh:inversePath vendange:hasAgent ] ;
  sh:class vendange:Work ;
  rdfs:label "is agent of"@en , "est agent de"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:ControlledShape a sh:NodeShape ;
  sh:targetClass vendange:Controlled ;
  rdfs:label "Controlled"@en , "Entité"@fr ;
  sh:property vendange:Generic_fields , vendange:Generic_relationships .

vendange:Generic_fields a sh:PropertyShape ;
  sh:path vendange:hasField ;
  sh:class vendange:Field ;
  rdfs:label "field"@en , "zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Generic_relationships a sh:PropertyShape ;
  sh:path vendange:hasRelationship ;
  sh:class vendange:Relationship ;
  rdfs:label "relationship"@en , "relation"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:RelationshipShape a sh:NodeShape ;
  sh:targetClass vendange:Relationship ;
  rdfs:label "Relationship"@en , "Relation"@fr ;
  sh:property vendange:Relationship_zone , vendange:Relationship_target , vendange:Relationship_targetArk .

vendange:Relationship_zone a sh:PropertyShape ;
  sh:path vendange:relationshipZone ;
  sh:datatype xsd:string ;
  rdfs:label "zone"@en , "zone"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Relationship_target a sh:PropertyShape ;
  sh:path vendange:relationshipTarget ;
  sh:class vendange:Controlled ;
  rdfs:label "target"@en , "cible"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Relationship_targetArk a sh:PropertyShape ;
  sh:path vendange:relatedToArk ;
  sh:datatype xsd:string ;
  rdfs:label "target ark"@en , "ark cible"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:FieldShape a sh:NodeShape ;
  sh:targetClass vendange:Field ;
  rdfs:label "Field"@en , "Zone"@fr ;
  sh:property vendange:Field_code , vendange:Field_index , vendange:Field_subfields .

vendange:Field_code a sh:PropertyShape ;
  sh:path vendange:zoneCode ;
  sh:datatype xsd:string ;
  rdfs:label "code"@en , "code"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Field_index a sh:PropertyShape ;
  sh:path vendange:fieldIndex ;
  sh:datatype xsd:integer ;
  rdfs:label "index"@en , "indice"@fr ;
  core:enableOptional "true"^^xsd:boolean .

vendange:Field_subfields a sh:PropertyShape ;
  sh:path vendange:hasSubfield ;
  sh:class vendange:Subfield ;
  rdfs:label "subfield"@en , "sous-zone"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:SubfieldShape a sh:NodeShape ;
  sh:targetClass vendange:Subfield ;
  rdfs:label "Subfield"@en , "Sous-zone"@fr ;
  sh:property vendange:Subfield_code , vendange:Subfield_index , vendange:Subfield_value , vendange:Subfield_normalized , vendange:Subfield_reference .

vendange:Subfield_code a sh:PropertyShape ;
  sh:path vendange:subfieldCode ;
  sh:datatype xsd:string ;
  rdfs:label "code"@en , "code"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Subfield_index a sh:PropertyShape ;
  sh:path vendange:subfieldIndex ;
  sh:datatype xsd:integer ;
  rdfs:label "index"@en , "indice"@fr ;
  core:enableOptional "true"^^xsd:boolean .

vendange:Subfield_value a sh:PropertyShape ;
  sh:path vendange:value ;
  sh:datatype xsd:string ;
  rdfs:label "value"@en , "valeur"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Subfield_normalized a sh:PropertyShape ;
  sh:path vendange:valueNormalized ;
  sh:datatype xsd:string ;
  rdfs:label "normalized"@en , "normalisée"@fr ;
  dash:searchWidget core:SearchProperty ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .

vendange:Subfield_reference a sh:PropertyShape ;
  sh:path vendange:references ;
  sh:class vendange:Controlled ;
  rdfs:label "references"@en , "référence"@fr ;
  core:enableOptional "true"^^xsd:boolean ;
  core:enableNegation "true"^^xsd:boolean .
`
