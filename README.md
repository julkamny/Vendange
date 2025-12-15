# Vendange
---

_Vérification Experte, Nettoyage et Dédoublonnage des Arbres NOEMI par Grappage Enchâssé_

### Disclaimer
While the ideas behind Vendange's clustering operations and its UI are the result of human reflexion, the code was produced by gpt-5-codex in codex cli.

### Overview
- Python CLI to run modular data-curation operations directly against the Postgres-backed corpus (SPARQL served via Ontop).
- Web UI to review, approve/reject/alter merges and export a curated dataset.
- Workspace endpoints are Postgres-backed (SQL lists/records/backlinks/autocomplete); the former in-memory `WorkspaceViewBuilder` cache has been removed.
- Curation operations (update record, manual clustering, anchor/originality swap, manifestation uproot) now write directly to Postgres under dataset-scoped advisory locks; Oxigraph has been removed from the backend stack.

### Getting Started

#### Data sources
- The starting point of our project is a database containing the **French National Library's catalog** in Intermarc Nouvelle Génération (NG), a format that's compatible with IFLA LRM and implements the RDA-FR cataloguing code. Information about the purpose of the migration can be found [here](https://www.rdatoolkit.org/sites/default/files/rsc/BNF_intermarc_Foucher.pdf). This format belongs to the broad family of MARC (*Machine-Readable Cataloging Record*) formats, about which please see this page of the [Library of Congress](https://www.loc.gov/marc/umb/um01to06.html).
  - Cataloging guidelines for Intermarc NG can be found on [Kitcat NG](https://kitcatng-ext.bnf.fr/consignes-catalogage), the BNF's cataloging reference guide for the new format, but the description of Intermarc NG fields is not publicly available yet. Meanwhile, one can rely on [Kitcat](https://kitcat.bnf.fr/manuel-intermarc), the previous reference guide, which contains a detailed description of fields in Intermarc.
- We accessed the database through the current version of NOEMI, an internal website of the National Library that allows its teams to access, modify and augment the catalog. NOEMI is still in a pre-release phase during which migration tests are regularly conducted, from Intermarc to Intermarc NG. It is populated by a temporary version of the database after a mock migration.
- The repository includes `sample_data/current_export.csv`, a **small sample taken from this temporary snapshot**.
  - It comprises all works whose agent (relator fields 700, 701 or 702 for people, 710, 711, or 712 for groups) is the Comtesse de Ségur (technically the ark identifier of her record : ark:/12148/cb130916590), the expressions pointing to those works, and the manifestations pointing to those manifestations.
  - In the SQL query, we also had to retrieve all entities (agents, works, expressions, manifestations, *valeur contrôlée*, *brand*) whose ark identifier appears in any field of the initial matches, to be able to display the record of those initial matches with all values in human-readable format, as at, the time of writing, there is no API access to the new catalog.
  - The list of initial works and the SQL query can be found in folder [sql](documentation/sql_NOEMI).

#### Understanding links between entities
- In addition to the Kitcat pages mentioned above, please see the rough-hewn and schematic "Linked entity ontology" in [AGENTS.md](AGENTS.md)

#### Data curation
- Operation implemented: clustering works and expressions, creating adaptation links between original works and adaptations.
- For each clustered work (besides the anchor), the anchor gets a new `90F` zone with:
  - `90F$a` = ARK of the clustered work (from `001$a`)
  - `90F$q` = `Clusterisation script`
  - `90F$d` = today (YYYY-MM-DD)
- Manual vs script clustering notes are handled uniformly (`90F$q` / `90Fsq` = “Clusterisation manuelle” or “Clusterisation script”); protection of anchors relies on `affectedByCuration` being `manual` or `created` on the 90F field or its `90Fsq` subfield.
- Adaptation links:
  1. The original work gets a `552$q` subfield with the ARK identifier of the controled value with `169$a` "A pour adaptation" and a `552$3` subfield pointing to the ARK identifier of the adaptation.
  2. The adaptation gets a `552$q` with the ARK identifier of the controled value with `169$a` "Est une adaptation de" and a `552$3` subfield pointing to the ARK identifier of the original work.
- Manual anchor swap: `POST /api/datasets/<dataset_id>/swap_anchor` moves all curated `90F` fields (script or manual) from the current anchor to a clustered work/expression and retargets them as manual links. For works, curated `552$q = "A pour adaptation"` links move as well and the corresponding `"Est une adaptation de"` backlinks are rewritten to the new anchor.
- Originality swap: `POST /api/datasets/<dataset_id>/swap_originality` retargets curated `552$q = "A pour adaptation"` links from a former original to a new one, rewrites the reciprocal `"Est une adaptation de"` backlinks on every adaptation, deletes the curated 552 fields from the former original, and recreates them as manual links on the new original.
- Manual clustering: `POST /api/datasets/<dataset_id>/manual_cluster` toggles a work/expression membership under an anchor (payload: `anchorId`, optional `targetId`, `targetArk`, `accepted`) and returns `updatedRecords`, `updatedClusters`, `removedClusterIds`, and `updatedWorkRows` for cache patching.
- Record edits: `POST /api/datasets/<dataset_id>/update_record` patches the in-memory `WorkspaceViewBuilder` (same shape as swap_originality) instead of flushing the cache; it rejects 750 additions/removals, blocks 740 removals, and reuses the manifestation uprooting flow when adding 740 links. Added/edited fields are stamped `affectedByCuration="manual"` and curated 552 links stay reciprocal (`A pour adaptation` ↔ `Est une adaptation de`). Controlled value lookup for partial uprooting is resolved server-side via `get_controlled_ark`, falling back to a readable placeholder if absent.

#### Workspace & clustering API
- `GET /api/datasets/{dataset_id}/workspace/works` returns work clusters plus pre-computed badges (counts, 5XX relationships, media kinds) and the sorted list of unclustered works as lightweight view models.
- `GET /api/datasets/{dataset_id}/workspace/work/{anchor_id_or_ark}` resolves a single work cluster for focus-down views (expressions + manifestations included). The path parameter accepts full ARKs with slashes and colons, whether raw or URL-encoded, and it resolves clusters when you pass the ARK/ID of a clustered member or even an unclustered standalone work.
- `GET /api/datasets/{dataset_id}/workspace/agents` returns all agents through the AgentViewBuilder: anchors whose 90F$q is either “Clusterisation script” or “Clusterisation manuelle”, their clustered targets (90F$3), and the remaining unclustered agents.
- Cluster-affecting mutations (`swap_anchor`, `swap_originality`) also return `updatedClusters`, `removedClusterIds`, and `updatedWorkRows` so the UI can patch caches without recomputing. {++Currently, the client-side cache is never cached: clean-up after permutations flushes it and the updated server-side cached WorkspaceViewBuilder instance is fetched.++}
- Workspace endpoints reuse an in-memory `WorkspaceViewBuilder` cache keyed per dataset; anchor/originality swaps patch the cached builder in place so follow-up requests avoid a full rebuild.
- The React workspace consumes these DTO endpoints end-to-end (lists, expression/manifestation panels, agent view) and doesn't depend on client-side clustering.
- `GET /api/datasets/{dataset_id}/workspace/record/{record_key}` returns a single record (id or ARK, with slashes/colons allowed, raw or URL-encoded) for just-in-time Intermarc loading, including an `ark_labels` map (ARK → label) so the UI can render tooltips without extra lookups. Expression ARKs are resolved from their 140 field: the parent work label (150 with agent $3 resolved) followed by the modifier subfields in order.
- `GET /api/datasets/{dataset_id}/workspace/backlinks/{record_key}` computes backlinks on demand for any work, expression, manifestation, or agent, returning source entities plus the Intermarc fields where they point to the requested ARK.
- `POST /api/datasets/{dataset_id}/autocomplete/entities` serves CodeMirror autocomplete with server-side routing rules: send the current field/subfield + prefix, get back compact `{ark,label,type}` suggestions already filtered by allowed kinds and controlled lists. Responses are react-query cached in the editor; the old client-side routing tables have been removed.

#### Running data curation operations
- To launch the FastAPI server in `data_curation/api`: `uv run fastapi dev data_curation/api/app.py`. See below for explanations.
- Clustering workflows refresh Postgres projections after updates so labels/backlinks stay consistent.
- The React UI opens on a dashboard that lets you upload CSV snapshots, launch clustering (with or without expression propagation) while streaming script logs, jump into the inspection workspace, or delete a dataset. Every upload is stored in Postgres partitions keyed by dataset_id.

### Testing backend guardrails
- End-to-end guards between the React UI and FastAPI are covered in `data_curation/tests/test_cluster_guards.py`. Run them with `uv run pytest data_curation/tests/test_cluster_guards.py`.
- The tests ingest fixture CSVs into Postgres partitions keyed by dataset_id (work/expression/manifestation fixtures with 150/140/245/750/740 fields) and intentionally leave datasets registered for inspection after a run.
- Routing now uses TanStack Router. Deep-linking to `http://localhost:5173/<dataset_slug>` loads the dataset via the route loader (with a friendly error screen when the slug is invalid) and back/forward navigation keeps the dashboard/inspection views in sync.

### Debug & Fixtures
- **Styled debug logs** — use `-vv` to unlock Rich-powered logs: the CLI renders colourful panels, syntax-highlighted titles, and tables for matched variants and removed segments.

### Review in the Web UI
- Pristine snapshots are captured per record only when you edit it, keeping load time and memory footprint low while still allowing per-record reset.
- Three tab kinds are available from the “+” dropdown: WEM workspace, Agents workspace (people/collectives/families), and SPARQL query tabs; the dropdown supports keyboard navigation (Enter/Space to open, arrows to move, Escape to close) and closes reliably on outside clicks.
- The UI detects clusters by scanning for `90F$q = "Clusterisation script"` in works.
- Key information about entities is displayed in badges:
  - Expression counters (orange) only appear when at least one manifestation points to the entity.
  - Manifestation counters (green) only render when a work has incoming manifestations.
  - Expressions display a red *750 links* badge whenever more than one work points to them; manifestations expose an orange *740 links* badge when multiple expressions reference them.
  - Relationship badges show outgoing and incoming 5XX links as `outgoing|incoming`, and are hidden when both values are zero.
  - Agent badges disappear for entities without 7XX contributors.
- Central panel: list of anchors with merged works (checkbox to accept/reject).
- Works and agents lists are virtualized with `react-virtuoso`, so thousands of rows stay smooth while side panels keep their own scroll.
- When a SPARQL filter is active, the banner now offers *Next/Previous* buttons (and shortcuts `Ctrl+Alt+↓` / `Ctrl+Alt+↑`) to jump through matching works or agents, including unclustered entries; the virtualized list scrolls and highlights the target row even when it was off-screen.
- Side panel: prettified Intermarc of selected record. ARK labels keep the human-readable title in the text and surface the identifier on hover, and 140/750/740 links are clickable to open the targeted entity in a new workspace tab. Field lines respect the numeric order of their blank nodes and display storage zones carrying `fieldCompactValue` literals instead of leaving them empty.
- Below or beside the record viewer, a backlinks panel lists every work/expression/manifestation that references the selected entity, with segmented titles, a direct ARK shortcut, and the fields where the reference lives; expand it into its own third column when you want the entity list, Intermarc, and backlinks side by side.
- Bottom-right hover toolbar: unfold it to access the pop-out/dock/full-width Intermarc controls and a backlinks toggle. Expanded backlinks reshape the workspace into three equal columns; folding tucks the backlinks panel back under the record. A fourth button hides or shows the list of entities on the left.

### Manual clustering
- Works, agents, expressions support the same manual clustering workflow: add `90F$q Clusterisation manuelle` + `90F$3` in a entity's Intermarc (or right-click an entity then “Prepare for clustering” → “Cluster selected {entity} here”) to group it under an anchor. Checkboxes are binary: unchecking removes the entity from the cluster and rewrites the anchor’s 90F entries. An entity ARK can belong to only one cluster, and any entity already an anchor (90F marked created/manual) cannot be targeted.
- Removing a work from a cluster is blocked when one of its expressions participates in an expression cluster tied to another work (whether the expression is the clustered member or the anchor), to avoid breaking cross-work expression groupings.
- Expressions are constrained to siblings sharing the same parent work (750$3). Right-click or edit Intermarc with `90F$q Clusterisation manuelle` + `90F$3`; anchors marked created/manual are protected, an expression ARK can belong to only one cluster, and any expression already clustered under another anchor cannot itself be queued or used as an anchor (distinct toasts for anchor vs clustered members).

### Manifestation uprooting / reattachment
- Right-click a manifestation row to “Prepare for uprooting”, then right-click any expression row to “Attach selected manifestation to this expression”. The confirmation modal lists the current 740$3 links (pre-selected when there is only one) so you can decide which expressions to uproot before adding a new 740 pointing to the target expression. The curated dataset and UI stay in sync and the action works from any workspace tab or detached window.
- Only one manual operation (work/expression clustering, anchor swap, originality swap, manifestation uprooting) can be active at a time: the pending entity is dimmed and other context-menu actions stay disabled until the current operation is confirmed or cancelled.
- Backend mutation `POST /api/datasets/{dataset_id}/manifestations/uproot` rewrites the manifestation’s 740$3 links, marks them as manual, patches the cached `WorkspaceViewBuilder`, and returns `updatedRecords`, `updatedClusters`, and `updatedWorkRows` for cache-aware UI refreshes (used by `applyServerWorkspaceUpdates` + `applyServerUpdates`).

### Windows & tabs management
- Workspace tabs can be “unmoored” into their own windows; Intermarc panes in those windows remain synced and offer a full-window toggle for multi-monitor comparisons.
- Right-click any ARK (work/expression/manifestation or agent) to open it in a new tab or directly in a detached window; agent ARKs route to the Agents workspace automatically.

### Editing anchor or independent entities
- Click a work anchor, then "Modify record" to open a JSON editor (CodeMirror) for the anchor’s Intermarc.
- Edit existing zones/subzones or add new ones; click "Save" to apply. Changes are reflected in export and cluster view (e.g., title updates).
- The editing surface mirrors the pretty-printed view (colors, ARK label hover tooltips, highlighted background) and offers instant autocomplete for controlled values and entities—type the start of a label (e.g., `tex`) to pick the matching ARK, with suggestions restricted to the controlled lists and entity natures allowed in the current subfield.

### SPARQL searches
- Open a SPARQL tab to explore the dataset. You can traverse W–E–M links, filter on MARC subfields, and join on `$3` relationships; see [`documentation/sparql_store.md`](documentation/sparql_store.md) for a quick vocabulary reference and example queries.
- Each entity links to blank-node fields via `<https://vendange.bnf.fr/hasField>`; fields expose their `fieldCode` and either a `fieldCompactValue` literal (for storage zones 990/907/90H/901/991) or nested `hasSubfield` blank nodes with sanitised codes (`$` → `s`) and values—filter on those nodes directly to reach any MARC subfield.
- The SPARQL tab also exposes a Sparnatural visual builder. Use it to assemble work → expression → manifestation hops, constrain MARC zones/subfields, and pick controlled values from a label-based list—the corresponding ARK is injected automatically into the generated query. The builder keeps the CodeMirror editor synchronised so you can start visually then finish by hand if needed.
- Common text filters are now pre-wired: pick “Text (title)” on works/expressions/manifestations/agents to search directly in the right MARC subfields, or “Text (entity wide)” to match any subfield without building a field/subfield chain. When you open a Field node you can still filter by code, or choose “Text (field wide)” to match any of its subfields; type multiple values separated by commas or new lines to emit a `VALUES`-style OR filter.
- Sparnatural reads a SHACL profile. Update `data_inspection/src/app/sparql/sparnaturalConfig.ts` when you need to expose a new node/property.
- The builder also surfaces agent entities (person / collective / famille) with the 700/701/702/710/711/712 links, lets you pick relator codes from the controlled lists, and hides ARKs for agents in favour of their Intermarc label.
- Vendange stores each record in its own named graph. The builder (and manual execution) rewrite Sparnatural output into one `GRAPH` block per entity (`GRAPH ?g_manifestation { … }`, `GRAPH ?g_expression { … }`, etc.) so W–E–M traversals span the right graphs out of the box. For custom logic you can still provide explicit `GRAPH` clauses—auto-wrapping steps aside as soon as it detects one.
- From the SPARQL results, pick the columns that contain work or agent ARKs and apply them as a global filter: matched rows are highlighted, out-of-scope clusters collapse + dim, and the filter stays active across all workspace/agent tabs (inline or detached) until you clear it from the banner.

### Data exploration scripts
- `data_exploration/subset_by_150.py` — builds a new Oxigraph store containing works whose `150` subfields match a needle, optionally pulling linked expressions (`750s3`), manifestations (`740s3`), and agents; controlled values referenced by the kept records are always copied. The script registers the subset in `data_curation/api/datasets/datasets.json` so FastAPI/React can open it; output lives under `data_curation/api/datasets/<dataset>-subset-<needle-slug>`. Example:  
  `uv run python data_exploration/subset_by_150.py current-exportcsv "petites filles modèles" --include-expressions --include-manifestations --include-agents`

### Installation
On MacOS Monterey 12.6.7, use Python 3.11 to install spaCy:

```
uv venv --python 3.11
uv sync
uv run -- spacy download fr_dep_news_trf
```

### Postgres dev stack

- Copy `.env.example` to `.env` and adjust `POSTGRES_DSN` if you run Postgres elsewhere (defaults to port 55432 to avoid conflicts).
- Start the database locally: `docker compose -f db/docker-compose.postgres.yml up -d` (service `postgres`, port 55432 -> container 5432).
- The FastAPI backend now exposes `/api/health/db` and reads `POSTGRES_DSN` for pooled connections (defaults to `postgresql://vendange:vendange@localhost:55432/vendange`).
- Apply the base schema once Postgres is up: `uv run python -m data_curation.api.pg.schema ensure-schema`. Create/drop dataset partitions with `create-partitions` / `drop-partitions --dataset <id>`.
- Dataset uploads now write directly to Postgres tables (`entity`, `entity_label`, `rel_edge`, `cluster`, `fts`); Oxigraph has been removed.
- Ontop dev stack (SPARQL over Postgres): `docker compose -f docker-compose.ontop.yml up -d` (exposes `http://localhost:8080/sparql`, connects to Postgres on 55433). Configure `ONTOP_ENDPOINT_URL` in `.env` if you run it elsewhere.
