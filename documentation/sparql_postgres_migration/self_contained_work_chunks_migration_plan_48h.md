Below is a **sequence of work chunks** that implements the SRS “Migration phases” (P0→P5) while keeping each chunk **self-contained** and **onboardable**. It assumes you’ll follow the SRS recommended **hybrid model** (JSONB canonical + projections) and **partition by dataset_id**.

---

## Chunk 01 (P0) — Golden datasets + query corpus capture

**Goal**: Produce the “baseline suite” the SRS requires: recorded SPARQL + REST results and basic timings on **4k + 400k** datasets.

**Minimal context**: Today, the app serves Workspace + SPARQL from Oxigraph; we’ll snapshot outputs now and compare later.

**Touchpoints**

* **Create** `tools/baseline/`:

  * `tools/baseline/corpus.yaml` (SPARQL queries + REST calls)
  * `tools/baseline/capture.py` (runs corpus against running API)
  * `tools/baseline/README.md` (how to run, where outputs live)
* **No edits** to app code (keep this low-risk).

**Implementation notes**

* Corpus should cover:

  * REST: `/workspace/works`, `/workspace/agents`, `/workspace/record/{id}`, `/workspace/backlinks/{id}`, `/autocomplete/entities` (these exist today). 
  * SPARQL: a small set of representative Sparnatural queries (copy/paste from browser devtools once, then freeze).
* Output format: `baselines/<dataset_id>/<run_id>/...` with:

  * response JSON
  * timing (wall clock)
  * request payloads used

**Exit checklist**

* ✅ `capture.py` runs end-to-end against a local backend
* ✅ Produces deterministic files (sorted JSON keys, stable ordering where possible)
* ✅ Captures *both* 4k and 400k runs

**Perfect engineer prompt**

```text
Implement baseline capture tooling per SRS P0:
- Create tools/baseline/{corpus.yaml,capture.py,README.md}
- corpus.yaml must cover key REST endpoints (workspace + backlinks + autocomplete) and a representative set of SPARQL SELECT queries used by Sparnatural.
- capture.py should:
  1) run the corpus against a running backend (base URL env var),
  2) write responses + timings into baselines/<dataset>/<run_id>/,
  3) normalize JSON (sorted keys, stable lists if possible).
Do not modify application behavior. Provide instructions to re-run.
```

---

## Chunk 02 (P1) — Postgres dev stack + connection plumbing

**Goal**: Add Postgres as a first-class dependency (local dev) and a thin DB access layer in Python.

**Touchpoints**

* **Create** `db/` (or `infra/`) with:

  * `docker-compose.postgres.yml` (postgres service only)
  * `.env.example` updates (`POSTGRES_DSN=...`)
* **Create** `api/pg/`:

  * `api/pg/pool.py` (connection pool)
  * `api/pg/session.py` (context manager + statement_timeout helper)
* **Edit** `api/app.py` only to add a `/health/db` endpoint (optional but helpful).

**Docs to browse**

* SRS §9.3 “Resource controls” (timeouts, pooling).

**Exit checklist**

* ✅ `docker compose -f docker-compose.postgres.yml up` starts Postgres
* ✅ Backend can open a connection and run `SELECT 1`
* ✅ DB timeout utility exists (even if not used yet)

**Execution status (2025-12-15)**: Implemented. New assets: `db/docker-compose.postgres.yml`, `data_curation/api/pg/{pool.py,session.py}`, `/api/health/db`, `.env.example` with `POSTGRES_DSN`.

**Perfect engineer prompt**

```text
Add Postgres local dev stack + Python DB plumbing:
- Add docker-compose.postgres.yml with a postgres service and persistent volume.
- Add api/pg/{pool.py,session.py} implementing a small connection pool and a context manager that can set per-request statement_timeout.
- Add env var POSTGRES_DSN (document in .env.example).
- (Optional) Add /health/db that checks SELECT 1.
No schema yet; just connectivity + minimal ergonomics.
```

---

