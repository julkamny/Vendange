# Vendange — PostgreSQL + Ontop Virtual KG  
## Migration Plan & Software Requirements Specification (SRS/FSD)

**Version:** 2.0  
**Date:** 2025-12-15

---

## Document Owner
Engineering Lead / Architect

## Audience
SWE team (backend/data/frontend), DevOps/SRE, Product

## Scope
Migrate persistence to PostgreSQL and expose SPARQL via Ontop; remove Oxigraph + WorkspaceViewBuilder cache; keep Sparnatural.

## Key assumptions
- Multiple datasets concurrently  
- No named-graph `GRAPH` scoping  
- Strict dataset isolation enforced by backend

## Scale targets
- Dataset sizes: 4k–400k entities  
- ~20 concurrent users (mostly on different datasets)

## Status
Draft (for team review)

## Related artifacts
- Vendange codebase
- Ontop documentation  
- Sparnatural configuration  
- Sample CSV/JSON

---

## Table of contents

1. Executive summary  
2. Constraints and implications (updated)  
3. Target architecture (PostgreSQL + Ontop + FastAPI proxy)  
4. Multi-dataset concurrency model  
5. Data model options (JSONB-only vs hybrid)  
6. Functional specification & feature parity matrix  
7. Ontology/mapping strategy (no named graphs)  
8. API changes and query scoping  
9. Performance & indexing requirements  
10. Migration phases, deliverables, and acceptance criteria  
11. Testing & validation  
12. Operations, observability, and rollout  
13. Risks, mitigations, and open questions  
Appendices

---

## 1. Executive summary

We will migrate Vendange’s dataset storage and query stack to **PostgreSQL as the single source of truth**.  
SPARQL querying for the Sparnatural tab will be preserved by introducing an **Ontop Virtual Knowledge Graph (VKG)** endpoint that translates SPARQL `SELECT` queries into SQL executed by PostgreSQL.

The previous RDF quad store (**Oxigraph**) and the in-memory **WorkspaceViewBuilder** cache will be removed.

Because named-graph scoping (`GRAPH ?g`) is being dropped, the design must enforce **dataset isolation** through a mandatory dataset filter for all reads/writes and for all SPARQL queries proxied to Ontop.

---

## 2. Constraints and implications (updated)

- **Database:** PostgreSQL (single cluster)  
- **Concurrency:** up to ~20 users; different datasets may be edited/querying simultaneously  
- **Scale:** ~4k–400k entities per dataset; uneven type distributions  
- **No named graph semantics:** remove `GRAPH`-based scoping  
- **Schema preference:** minimize complexity; evaluate JSONB-only model

### Implication: dataset scoping becomes a security boundary

Without `GRAPH` scoping, a SPARQL query could otherwise match triples across all datasets exposed by Ontop.

Therefore:
- The backend **must inject or enforce a dataset constraint** for every SPARQL query.
- All Ontop mappings must expose a dataset identifier as either:
  - a property on every subject, or
  - a component of the subject IRI.

---

## 3. Target architecture  
### (PostgreSQL + Ontop + FastAPI proxy)

```

[Frontend (React)]

* Workspace / curation tabs
* Sparnatural tab (SPARQL SELECT)
  |
  v
  [FastAPI backend]
* SQL repository layer
* /api/datasets/{id}/query (SPARQL proxy + injection)
  |
  +--> [PostgreSQL]
  |
  +--> [Ontop SPARQL endpoint]
  - ontology + mappings
  - SPARQL -> SQL -> Postgres

````

### Ontop deployment
- **Recommended:** one shared Ontop instance
- Avoids N-per-dataset JVM processes
- FastAPI acts as a trusted proxy:
  - authentication
  - dataset filter injection
  - rate limiting
- Enable `/ontop/reformulate` in non-prod only

---

## 4. Multi-dataset concurrency model

Multiple datasets are supported concurrently via **PostgreSQL multi-tenancy**.

### 4.1 Multi-tenancy choices

| Option | Description | Pros | Cons |
|------|-------------|------|------|
| A — dataset_id column | Single schema; LIST partitioning | Simple Ontop mapping; pruning | Partition mgmt |
| B — schema-per-dataset | One schema per dataset | Strong isolation | Harder Ontop mapping |
| C — database-per-dataset | Separate DB per dataset | Maximum isolation | High ops overhead |

**Recommendation:** Option A (dataset_id + partitioning)

### 4.2 Locking strategy for curation operations

Use **dataset-scoped transactional advisory locks** to avoid conflicts:

```sql
SELECT pg_advisory_xact_lock(hashtext(dataset_id));
````

Allows parallel work across datasets while serializing edits within one dataset.

---

## 5. Data model options (JSONB-only vs hybrid)

### 5.1 JSONB-only model

* One row per entity
* Canonical Intermarc record stored as `jsonb`
* Queries use JSON functions / SQL/JSON paths

**Benefits**

