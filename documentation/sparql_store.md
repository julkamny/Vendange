# Vendange SPARQL Store

The Vendange search backend now relies on an on-disk [Oxigraph](https://github.com/oxigraph/oxigraph/tree/main/python) database. Every CSV upload received by `POST /api/upload` wipes the previous content and materialises the curated dataset as RDF quads that can be queried with SPARQL.

## Quads & graphs

Oxigraph stores **quads**: `(subject, predicate, object, graph)`.

- The **subject** is the entity we talk about.
- The **predicate** is the property or relationship.
- The **object** is the value or target entity.
- The optional **graph name** scopes the triple to a named graph. When no graph is provided, the triple lives in the **default graph**.

Vendange writes every fact twice:

1. In the default graph, so a simple `SELECT` sees it immediately.
2. In a named graph `https://vendange.bnf.fr/graph/<record_id>` that contains only the quads extracted from that record. Updating a record is therefore a cheap “clear graph + reinsert” operation.

## Store location & lifecycle

- The generated database lives in `data_curation/api/vendange_store/`. The directory is recreated from scratch on every ingestion.
- The legacy `vendange.sqlite` file is removed automatically when the API starts.
- The named node `https://vendange.bnf.fr/entity/dataset` carries metadata such as the last uploaded dataset label.

## Vocabulary overview

All IRIs are rooted under `https://vendange.bnf.fr/…`.

| Concept | IRI pattern | Notes |
| --- | --- | --- |
| Entity identifier | `entity/<record_id>` | Same identifier as the CSV (`id_entitelrm`). |
| Record type | `class/{Work\|Expression\|Manifestation\|PublicIdentity\|Collective\|ControlledValue\|DeweyConcept\|Brand\|Family}` | The type is inferred from the `type_entite` column (diacritics ignored). |
| Raw CSV type | `property/type_raw` | Literal copy of `type_entite`. |
| ARK | `property/ark` | Literal ARK if present in `001$a`. |
| Dataset provenance | `property/source_dataset` | Points to `entity/dataset`. |
| MARC field | `field/<zone>` | One quad per field occurrence. Object is a JSON literal containing the zone and all its subfields. |
| `$3` relationship | `relation/<zone>$3` | Points to another record IRI (when known) or to the literal ARK named node. |
| `$3` literal | `relation_ark/<zone>$3` | Always stores the literal ARK string for auditing. |

### Field literals

Each MARC field is stored as a compact JSON string. Example for a `245` field:

```json
{"code":"245","sousZones":[{"code":"245$a","valeur":"Un |Bon petit diable"},{"code":"245$f","valeur":"[d'après la] Comtesse de Ségur"}],"index":7}
```

The optional `index` reflects the position of the field in the record; it helps distinguish repeated occurrences.

### Targeting subfields with regex

Because subfields are embedded in the JSON literal, SPARQL filters need a regular expression. For instance, all manifestations whose `245$a` contains “anémone” (accent insensitive thanks to the CSV preprocessing) can be written as:

```sparql
SELECT ?manifest ?field
WHERE {
  ?manifest <https://vendange.bnf.fr/field/245> ?field .
  FILTER regex(
    ?field,
    "\"code\"\\s*:\\s*\"245\\$a\"[^}]*\"valeur\"\\s*:\\s*\"[^\"]*anemon",
    "i"
  )
}
```

You can adapt the pattern to match several subfields or to capture `$3` occurrences (`"code":"740$3"` etc.).

## Example queries

Count works:

```sparql
SELECT (COUNT(?work) AS ?count)
WHERE { ?work a <https://vendange.bnf.fr/class/Work> }
```

Traverse manifestation → expression → work while excluding works whose `150$a` mentions adaptation:

```sparql
SELECT ?manifest ?expression ?work ?field
WHERE {
  ?manifest <https://vendange.bnf.fr/relation/740$3> ?expression ;
             <https://vendange.bnf.fr/field/245> ?field .
  ?expression <https://vendange.bnf.fr/relation/750$3> ?work .
  FILTER NOT EXISTS {
    ?work <https://vendange.bnf.fr/field/150> ?workField .
    FILTER regex(
      ?workField,
      "\"code\"\\s*:\\s*\"150\\$a\"[^}]*\"valeur\"\\s*:\\s*\"[^\"]*adaptation",
      "i"
    )
  }
}
LIMIT 25
```

List manifestations whose `245` field contains multiple subfields:

```sparql
SELECT ?manifest ?field
WHERE {
  ?manifest <https://vendange.bnf.fr/field/245> ?field .
  FILTER regex(?field, "\"245\\\\$a\"")  # ensure $a exists
  FILTER regex(?field, "\"245\\\\$g\"")  # ensure $g exists
}
LIMIT 10
```

## Querying with the Oxigraph CLI

The CLI is already available via `uv`:

```bash
uv run oxigraph query \
  --location data_curation/api/vendange_store \
  --query 'SELECT (COUNT(?m) AS ?count) WHERE { ?m a <https://vendange.bnf.fr/class/Manifestation> }' \
  --results-format tsv
```

`--results-format` supports `tsv`, `json`, `xml`, `sparql`, and more.

## Notes & caveats

- No normalised duplicates are stored: only the raw field JSON survives. Use SPARQL functions (`regex`, `LCASE`, etc.) when you need case- or accent-insensitive matching.
- `$3` relations always expose both the linked entity (when resolvable) and the literal ARK.
- Updating a record rewrites its named graph and the corresponding default-graph quads atomically; there is no need to re-upload the whole CSV after manual edits.