## Chunk 03 (P1) — Schema v1: partitioned tables + dataset registry

**Goal**: Create the target schema (partitioned by `dataset_id`) + a **dataset registry table** (missing from the SRS phases but necessary because the code currently relies on file-based dataset state). The SRS mandates partitioning and the hybrid projections.

**Touchpoints**

* **Create** `db/schema.sql` (or `db/migrations/001_init.sql`) with:

  * `dataset` table (id, title, created_at, updated_at, etc.)
  * partitioned `entity` and `rel_edge` per SRS Appendix A 
  * add `entity_label`, `cluster`, `fts` per hybrid model description
* **Create** `api/pg/schema.py`:

  * `ensure_schema()`
  * `create_dataset_partitions(dataset_id)`
  * `drop_dataset_partitions(dataset_id)`

**Docs to browse**

* SRS Appendix A “Schema sketch (partitioned)” 
* SRS §9.1 Partitioning 

**Exit checklist**

* ✅ Running `ensure_schema()` creates all tables
* ✅ Creating a dataset partitions the 4 partitioned tables for that dataset
* ✅ Dropping a dataset removes partitions cleanly

**Execution status (2025-12-15)**: Implemented. Added `db/schema.sql`, `data_curation/api/pg/schema.py` with CLI (`ensure-schema`, `create-partitions`, `drop-partitions`).

**Perfect engineer prompt**

```text
Implement initial Postgres schema + partition mgmt:
- Add db/schema.sql (or migrations/001_init.sql) with:
  - dataset registry table (id TEXT PK, title, created_at, updated_at, etc.)
  - partitioned entity + rel_edge exactly like SRS Appendix A
  - add entity_label, cluster, fts tables (hybrid model) and necessary indexes.
- Add api/pg/schema.py with ensure_schema(), create_dataset_partitions(dataset_id), drop_dataset_partitions(dataset_id).
- Provide a simple CLI or script entrypoint to apply schema locally.
```

---

## Chunk 04 (P1) — Bulk ingest: CSV → entity(record JSONB)

**Goal**: Replace Oxigraph ingest path with Postgres ingest into `entity(record jsonb)`.

**Touchpoints**

* **Edit** `api/db_ingest.py` (keep parsing logic, replace storage backend)
* **Create** `api/pg/ingest.py` with:

  * `ingest_csv(dataset_id, csv_bytes) -> stats`
  * bulk insert using `COPY` or batched inserts
* **Edit** `api/datasets.py` ingest endpoint to call Postgres ingest

**Docs to browse**

* SRS §6.1 “Dataset ingest” acceptance criteria

**Exit checklist**

* ✅ 4k ingest finishes successfully
* ✅ Entity count matches source CSV
* ✅ Records round-trip (stored JSON matches parsed payload)

**Perfect engineer prompt**

```text
Port ingest to Postgres:
- Implement api/pg/ingest.py ingest_csv(dataset_id, csv_bytes) that parses CSV like the existing code but stores into entity(dataset_id, ark, type_norm, record jsonb).
- Use bulk insert (COPY preferred) and return ingestion stats.
- Wire dataset ingest endpoint to new Postgres ingest.
- Do not implement projections yet; just entity rows.
Add a tiny verification script: count rows and sample 5 records.
```

---

## Chunk 05 (P1) — Projections on write: entity_label + rel_edge + cluster + fts

**Goal**: Implement the hybrid projections required for workspace performance, backlinks, and SPARQL joins.

**Touchpoints**

* **Create** `api/pg/projections.py`:

  * `compute_label(entity_record) -> (label, sort_key)`
  * `extract_edges(entity_record) -> list[rel_edge rows]`
  * `extract_cluster_memberships(entity_record) -> list[cluster rows]`
  * `compute_fts(entity_record,label) -> tsvector input`
* **Edit** `api/pg/ingest.py` to populate projections after inserting entities
* **Optional**: DB triggers; but simplest is **application-managed** projections first.

**Docs to browse**

* SRS §5.2 hybrid model table purposes

**Exit checklist**

