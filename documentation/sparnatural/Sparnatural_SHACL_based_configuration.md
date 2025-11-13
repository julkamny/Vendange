# Sparnatural documentation

* Lang.
  + [fr](/fr)
  + [en](/)
* [Github](https://github.com/sparna-git/Sparnatural)

*[Home](index.html) > SHACL-based configuration*

# SHACL-based configuration

Sparnatural can be configured using a SHACL specification of the entities and properties to be displayed in the UI.

## Sparnatural SHACL configuration profile

The formal specification of the subset of SHACL to use, in combination with a few properties from other ontologies, is defined in the **Sparnatural SHACL configuration profile**, available as an [HTML documentation](https://shacl-play.sparna.fr/play/doc?url=https%3A%2F%2Fxls2rdf.sparna.fr%2Frest%2Fconvert%3FnoPostProcessings%3Dtrue%26url%3Dhttps%253A%252F%252Fdocs.google.com%252Fspreadsheets%252Fd%252F195NKb43Ck1yPGrIK4H8_HYGw9GTPnbtY%252Fexport%253Fformat%253Dxlsx&includeDiagram=true), an [online spreadsheet](https://docs.google.com/spreadsheets/d/195NKb43Ck1yPGrIK4H8_HYGw9GTPnbtY), or a [technical SHACL file](https://xls2rdf.sparna.fr/rest/convert?noPostProcessings=true&url=https%3A%2F%2Fdocs.google.com%2Fspreadsheets%2Fd%2F195NKb43Ck1yPGrIK4H8_HYGw9GTPnbtY%2Fexport%3Fformat%3Dxlsx).

## Reference of the Sparnatural SHACL configuration profile

### Namespaces

| Prefix | Namespaces |
| --- | --- |
| config-core | http://data.sparna.fr/ontologies/sparnatural-config-core# |
| dash | http://datashapes.org/dash# |
| ds | http://data.sparna.fr/ontologies/sparnatural-config-datasources# |
| sh | http://www.w3.org/ns/shacl# |
| volipi | http://data.sparna.fr/ontologies/volipi# |

### NodeShapes configuration reference

| Property name | URI | Expected value | Card. | Description |
| --- | --- | --- | --- | --- |
| type | `[rdf:type](http://www.w3.org/1999/02/22-rdf-syntax-ns#type)` | `sh:NodeShape` | 1..\* | Class. Value must always be sh:NodeShape. |
| label | `[rdfs:label](http://www.w3.org/2000/01/rdf-schema#label)` | `rdf:langString` `or` `xsd:string` | 0..\* | The label of the entity to be displayed in Sparnatural. Labels are multilingual, and can provide multiple labels in different languages. Lhe label in the current user language is displayed; If no label is given, the local part of the URI is used. |
| order | `[sh:order](http://www.w3.org/ns/shacl#order)` | `xsd:decimal` | 0..\* | The order of this entity in the entity selection dropdown. |
| tooltip 1 | `[volipi:message](http://data.sparna.fr/ontologies/volipi#message)` | `rdf:langString` `or` `xsd:string` | 0..\* | The preferred tooltip that will be displayed when this entity is hovered. This can contain HTML markup. Tooltips are also multilingual, you can provide one tooltip per language, and the tooltip in the current user language is used. |
| tooltip 2 | `[sh:description](http://www.w3.org/ns/shacl#description)` | `rdf:langString` `or` `xsd:string` | 0..\* | A tooltip that will be displayed when this entity is hovered, if no preferred tooltip is provided. This can contain HTML markup. |
| fontawesome icon code | `[volipi:iconName](http://data.sparna.fr/ontologies/volipi#iconName)` | `xsd:string` | 0..1 | The fontawesome icon code that will be displayed by Sparnatural, e.g. "fa-solid fa-user" |
| icon url | `[volipi:icon](http://data.sparna.fr/ontologies/volipi#icon)` | `IRI` | 0..1 | A reference to an icon URL that will be displayed on Sparnatural. Use of this is discouraged, prefer volipi:iconName |
| target class | `[sh:targetClass](http://www.w3.org/ns/shacl#targetClass)` | `[Target class](#scs:TargetClass)` | 0..\* | The actual URI of the class that this shape corresponds to, that will be inserted in the SPARQL queries. NodeShapes can either have sh:targetClass or they can be rdf:type rdfs:Class, in which case the URI of the NodeShape is assumed to be the URI of the class itself. |
| node kind | `[sh:nodeKind](http://www.w3.org/ns/shacl#nodeKind)` | `IRI` | 0..1 | If used on a NodeShape with value sh:Literal, then Sparnatural will treat this shape as a Literal and will not generate an rdf:type triple in the SPARQL query. |
| datatype | `[sh:datatype](http://www.w3.org/ns/shacl#datatype)` | `IRI` | 0..1 | If used on a NodeShape, then Sparnatural will treat this shape as a Literal and will not generate an rdf:type triple in the SPARQL query. |
| language in | `[sh:languageIn](http://www.w3.org/ns/shacl#languageIn)` | `BlankNode` | 0..1 | If used on a NodeShape, then Sparnatural will treat this shape as a Literal and will not generate an rdf:type triple in the SPARQL query. |
| unique lang | `[sh:uniqueLang](http://www.w3.org/ns/shacl#uniqueLang)` | `xsd:boolean` | 0..1 | If used on a NodeShape, then Sparnatural will treat this shape as a Literal and will not generate an rdf:type triple in the SPARQL query. |
| deactivated | `[sh:deactivated](http://www.w3.org/ns/shacl#deactivated)` | `xsd:boolean` | 0..1 | If marked with sh:deactivated, a shape will be filtered out from the initial list of classes |
| or | `[sh:or](http://www.w3.org/ns/shacl#or)` | `BlankNode` | 0..\* |  |
| subclass of | `[rdfs:subClassOf](http://www.w3.org/2000/01/rdf-schema#subClassOf)` | `[Target class](#scs:TargetClass)` | 0..\* | If the NodeShape is also a Class, it can have a subClassOf reference to the class(es) from which it will inherit the properties |

### PropertyShapes configuration reference

| Property name | URI | Expected value | Card. | Description |
| --- | --- | --- | --- | --- |
| entity / shape | `^sh:property` | `[Sparnatural entity](#scs:Entity)` | 1..\* | The entity from the configuration to which the property is attached. Note that this is expressed as an inverse property on the PropertyShapes, for ease of use when defining SHACL configurations in Excel tables. |
| property | `[sh:path](http://www.w3.org/ns/shacl#path)` | `BlankNodeOrIRI` | 1..1 | The property IRI, or the SHACL property path that this property shape is constraining. |
| order | `[sh:order](http://www.w3.org/ns/shacl#order)` | `xsd:decimal` | 0..1 | The order of this property in the property selection drpdown. |
| name | `[sh:name](http://www.w3.org/ns/shacl#name)` | `rdf:langString` `or` `xsd:string` | 0..\* | The name of the property to be displayed. Labels are multilingual, and can provide multiple labels in different languages. Lhe label in the current user language is displayed; If no label is given, the local part of the URI is used. |
| tooltip 1 | `[volipi:message](http://data.sparna.fr/ontologies/volipi#message)` | `rdf:langString` `or` `xsd:string` | 0..\* | The preferred tooltip that will be displayed when this entity is hovered. This can contain HTML markup. Tooltips are also multilingual, you can provide one tooltip per language, and the tooltip in the current user language is used. |
| tooltip 2 | `[sh:description](http://www.w3.org/ns/shacl#description)` | `rdf:langString` `or` `xsd:string` | 0..\* | A tooltip that will be displayed when this entity is hovered, if no preferred tooltip is provided. This can contain HTML markup. |
| tooltip 3 | `sh:path/skos:definition` | `rdf:langString` `or` `xsd:string` | 0..\* | The definition of the property, that can be used as tooltip, if no tooltips are provided on the shape |
| tooltip 4 | `sh:path/rdfs:comment` | `rdf:langString` `or` `xsd:string` | 0..\* | A comment on the property, that can be used as tooltip, if no tooltips are provided on the shape, and there is no definition on the property |
| search widget | `[dash:searchWidget](http://datashapes.org/dash#searchWidget)` | `IRI`  (config-core:SearchProperty, config-core:ListProperty, config-core:AutocompleteProperty, config-core:BooleanProperty, config-core:MapProperty, config-core:StringEqualsProperty, config-core:TimeProperty-Date, config-core:TimeProperty-Year, config-core:TimeProperty-Period, config-core:TreeProperty, config-core:NumberProperty) | 0..1 | An explicit search widget to use for this property. If no explicit search widget is specified, a default one is determined based on the sh:datatype and other characteristics of the property shape. |
| role of the property (default label property) | `[dash:propertyRole](http://datashapes.org/dash#propertyRole)` | `dash:LabelRole` | 0..1 | If used with the value dash:LabelRole, indicate that this property shape describes the main label of the entities to which it is attached. This is used to fetch this property automatically in generated SPARQL queries, and to populate automatically dropdowns and autocomplete search with this property. |
| class (of the property value) | `[sh:class](http://www.w3.org/ns/shacl#class)` | `IRI` | 0..1 | Defines the entity in the configuration that is the value of this property. References the URI of a class that is itself referred to by an sh:targetClass from a NodeShape. |
| node shape (of the property value) | `[sh:node](http://www.w3.org/ns/shacl#node)` | `IRI` | 0..1 | Defines the entity in the configuration that is the value of this property. References a NodeShape that describes the target entity of the property. If no sh:class or sh:node is found, then a default behavior is proposed |
| deactivated | `[sh:deactivated](http://www.w3.org/ns/shacl#deactivated)` | `xsd:boolean` | 0..1 | In case a property shape is marked as deactivated, it will not be shown in the interface |
| datasource (for lists and autocomplete) | `[config-datasources:datasource](http://data.sparna.fr/ontologies/sparnatural-config-datasourcesdatasource)` | `BlankNodeOrIRI` | 0..1 | The datasource to populate the widget of the property. If not provided, a default datasource is used. |
| sh:in | `[sh:in](http://www.w3.org/ns/shacl#in)` | `BlankNode` | 0..1 | If sh:in is used on the property shape, its default widget will be a dropdown and the list content will be read from the configuration instead of being read from a SPARQL query |
| datasource (for tree childrens) | `[config-datasources:treeChildrenDatasource](http://data.sparna.fr/ontologies/sparnatural-config-datasourcestreeChildrenDatasource)` | `BlankNodeOrIRI` | 0..1 | The datasource to populate the children node of a node in a tree widget |
| datasource (for tree roots) | `[config-datasources:treeRootsDatasource](http://data.sparna.fr/ontologies/sparnatural-config-datasourcestreeRootsDatasource)` | `BlankNodeOrIRI` | 0..1 | The datasource to populate the root nodes of a tree widget |
| or | `[sh:or](http://www.w3.org/ns/shacl#or)` | `BlankNodeOrIRI` | 0..1 | Indicates alternatives for either multiple datatypes (e.g. xsd:string or xsd:dateTime), or multiple sh:class/sh:node, or different node kinds (e.g. IRI or Literal). The expected values are nodes with either an sh:datatype or an sh:class or an sh:node or an sh:nodeKind. 2 levels of sh:or are supported to deal with properties that can be either IRI or literals, and then indicate the sh:class(es) of the IRI shape, and the sh:datatype(s) of the literal shape. The actual list value of sh:or can be either a blank node or an IRI. Example : property with 2 datatypes : ([sh:datatype xsd:string][sh:datatype xsd:dateTime]), Example : property either IRI or literal ([sh:nodeKind sh:IRI; sh:class ex:class1][sh:nodeKind sh:Literal sh:or([sh:datatype xsd:string][sh:datatype xsd:date])]) |

### Classes configuration reference

`rdfs:subClassOf` is read on classes to inherit properties of superclasses, as well as labels and definitions for UI display.

| Property name | URI | Expected value | Card. | Description |
| --- | --- | --- | --- | --- |
| subClassOf | `[rdfs:subClassOf](http://www.w3.org/2000/01/rdf-schema#subClassOf)` | `[Target class](#scs:TargetClass)` | 0..\* | Indicates the superclass or superclasses of this class, from which this node shape inherits. When a class is selected in Sparnatural, the properties of its superclasses will be proposed. |
| is target of | `^sh:targetClass` | `[Sparnatural entity](#scs:Entity)` | 0..\* | A target class may be referenced by a NodeShape through sh:targetClass, or it can be itself a sh:NodeShape. The properties of the NodeShape are inherited by the subclasses. |
| definition | `[skos:definition](http://www.w3.org/2004/02/skos/core#definition)` | `rdf:langString` `or` `xsd:string` | 0..\* | The definition of the class, that can be used as a tooltip |
| comment | `[rdfs:comment](http://www.w3.org/2000/01/rdf-schema#comment)` | `rdf:langString` `or` `xsd:string` | 0..\* | A comment on the class, that can be used as a tolltip |
| label | `[rdfs:label](http://www.w3.org/2000/01/rdf-schema#label)` | `rdf:langString` `or` `xsd:string` | 0..\* | The label of the class, to be used if no rdfs:label is found on the node shape |