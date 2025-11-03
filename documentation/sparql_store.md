# Vendange SPARQL Store

The FastAPI backend now materialises every curated CSV upload as an [Oxigraph](https://github.com/oxigraph/oxigraph/tree/main/python) database. Each record becomes a collection of RDF **quads** `(subject, predicate, object, graph)`:

- `subject` — the entity the fact is about
- `predicate` — the property/relationship being asserted
- `object` — the value (literal or another node)
- `graph` — the named graph that scopes the statement. Vendange always stores quads in record-specific named graphs; the default graph stays empty.

Every record lives in its own named graph `https://vendange.bnf.fr/graph/<record_id>`. Updates simply clear that graph and re-insert fresh quads.

## Where the data lives

- Oxigraph files: `data_curation/api/datasets/<dataset_id>/`
- Dataset registry: `data_curation/api/datasets/datasets.json`
- Dataset metadata entity: `https://vendange.bnf.fr/entity/dataset` (stores the last dataset label)

## Vocabulary cheat sheet

IRIs are rooted under `https://vendange.bnf.fr/…`.

| Subject → Predicate → Object | Description |
| --- | --- |
| `entity/<id>` → `rdf:type` → `class/{Workar Expressionar Manifestationar PublicIdentityar Collectivear ControlledValuear DeweyConceptar Brandar Family}` | Entity type inferred from `type_entite` (diacritics folded). |
| `entity/<id>` → `property/type_raw` → _literal_ | Raw `type_entite` string. |
| `entity/<id>` → `property/ark` → _literal_ | `001$a` when present. |
| `entity/<id>` → `property/source_dataset` → `entity/dataset` | Dataset provenance. |
| `entity/<id>` → `hasField` → `_:` field blank node | Connects the entity to every MARC field. |
| field blank node → `fieldCode` → _literal_ | MARC zone code (`245`, `700`, …). |
| field blank node → `property/affectedByCuration` → _literal_ | Curation impact for the whole field (`created`, `modified`, …). |
| field blank node → `hasSubfield` → `_:` subfield blank node | Links fields to their subfields. |
| field blank node → `fieldCompactValue` → _literal (JSON)_ | Storage zones (990/907/90H/901/991) serialised as Intermarc JSON. |
| subfield blank node → `subfieldCode` → _literal_ | Subfield code with `$` replaced by `s` (`245$a` → `245sa`). |
| subfield blank node → `subfieldValue` → _literal_ | Raw value. |
| subfield blank node → `property/affectedByCuration` → _literal_ | Curation impact for the specific subfield (`created`, `modified`, …). |
| `entity/<id>` → `relation/<code>` → target | `$3` relationships (code sanitised as above). Target is another record IRI when known, otherwise we keep the named node for the ARK. |
| `entity/<id>` → `relation_ark/<code>` → _literal_ | Literal ARK value for every `$3`. |

> **Sanitised subfield codes** — every `$` becomes `s`, e.g. `740$3` → `740s3`. This keeps IRIs prefix-friendly for tools like Sparnatural.

Storage fields (`990`, `907`, `90H`, `901`, `991`) rely on `fieldCompactValue` and do not expose `hasSubfield` blank nodes; parse the JSON payload if you need individual subfields.

## Example queries

Count works:

```sparql
SELECT (COUNT(?work) AS ?count)
WHERE { ?work a <https://vendange.bnf.fr/class/Work> }
```

Manifestations whose `245$a` contains “anémone” (case-insensitive). We pattern-match on sanitised codes `245sa`:

```sparql
SELECT ?manifest ?value
WHERE {
  ?manifest <https://vendange.bnf.fr/hasField> ?field .
  ?field <https://vendange.bnf.fr/fieldCode> "245" .
  ?field <https://vendange.bnf.fr/hasSubfield> ?subfield .
  ?subfield <https://vendange.bnf.fr/subfieldCode> "245sa" ;
            <https://vendange.bnf.fr/subfieldValue> ?value .
  FILTER regex(?value, "anemone", "i")
}
```

Walk manifestation → expression → work while excluding works whose `150$a` contains “adaptation”:

```sparql
SELECT ?manifest ?expr ?work ?title
WHERE {
  ?manifest <https://vendange.bnf.fr/relation/740s3> ?expr .
  ?expr      <https://vendange.bnf.fr/relation/750s3> ?work .
  ?manifest <https://vendange.bnf.fr/hasField> ?field .
  ?field <https://vendange.bnf.fr/fieldCode> "245" ;
         <https://vendange.bnf.fr/hasSubfield> ?titleSub .
  ?titleSub <https://vendange.bnf.fr/subfieldCode> "245sa" ;
            <https://vendange.bnf.fr/subfieldValue> ?title .
  FILTER NOT EXISTS {
    ?work <https://vendange.bnf.fr/hasField> ?wField .
    ?wField <https://vendange.bnf.fr/fieldCode> "150" ;
            <https://vendange.bnf.fr/hasSubfield> ?wSub .
    ?wSub <https://vendange.bnf.fr/subfieldCode> "150sa" ;
          <https://vendange.bnf.fr/subfieldValue> ?wValue .
    FILTER regex(?wValue, "adaptation", "i")
  }
}
LIMIT 25
```

List storage fields and their compact JSON payloads:

```sparql
SELECT ?entity ?code ?payload
WHERE {
  ?entity <https://vendange.bnf.fr/hasField> ?field .
  ?field <https://vendange.bnf.fr/fieldCode> ?code ;
         <https://vendange.bnf.fr/fieldCompactValue> ?payload .
  VALUES ?code { "990" "907" "90H" "901" "991" }
}
LIMIT 25
```

## Regex tips

Need to match a specific code/value without the join overhead? You can stay on the entity level and use `REGEX` on the sanitised `subfieldCode` literal. Example: grab any subfield whose code starts with `5`:

```sparql
FILTER regex(?code, '^5')
```


## Querying with the Oxigraph CLI

```bash
uv run oxigraph query \
  --location data_curation/api/datasets/<dataset_id> \
  --query 'SELECT (COUNT(?m) AS ?count) WHERE { ?m a <https://vendange.bnf.fr/class/Manifestation> }' \
  --results-format tsv
```

`--results-format` accepts `tsv`, `json`, `xml`, `sparql`, etc.

Replace `<dataset_id>` with the identifier assigned when the CSV was uploaded (see `data_curation/api/datasets/datasets.json`).

## Notes & caveats

- Fields and subfields are blank nodes; their identifiers encode CSV order (e.g. `_:b123-f-0`). Use `ORDER BY STR(?field)` or `STR(?subfield)` when you need deterministic ordering.
- Only raw values are stored; use SPARQL functions for accent/ case-insensitive filters.
- `$3` relations expose both the linked entity (when resolvable) and the literal ARK.
- The default graph is empty; queries spanning all data should leave the graph parameter unspecified.
- Updating a record rewrites its named graph atomically—no need to re-upload the full CSV after an edit.