* ✅ `entity_label` populated for all rows
* ✅ `rel_edge` populated (at least for `$3` ARK relationships)
* ✅ `cluster` populated for 90F clusters (work/expression/agent)
* ✅ `fts` populated and queryable

**Perfect engineer prompt**

```text
Implement hybrid projections and wire them into ingest:
- Add api/pg/projections.py implementing:
  - entity_label (label + sort_key) using existing label extraction utilities where possible,
  - rel_edge extraction for $3/$0 ARK references (predicate_iri must match existing relation IRI conventions),
  - cluster extraction based on 90F$3 (+ note/q rules already used in code),
  - fts generation suitable for autocomplete.
- Update ingest_csv to fill these tables after inserting entity rows (truncate+rebuild per dataset is fine).
- Provide a smoke test: ingest 4k then query counts in each projection table.
```

---

## Chunk 06 (P1) — Dataset CRUD: move off file state, manage partitions

**Goal**: Replace file-backed dataset registry with Postgres `dataset` table + partition management.

**Why this chunk exists** (not explicit in migration phases): current endpoints rely on dataset metadata and timestamps (and autocomplete passes `meta.updated_at`). Today that’s tied to file/directory state.

**Touchpoints**

* **Edit** `api/datasets.py`:

  * list/create/delete datasets now backed by SQL
* **Delete (later in P5)**: file-based dataset state (don’t delete yet unless you fully cut over here)
* **Create** `api/pg/datasets_repo.py`

**Exit checklist**

* ✅ Creating dataset inserts row + creates partitions
* ✅ Deleting dataset drops partitions + dataset row
* ✅ `updated_at` is updated on ingest + curation writes

**Perfect engineer prompt**

```text
Migrate dataset registry + partition management into Postgres:
- Implement api/pg/datasets_repo.py with create/list/get/delete and partition creation/drop calls.
- Update api/datasets.py to use the repo instead of file-backed metadata.
- Ensure updated_at changes when ingest runs.
Keep API responses unchanged if possible.
```

---

## Chunk 07 (P2) — SQL Workspace: list works/agents (no WorkspaceViewBuilder)

**Goal**: Replace `WorkspaceViewBuilder`-based list endpoints with SQL queries (pagination + ordering). The code currently routes `/workspace/works` and `/workspace/agents` through `_get_workspace_builder()` and the in-memory builder.

**Touchpoints**

* **Create** `api/pg/workspace_repo.py`:

  * `list_works(dataset_id, limit, offset, order_by)`
  * `list_agents(...)`
* **Edit** `api/app.py`:

  * swap implementations of `/workspace/works` and `/workspace/agents` to call SQL repo
* **Delete** `api/cluster_views.py` only once all its callers are removed (start by bypassing it, don’t rip yet).

**Exit checklist**

* ✅ Workspace Works tab loads and renders
* ✅ No full entity scan / no in-memory “all entities” cache path
* ✅ p95 improves vs Oxigraph builder on 400k (rough check OK)

**Perfect engineer prompt**

```text
Replace WorkspaceViewBuilder for list endpoints:
- Implement api/pg/workspace_repo.py with SQL queries returning exactly the response models used by /workspace/works and /workspace/agents today.
- Use entity_label + cluster + type_norm to avoid JSON scans.
- Update api/app.py endpoints to call the SQL repo (keep response schemas identical).
Do not optimize everything; focus on correctness + no in-memory full dataset load.
```

---

## Chunk 08 (P2) — SQL Workspace: record payload + backlinks

**Goal**: Rebuild `/workspace/record/{key}` and `/workspace/backlinks/{key}` using SQL (`entity` + `rel_edge` reverse lookup). Today they go through the builder.

**Touchpoints**

* **Edit** `api/backlinks.py` (or replace internals)
* **Edit** `api/app.py` endpoints:

  * `/workspace/record/{record_key}`
  * `/workspace/backlinks/{record_key}`