* Lossless ingestion
* Flexible schema
* Simple updates via `jsonb_set`

**Risks at 400k entities**

* Heavy JSON extraction in Ontop-generated SQL
* Limited indexing opportunities
* Ontop treats complex JSON SQL as black-box views

---

### 5.2 Hybrid model (recommended)

Canonical JSONB + **relational projections** for query surface.

| Table               | Example content                               | Purpose                   |
| ------------------- | --------------------------------------------- | ------------------------- |
| `entity`            | dataset_id, entity_id, ark, type_norm, record | Source of truth           |
| `entity_label`      | dataset_id, entity_id, label                  | Fast lists / autocomplete |
| `rel_edge`          | dataset_id, src, predicate, tgt               | Graph joins               |
| `workspace_cluster` | anchor, members                               | Workspace views           |
| `fts`               | tsvector                                      | Full-text search          |

**Recommendation:** Hybrid model for 400k-scale performance.

---

### 5.3 Do we need field/subfield tables?

Not strictly required if:

* UI edits whole records or bounded sections
* SPARQL/query surface relies on extracted projections

Hybrid avoids field tables while retaining performance.

---

## 6. Functional specification & feature parity

### 6.1 Feature parity matrix

| Capability      | Target                    | Model  | Acceptance         |
| --------------- | ------------------------- | ------ | ------------------ |
| Dataset ingest  | Bulk insert + projections | Both   | Counts match       |
| Workspace lists | SQL + pagination          | Hybrid | No full scans      |
| Backlinks       | `rel_edge` lookup         | Hybrid | Indexed            |
| Curation ops    | Transactional SQL         | Both   | Atomic             |
| Sparnatural     | Ontop + proxy             | Both   | Equivalent results |
| Autocomplete    | FTS                       | Hybrid | p95 < 100 ms       |

---

## 7. Ontology & mapping strategy (no named graphs)

### 7.1 Objectives

* Preserve Sparnatural classes/properties
* No per-record named graphs
* Default graph only
* Dataset scoping mandatory

### 7.2 Dataset scoping pattern

**Two layers:**

1. Mapping: every entity has `vend:datasetId`
2. Proxy: backend injects dataset binding

```sparql
VALUES ?ds { "DATASET_123" }
?s vend:datasetId ?ds .
```

### 7.3 JSONB in mappings

* Prefer SQL/JSON functions
* Avoid `->` / `->>` operators
* Use SQL views or Ontop lenses for complex extraction

---

## 8. API changes and query scoping

### 8.1 SPARQL proxy rules

* `SELECT` only (reject UPDATE/INSERT/DELETE)
* Inject dataset constraint
* Apply per-query timeouts

---

## 9. Performance & indexing

### 9.1 Partitioning

* LIST partition by `dataset_id`
* Per-partition indexes

### 9.2 JSONB indexing

* GIN (`jsonb_path_ops`)
* Expression indexes on hot paths

### 9.3 Resource controls

* `statement_timeout`
* Connection pooling
* Rate limiting on SPARQL proxy

---

## 10. Migration phases

| Phase | Deliverable     | Exit criteria            |
| ----- | --------------- | ------------------------ |
| P0    | Baseline        | Golden datasets          |
| P1    | Postgres schema | 4k & 400k ingest OK      |
| P2    | Workspace SQL   | UI meets SLOs            |
| P3    | Ontop endpoint  | No cross-dataset leakage |
| P4    | Curation ops    | Property tests pass      |
| P5    | Cutover         | Oxigraph removed         |

---

## 11. Testing & validation

* **Correctness:** projection equivalence
* **Security:** dataset isolation tests
* **Performance:** SPARQL-heavy benchmarks
* **Concurrency:** ~20 users, no deadlocks

---

## 12. Operations & rollout

* Ontop container with readiness checks
* Metrics: DB time, Ontop time, rows returned
* Dataset-level feature flags
* Rollback path maintained

---

## 13. Risks & mitigations

| Risk                | Impact         | Mitigation         |
| ------------------- | -------------- | ------------------ |
| JSONB-only too slow | High latency   | Hybrid projections |
| SPARQL leakage      | Security issue | Injection + tests  |
| Large edits lock    | UX stalls      | Advisory locks     |
| Ontop black-box SQL | Regressions    | Simple views       |

---

## Appendix A — Schema sketch

```sql
CREATE TABLE entity (
  dataset_id text NOT NULL,
  entity_id  bigserial,
  ark        text,
  type_norm  text NOT NULL,
  record     jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (dataset_id, entity_id)
) PARTITION BY LIST (dataset_id);

CREATE TABLE rel_edge (
  dataset_id text NOT NULL,
  src_entity_id bigint NOT NULL,
  predicate_iri text NOT NULL,
  tgt_ark text,
  tgt_entity_id bigint,
  PRIMARY KEY (dataset_id, src_entity_id, predicate_iri, COALESCE(tgt_ark,''))
) PARTITION BY LIST (dataset_id);
```