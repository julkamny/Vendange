# Vendange SPARQL Store

The Vendange search backend now relies on an on-disk [Oxigraph](https://github.com/oxigraph/oxigraph/tree/main/python) store instead of SQLite. Every CSV upload that reaches `POST /api/upload` is materialised as RDF triples that can be queried with SPARQL.

## Store location & lifecycle

- The Oxigraph database lives in `data_curation/api/vendange_store/`. The directory is re-created on every CSV ingestion.
- All triples are written both to the default graph (so plain `SELECT` queries work out-of-the-box) and to a named graph `https://vendange.bnf.fr/graph/<record_id>` for each record. The per-record graph keeps updates cheap because `update_record` simply clears and rewrites that graph.
- The legacy `vendange.sqlite` file is pruned automatically as soon as the API boots.

## RDF vocabulary cheat sheet

All IRIs live under the `https://vendange.bnf.fr/` namespace:

| Concept | IRI pattern | Notes |
| --- | --- | --- |
| Entity | `https://vendange.bnf.fr/entity/<record_id>` | Record identifier straight from the CSV. |
| Record type | `https://vendange.bnf.fr/class/{Work\|Expression\|Manifestation}` | Assigned via `rdf:type`. |
| Raw field value | `https://vendange.bnf.fr/field/<zone>$<sub>` | e.g. `<…/field/245$a>` holds literal values (if present). |
| Normalised field value | `https://vendange.bnf.fr/field_norm/<zone>$<sub>` | Folded diacritics / lower-case via `normalize_for_match`. |
| Relation ($3) | `https://vendange.bnf.fr/relation/<zone>$3` | Object is either another record IRI (when available) or the ARK as a named node. |
| Relation target ARK | `https://vendange.bnf.fr/relation_ark/<zone>$3` | Always stores the literal ARK string for auditing. |
| Record metadata | `https://vendange.bnf.fr/property/…` | `record_id`, `type_raw`, `type_norm`, `ark`, `source_dataset`, etc. |
| Dataset metadata | `https://vendange.bnf.fr/entity/dataset` | `property:dataset_label` keeps the last dataset name. |

> ℹ️ Prefixes are not used because `$` and other characters in subfield codes are not legal in SPARQL qualified names. Always wrap the full IRI in `<…>`.

## Example queries

Count works:

```sparql
SELECT (COUNT(?work) AS ?count)
WHERE { ?work a <https://vendange.bnf.fr/class/Work> }
```

Manifestations mentioning “anémone” (accent insensitive thanks to `field_norm`):

```sparql
SELECT ?manifest ?label
WHERE {
  ?manifest <https://vendange.bnf.fr/field_norm/245$a> ?label .
  FILTER CONTAINS(?label, "anemone")
}
```

Traverse manifestation → expression → work while excluding works whose 150$a contains “adaptation”:

```sparql
SELECT ?manifest ?expression ?work ?title
WHERE {
  ?manifest <https://vendange.bnf.fr/relation/740$3> ?expression ;
             <https://vendange.bnf.fr/field/245$a> ?title .
  ?expression <https://vendange.bnf.fr/relation/750$3> ?work .
  FILTER NOT EXISTS {
    ?work <https://vendange.bnf.fr/field/150$a> ?workTitle .
    FILTER CONTAINS(LCASE(?workTitle), "adaptation")
  }
}
LIMIT 25
```

## Querying with the Oxigraph CLI

The CLI is available through `uv` (already configured). Example:

```bash
uv run oxigraph query \
  --location data_curation/api/vendange_store \
  --query 'SELECT (COUNT(?m) AS ?count) WHERE { ?m a <https://vendange.bnf.fr/class/Manifestation> }' \
  --results-format tsv
```

`--results-format` supports `tsv`, `json`, `xml`, `sparql`, etc.

## Notes & caveats

- `$3` relations always expose the literal ARK via `relation_ark/<zone>$3`, even when the linked record is not present in the dataset (no joinable IRI).
- `normalize_for_match` emits lowercased, accent-free strings. Use the `field_norm/…` predicates for “contains” searches that should ignore accents.
- `update_record` rewrites the affected record graph and default triples atomically; there is no need to re-upload the full CSV after an edit.