* **Extend** `api/pg/workspace_repo.py` with:

  * `get_entity_by_key(dataset_id, key)` (id or ark)
  * `get_backlinks(dataset_id, target_entity_id)`

**Exit checklist**

* ✅ Record view works for both ID and ARK keys
* ✅ Backlinks list matches baseline (Chunk 01 outputs)

**Perfect engineer prompt**

```text
Implement SQL-backed record + backlinks endpoints:
- Add get_entity_by_key() that accepts either internal id or ARK string, returning entity(record jsonb) + label/type.
- Implement backlinks via rel_edge reverse lookup (target_entity_id or tgt_ark).
- Wire /workspace/record/* and /workspace/backlinks/* in api/app.py to these SQL paths.
Validate against P0 baseline snapshots for a handful of keys.
```

---

## Chunk 09 (P2) — SQL autocomplete/entities (remove dependency on builder.entities)

**Goal**: Replace autocomplete which currently receives `builder.entities` (full in-memory set). This must disappear once WorkspaceViewBuilder is removed.

**Touchpoints**

* **Edit** `api/autocomplete.py`
* **Edit** `api/app.py` `/autocomplete/entities` endpoint
* **Create** `api/pg/autocomplete_repo.py`

**Exit checklist**

* ✅ Autocomplete returns suggestions with same JSON shape
* ✅ No in-memory full dataset required
* ✅ Uses `fts` and/or `entity_label` for speed

**Perfect engineer prompt**

```text
Port autocomplete/entities to SQL:
- Remove dependence on builder.entities in the endpoint.
- Implement api/pg/autocomplete_repo.py that searches entity_label/fts and returns the same AutocompleteSuggestion shape.
- Keep autocomplete_rules.json semantics intact where possible (zone/subfield filtering).
- Validate by running the same autocomplete requests captured in the P0 corpus.
```

---

## Chunk 10 (P2) — Delete WorkspaceViewBuilder + Oxigraph read paths (workspace only)

**Goal**: Once workspace + autocomplete endpoints are SQL-backed, remove the cache and builder usage paths.

**Touchpoints**

* **Edit** `api/app.py` to remove `_get_workspace_builder` and associated cache. 
* **Delete** `api/cluster_views.py` (if no longer referenced)
* **Delete** any workspace-only helper functions in `api/db_query.py` / `api/db_store.py` that became unused (don’t delete curation ones yet)

**Exit checklist**

* ✅ Workspace tab works end-to-end
* ✅ No imports of `WorkspaceViewBuilder` remain
* ✅ Memory footprint drops (qualitative check)

**Perfect engineer prompt**

```text
Remove WorkspaceViewBuilder and its cache:
- Delete/bypass WorkspaceViewBuilder usage in api/app.py (remove _get_workspace_builder and any caching).
- Remove api/cluster_views.py if unused; clean imports.
- Ensure workspace + autocomplete endpoints still work and tests/baseline comparisons still pass.
Do not touch curation/SPARQL yet unless it’s clearly dead code.
```

---

## Chunk 11 (P3) — Add Ontop container + “ping” readiness

**Goal**: Bring up Ontop locally alongside Postgres, with a minimal readiness query as per ops section.

**Touchpoints**

* **Create** `ontop/`:

  * `ontop.properties` (JDBC + mapping/ontology locations)
  * placeholder `mapping.obda`, `ontology.ttl`
* **Create/Edit** `docker-compose.ontop.yml` (Ontop service)
* **Edit** backend config `.env.example` for `ONTOP_ENDPOINT_URL`

**Docs to browse**

* Ontop docs: mapping templates + lenses basics (for later)

**Exit checklist**

* ✅ Ontop starts, endpoint reachable
* ✅ “Ping” SPARQL query works (even if returns empty)

**Perfect engineer prompt**

```text
Add Ontop to local stack:
- Create ontop/ with ontop.properties + stub ontology/mapping files.
- Add docker-compose.ontop.yml to run Ontop connected to Postgres.
- Provide a README command to run a simple SELECT ping query against Ontop.
No real mappings yet; focus on repeatable boot + readiness.
```

---

## Chunk 12 (P3) — Postgres views for Ontop: flatten Intermarc JSON into stable columns

**Goal**: Create **SQL views** that expose record→field→subfield rows, because Ontop mappings should avoid JSON arrow operators and prefer stable columns via SQL/views.

**Touchpoints**

* **Edit/Create** `db/views.sql`:

  * `v_field(dataset_id, entity_id, field_idx, tag, compact_value, ...)`
  * `v_subfield(dataset_id, entity_id, field_idx, sub_idx, code, value, ...)`
* **Ensure** views rely on Postgres JSONB functions / jsonpath, not `->`/`->>`.

**Docs to browse**

* SRS §7.3 JSONB in mappings (views recommended)

**Exit checklist**

* ✅ Views compile and return rows for a sample dataset
* ✅ Basic sanity query: count fields/subfields per entity is reasonable

**Perfect engineer prompt**

```text
Build SQL views to support Ontop mappings:
- Add db/views.sql defining v_field and v_subfield that flatten the entity.record jsonb into stable relational rows.
- Use jsonb functions / SQL/JSON path; avoid -> and ->>.
- Include ordinality columns (field_idx/sub_idx) for stable IRI templates later.
- Provide 2-3 example SQL queries demonstrating the views work on a real dataset.
```

---

## Chunk 13 (P3) — Ontop mapping v1: classes, datasetId scoping, labels, edges

**Goal**: Implement Ontop mappings for:

* entity class/type
* `vend:datasetId` exposure
* labels/titles used by Sparnatural shapes
* relation edges from `rel_edge`

This follows the SRS “no named graphs” + dataset scoping pattern.

**Touchpoints**

* **Edit** `ontop/ontology.ttl` (or `.owl`) to define required classes/properties
* **Edit** `ontop/mapping.obda` to map:

  * entity IRIs (include dataset in IRI template or provide datasetId property)
  * label/title properties
  * rel_edge predicate IRIs

**Docs to browse**

* SRS §7.1–7.2 mapping objectives + scoping pattern
* Ontop mapping rules re: IRI templates + typing 

**Exit checklist**

* ✅ Query against Ontop: list 10 works + labels
* ✅ Query: traverse a relation edge using `rel_edge`
* ✅ Every returned entity has `vend:datasetId`

**Perfect engineer prompt**

```text
Implement Ontop mapping v1:
- Update ontop/ontology.ttl and ontop/mapping.obda to expose:
  1) core entity IRIs + rdf:type from entity.type_norm,
  2) vend:datasetId as mandatory property on every entity,
  3) labels/titles used by Sparnatural,
  4) edges from rel_edge with predicate_iri preserved as the RDF predicate.
- Ensure no named graph usage.
- Provide 3 SPARQL SELECT examples in ontop/README.md that demonstrate correctness.
```

---

## Chunk 14 (P3) — FastAPI SPARQL proxy: SELECT-only + dataset filter injection + timeouts

**Goal**: Replace Oxigraph query endpoint with proxy to Ontop, enforcing:

* SELECT-only
* dataset isolation via injected constraint
* statement timeouts

This is explicitly required by SRS §8.1.

**Touchpoints**

* **Edit** `api/db_query.py` (or replace with `api/ontop_proxy.py`)
* **Edit** `api/app.py` endpoint `/api/datasets/{dataset_id}/query`
* **Create** `api/ontop/`:

  * `client.py` (HTTP client)
  * `inject.py` (dataset injection logic + tests)

**Exit checklist**

* ✅ Existing frontend SPARQL tab works (even if slow initially)
* ✅ UPDATE/INSERT/DELETE rejected
* ✅ Negative test: query cannot “see” another dataset

**Perfect engineer prompt**

```text
Implement Ontop SPARQL proxy endpoint:
- Replace /api/datasets/{dataset_id}/query implementation to forward to Ontop over HTTP.
- Enforce SELECT-only (reject UPDATE/INSERT/DELETE).
- Inject dataset scoping constraint (vend:datasetId) for every query and set a per-request timeout.
- Add unit tests: (1) injection correctness on representative queries, (2) negative isolation test with two datasets.
Do not change frontend contracts.
```

---

## Chunk 15 (P3) — Frontend: remove GRAPH wrapping, rely on backend scoping

**Goal**: The SRS forbids named-graph semantics (“No per-record named graph generation”). Frontend currently rewrites queries to add GRAPH scoping. Remove it.

**Touchpoints**

* **Edit** `queryUtils.ts` (remove `ensureGraphWrapping` behavior)
* **Edit** `sparnaturalRewrite.ts` (remove graph-scoping rewrite paths)
* **Edit** `SparnaturalBuilder.tsx` (if it calls graph wrapper)

**Exit checklist**

* ✅ Sparnatural tab still produces valid SPARQL
* ✅ Backend scoping works (no leakage)
* ✅ No `GRAPH {}` emitted by frontend

**Perfect engineer prompt**

```text
Remove named-graph scoping from the frontend:
- Update queryUtils.ts and sparnaturalRewrite.ts so they no longer wrap queries with GRAPH blocks.
- Keep other Sparnatural rewrites that are still needed (field/subfield shortcuts etc.).
- Verify in the browser that generated SPARQL contains no GRAPH keyword.
- Run P0 corpus SPARQL queries through the new path and confirm results still come back.
```

---

## Chunk 16 (P4) — Advisory locks + transactional write primitive

**Goal**: Implement the dataset-scoped advisory lock + a single safe “write entity + recompute projections” primitive to reuse across all curation operations.

**Touchpoints**

* **Create** `api/pg/curation_tx.py`:

  * `with_dataset_lock(dataset_id)` using `pg_advisory_xact_lock(hash(dataset_id))`
  * `update_entity_record(...)` (UPSERT entity + refresh projections for that entity)
* **Edit** curation endpoints later to use this.

**Exit checklist**

* ✅ A demo endpoint can update one record transactionally
* ✅ Projections for that entity are updated consistently
* ✅ Lock blocks concurrent writes to same dataset, not others

**Perfect engineer prompt**

```text
Implement transactional infra for curation ops:
- Add api/pg/curation_tx.py with:
  - dataset-scoped pg_advisory_xact_lock at transaction start,
  - update_entity_record() that updates entity.record and recomputes projections (label/edges/cluster/fts) for that entity atomically.
- Provide a small smoke test function that updates a record and checks projections changed in the same transaction.
```

---

## Chunk 17 (P4) — Port update_record (JSON merge + flags) to Postgres

**Goal**: Replace Oxigraph-based record update with SQL update of `entity.record` + projection refresh. Today `record_update.py` clears graphs and re-inserts quads into Oxigraph.

**Touchpoints**

* **Edit** `api/record_update.py`:

  * replace store calls with `api/pg/curation_tx.py` write primitive
* **Remove usage** of `clear_record_graph`, `get_store_locked` from update path

**Exit checklist**

* ✅ Update endpoint works from UI
* ✅ Curation flags merging behavior preserved
* ✅ Baseline comparisons: record payload matches expected after update

**Perfect engineer prompt**

```text
Port record_update to Postgres:
- Modify api/record_update.py so it loads the entity from Postgres, applies the same merge/flag logic, then writes back using update_entity_record() (transaction + dataset lock).
- Remove Oxigraph graph clearing/inserting from this path.
- Ensure projections refresh correctly (backlinks, clusters, labels).
Add 2-3 unit tests around the zone/subfield flag merge behavior.
```

---

## Chunk 18 (P4) — Port manual_cluster + uniqueness guards to SQL

**Goal**: Implement manual clustering using Postgres, including the “unique cluster” safety checks currently enforced via Oxigraph queries.

**Touchpoints**

* **Edit** `api/manual_cluster.py`
* **Edit** `api/db_guards.py`:

  * replace SPARQL/Oxigraph guards with SQL guards on `cluster` + `rel_edge`
* **Use** `api/pg/curation_tx.py`

**Exit checklist**

* ✅ Manual cluster operations succeed and update `cluster` projection
* ✅ Uniqueness constraints enforced (works/expressions/agents)
* ✅ No Oxigraph access from this path

**Perfect engineer prompt**

```text
Port manual clustering + guards to SQL:
- Update api/manual_cluster.py to operate on Postgres entity JSON and write through update_entity_record().
- Rewrite db_guards uniqueness checks to use SQL over cluster/rel_edge tables (no SPARQL/Oxigraph).
- Ensure the same guard semantics as today (unique cluster membership, expression/work constraints, etc.).
Add tests: attempting to create a duplicate/invalid cluster must fail.
```

---

## Chunk 19 (P4) — Port anchor_swap + originality_swap

**Goal**: Move remaining “swap” operations off Oxigraph: these touch many records and must be transactional + locked.

**Touchpoints**

* **Edit** `api/anchor_swap.py`, `api/originality_swap.py`
* **Replace** usage of:

  * `_record_subjects`, `_load_record_from_store`, `clear_record_graph`, `store.extend(...)`
* **Use** SQL bulk updates inside a dataset lock

**Exit checklist**

* ✅ Swaps complete without partial updates
* ✅ Projections stay consistent (clusters/backlinks/labels)

**Perfect engineer prompt**

```text
Port anchor_swap and originality_swap to Postgres:
- Replace all Oxigraph store reads/writes with Postgres entity JSON reads and transactional writes.
- Use dataset advisory lock + a single transaction per operation.
- Make updates efficient: batch-select affected entity_ids, update records, refresh projections per updated entity (batch refresh is OK).
- Add tests ensuring atomicity: failures mid-way do not leave partial state.
```

---

## Chunk 20 (P4) — Port manifestation_uproot

**Goal**: Move manifestation uproot logic to SQL writes. (Same pattern: load affected entities, rewrite links, write back, refresh projections.)

**Touchpoints**

* **Edit** `api/manifestation_uproot.py`
* **Delete dependency** on Oxigraph store functions in this module

**Exit checklist**

* ✅ Operation works from UI
* ✅ Backlinks and rel_edge updated accordingly

**Perfect engineer prompt**

```text
Port manifestation_uproot to Postgres:
- Replace Oxigraph reads/writes with Postgres entity JSON operations.
- Ensure rel_edge/backlinks remain correct by refreshing projections for all affected entities.
- Add at least one integration test: uproot changes links as expected and backlinks reflect it.
```

---

## Chunk 21 (P4) — Port clustering pipeline + NameExpansionService integration (no “load all entities” dict)

**Goal**: Run clustering at 400k without holding everything in memory, and without relying on Oxigraph lookups for controlled ARKs. The clustering code currently builds `ark_index` and calls `get_store_locked()` for controlled lookups.

**Touchpoints**

* **Edit** `curation/pipeline.py`, `curation/operations.py`
* **Edit** `authority/nes_service.py`:

  * allow a callback `get_entity_by_ark(ark) -> Entity | None` instead of a full dict
* **Create** `api/pg/controlled_repo.py`:

  * `get_controlled_ark_by_label(dataset_id, label)` (replaces store-based lookup)

**Exit checklist**

* ✅ Clustering runs against Postgres dataset
* ✅ Controlled ARK lookups no longer depend on Oxigraph
* ✅ Name expansion still works using on-demand entity fetch

**Perfect engineer prompt**

```text
Port clustering pipeline to Postgres and remove full in-memory ark_index:
- Update curation/pipeline.py to read entities from Postgres (streaming/batched is fine) and write cluster results via update_entity_record().
- Replace get_store_locked/get_controlled_ark usage with a Postgres-backed controlled lookup (exact label -> ark).
- Refactor NameExpansionService to accept an on-demand local entity fetch function instead of local_entities_by_ark dict.
- Add a smoke test: run clustering on 4k and confirm clusters/projections updated.
```

---

## Chunk 22 (P4) — Property-based + concurrency tests for curation ops

**Goal**: Meet P4 exit criteria: “All curation operations pass property-based tests” and validate dataset locking/deadlock safety.

**Touchpoints**

* **Create** `tests/curation/`:

  * hypothesis-style tests (or randomized generators if you avoid Hypothesis)
  * concurrency test harness (e.g., threads hitting two datasets)
* **Add** CI commands (if present) or a documented local runner

**Exit checklist**

* ✅ Randomized sequences preserve invariants (no duplicate clusters, etc.)
* ✅ Concurrent ops on different datasets proceed; same dataset serializes

**Perfect engineer prompt**

```text
Add property-based + concurrency tests for Postgres curation:
- Add tests that generate small synthetic entities/records and run random sequences of curation ops.
- Assert invariants: unique cluster membership, backlinks consistency, record JSON validity, and no cross-dataset writes.
- Add a concurrency test that runs operations in parallel across 2 datasets and confirms no deadlocks + acceptable completion.
Document how to run locally.
```

---

## Chunk 23 (P5) — Cutover cleanup: remove Oxigraph + dead modules

**Goal**: Remove Oxigraph completely and delete abandoned code paths, per SRS P5.

**Touchpoints**

* **Delete** (if unused after previous chunks):

  * `api/db_store.py`, `api/db_query.py` (Oxigraph parts), Oxigraph utilities
* **Edit** modules importing these (anchor_swap, record_update, etc. already migrated)
* **Update** docs/dev scripts to only require Postgres + Ontop

**Exit checklist**

* ✅ No `pyoxigraph` dependency
* ✅ No dataset directory used for storage (only logs if you keep them)
* ✅ All baseline corpus tests pass against Postgres+Ontop

**Perfect engineer prompt**

```text
Perform P5 cleanup (remove Oxigraph):
- Remove all Oxigraph store/query modules and imports (db_store/db_query and any pyoxigraph usage).
- Ensure every endpoint now uses Postgres repositories and Ontop proxy.
- Delete dead code and update docs/scripts accordingly.
Run the baseline corpus from P0 and ensure outputs match within expected tolerances.
```

---

## Chunk 24 (P5) — Ops polish: timeouts, metrics hooks, reformulate dev workflow

**Goal**: Finish what the SRS calls out for operations: readiness checks, timeouts, and a dev workflow for Ontop reformulation debugging.

**Touchpoints**

* **Edit** `api/app.py`:

  * add timing logs for DB + Ontop proxy
* **Edit** Ontop compose:

  * enable / document `/ontop/reformulate` in dev only (as SRS notes)
* **Add** a short `docs/ontop-debug.md`

**Exit checklist**

* ✅ Slow queries get timeouts instead of hanging
* ✅ Logs show “DB time / Ontop time”
* ✅ Developers can debug a SPARQL→SQL translation quickly

**Perfect engineer prompt**

```text
Operational polish for Postgres+Ontop:
- Add per-request statement_timeout for DB work and for Ontop proxy calls.
- Add structured logging for query durations (db_ms, ontop_ms, rows).
- Document a dev-only Ontop reformulate workflow (how to take a SPARQL query and inspect SQL).
Keep it lightweight; no production rollout features needed.
```

---

### Notes on “necessary extra chunks” I added (not explicit in the phase table)

* **Dataset registry migration (Chunk 06)**: required because current endpoints depend on dataset metadata + updated timestamps and today that’s file-backed.
* **SQL autocomplete (Chunk 09)**: current implementation depends on `builder.entities` (in-memory), which must disappear with WorkspaceViewBuilder removal. 
* **NameExpansionService refactor (Chunk 21)**: clustering currently builds a full `ark_index` and uses Oxigraph lookups; that won’t scale cleanly at 400k without refactoring.

If you want, I can also rewrite these chunks into a **ticket template format** (Jira/GitHub Issues) with “Definition of Done” and checklists per ticket—but the content above is already structured to be pasted as assignment prompts.
