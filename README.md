# Vendange
---

_Vérification Experte, Nettoyage et Dédoublonnage des Arbres NOEMI par Grappage Enchâssé_

### Disclaimer
While the ideas behind Vendange's clustering operations and its UI are the result of human reflexion, the code was produced by gpt-5-codex in codex cli.

### Overview
- Python CLI to run modular data-curation operations directly against the Oxigraph SPARQL store for IFLA-LRM entities (with an optional helper flag to ingest fixture CSVs during development).
- Web UI to review, approve/reject/alter merges and export a curated dataset.

### Getting Started
1) Data sources
- The starting point of our project is a database containing the **French National Library's catalog** in Intermarc Nouvelle Génération (NG), a format that's compatible with IFLA LRM and implements the RDA-FR cataloguing code. Information about the purpose of the migration can be found [here](https://www.rdatoolkit.org/sites/default/files/rsc/BNF_intermarc_Foucher.pdf). This format belongs to the broad family of MARC (*Machine-Readable Cataloging Record*) formats, about which please see this page of the [Library of Congress](https://www.loc.gov/marc/umb/um01to06.html).
  - Cataloging guidelines for Intermarc NG can be found on [Kitcat NG](https://kitcatng-ext.bnf.fr/consignes-catalogage), the BNF's cataloging reference guide for the new format, but the description of Intermarc NG fields is not publicly available yet. Meanwhile, one can rely on [Kitcat](https://kitcat.bnf.fr/manuel-intermarc), the previous reference guide, which contains a detailed description of fields in Intermarc.
- We accessed the database through the current version of NOEMI, an internal website of the National Library that allows its teams to access, modify and augment the catalog. NOEMI is still in a pre-release phase during which migration tests are regularly conducted, from Intermarc to Intermarc NG. It is populated by a temporary version of the database after a mock migration.
- The repository includes `sample_data/current_export.csv`, a **small sample taken from this temporary snapshot**.
  - It comprises all works whose agent (relator fields 700, 701 or 702 for people, 710, 711, or 712 for groups) is the Comtesse de Ségur (technically the ark identifier of her record : ark:/12148/cb130916590), the expressions pointing to those works, and the manifestations pointing to those manifestations.
  - In the SQL query, we also had to retrieve all entities (agents, works, expressions, manifestations, *valeur contrôlée*, *brand*) whose ark identifier appears in any field of the initial matches, to be able to display the record of those initial matches with all values in human-readable format, as at, the time of writing, there is no API access to the new catalog.
  - The list of initial works and the SQL query can be found in folder [sql](documentation/sql_NOEMI).

2) Understanding links between entities
- In addition to the Kitcat pages mentioned above, please see the rough-hewn and schematic "Linked entity ontology" in [AGENTS.md](AGENTS.md)

3) Data curation
- Operation implemented: clustering works and expressions, creating adaptation links between original works and adaptations.
- For each clustered work (besides the anchor), the anchor gets a new `90F` zone with:
  - `90F$a` = ARK of the clustered work (from `001$a`)
  - `90F$q` = `Clusterisation script`
  - `90F$d` = today (YYYY-MM-DD)
- Adaptation links:
  1. The original work gets a `552$q` subfield with the ARK identifier of the controled value with `169$a` "A pour adaptation" and a `552$3` subfield pointing to the ARK identifier of the adaptation.
  2. The adaptation gets a `552$q` with the ARK identifier of the controled value with `169$a` "Est une adaptation de" and a `552$3` subfield pointing to the ARK identifier of the original work.
  
4) Running data curation operations
- To launch the FastAPI server in `data_curation/api`: `uv run fastapi dev data_curation/api/app.py`. See below for explanations.
- The React UI opens on a dashboard that lets you upload CSV snapshots, launch clustering (with or without expression propagation) while streaming script logs, jump into the inspection workspace, or delete a dataset. Every upload becomes its own Oxigraph store—colleagues can curate multiple corpora in parallel.

### Curation API

- `POST /api/datasets/<dataset_id>/cluster` starts the clustering pipeline (optionally cascading to expressions) and streams progress as Server-Sent Events. Request payload:

  ```json
  { "includeExpressions": true }
  ```

  Stream events carry either:
  - `log` — incremental log lines with `level`, `logger`, `message`.
  - `result` — JSON payload containing `workClusters` and, when requested, `expressionClusters`.
  - `error` — terminal error message (HTTP 200, but the stream ends right after).

  Example:

  ```bash
  curl -N \
    -H "Content-Type: application/json" \
    -X POST http://localhost:8000/api/datasets/my-dataset/cluster \
    -d '{"includeExpressions": false}'

- `GET /api/datasets/<dataset_id>/records` returns every entity currently stored in the Oxigraph dataset (id, type, ark, intermarc JSON). The front-end uses this to populate the inspection workspace directly from the store—no more CSV ingestion.
  ```

### Debug & Fixtures

- **Interactive variant debugging** — set `TITLE_MATCH_DEBUGGER=1` when running the CLI (typically with `-vv`) to drop into `pdb` right before NLP cleaning. Example: ```TITLE_MATCH_DEBUGGER=1 python3 -m data_curation.cli -vv detect-contamination --input data/in.csv --out-json data/out.json``` lets you inspect the exact strings matched against the title before spaCy processes them.
- **Styled debug logs** — use `-vv` to unlock Rich-powered logs: the CLI renders colourful panels, syntax-highlighted titles, and tables for matched variants and removed segments.

### Deployment

- Build and run the FastAPI backend together with the static React front-end:

  ```bash
  docker compose up --build
  ```

  The backend listens on `http://localhost:8000`, the front-end on `http://localhost:5173`. The Oxigraph store is persisted in the `vendange_store` named volume so your curation state survives container restarts.

- Build images separately if you prefer independent deployments:

  ```bash
  docker build -f Dockerfile.backend -t vendange-backend .
  docker build -f Dockerfile.frontend -t vendange-frontend .
  ```

  The backend image boots `uvicorn` with the app located at `data_curation.api.app:app`; the front-end image serves the pre-built Vite bundle via Nginx.

Review in the Web UI
- Start the UI: `npm run dev`
- Use the toolbar’s **Export dataset CSV** button to download the current dataset with your curated changes applied.
- From the dashboard, upload one or more dataset CSV snapshots. Each upload becomes its own Oxigraph store under `data_curation/api/datasets/`; use the dataset’s **Open** action to inspect or curate it.
- The inspection view keeps a single in-memory copy of the dataset; pristine snapshots are captured per record only when you edit it, keeping load time and memory footprint low while still allowing per-record reset.
- Three tab kinds are available from the “+” dropdown: WEM workspace, Agents workspace (people/collectives/families), and SPARQL query tabs; the dropdown now supports keyboard navigation (Enter/Space to open, arrows to move, Escape to close) and closes reliably on outside clicks.
- The UI detects clusters by scanning for `90F$q = "Clusterisation script"` in works.
- Key information about entities is displayed in badges:
  - Expression counters (orange) only appear when at least one manifestation points to the entity.
  - Manifestation counters (green) only render when a work has incoming manifestations.
  - Expressions display a red *750 links* badge whenever more than one work points to them; manifestations expose an orange *740 links* badge when multiple expressions reference them.
  - Relationship badges show outgoing and incoming 5XX links as `outgoing|incoming`, and are hidden when both values are zero.
  - Agent badges disappear for entities without 7XX contributors.
- Central panel: list of anchors with merged works (checkbox to accept/reject).
- Side panel: prettified Intermarc of selected record. ARK labels keep the human-readable title in the text and surface the identifier on hover, and 140/750/740 links are clickable to open the targeted entity in a new workspace tab.
- Below or beside the record viewer, a backlinks panel lists every work/expression/manifestation that references the selected entity, with segmented titles, a direct ARK shortcut, and the fields where the reference lives; expand it into its own third column when you want the entity list, Intermarc, and backlinks side by side.
- Bottom-right hover toolbar: unfold it to access the pop-out/dock/full-width Intermarc controls and a backlinks toggle. Expanded backlinks reshape the workspace into three equal columns; folding tucks the backlinks panel back under the record. A fourth button hides or shows the list of entities on the left.
- UI quality-of-life:
  - Hierarchical selectors show anchors and clustered entries in clearly separated sections with 🍇 for clustered items.
- Works now support the same manual clustering workflow as agents: add `90F$q Clusterisation manuelle` + `90F$3` in a work’s Intermarc (or right-click a work then “Prepare for clustering” → “Cluster selected work here”) to group it under an anchor. Checkboxes are binary: unchecking removes the work from the cluster and rewrites the anchor’s 90F entries. A work ARK can belong to only one cluster, and any work already an anchor (90F marked created/manual) cannot be targeted.
- Expressions now follow the same manual clustering flow, constrained to siblings sharing the same parent work (750$3). Right-click or edit Intermarc with `90F$q Clusterisation manuelle` + `90F$3`; anchors marked created/manual are protected, an expression ARK can belong to only one cluster, and any expression already clustered under another anchor cannot itself be queued or used as an anchor (distinct toasts for anchor vs clustered members).
- Agents list mirrors work clustering: when an agent has a `90F$q Clusterisation manuelle` pointing to another agent in `90F$3`, the anchor and clustered agents are grouped in the list with checkboxes. A checked box means “in the cluster”; unchecking immediately removes the agent from the cluster and from the anchor’s Intermarc (no greyed intermediate state). Manual 90F links are enforced as unique: a given agent ARK can belong to only one anchor cluster at a time.
- An agent that is already clustered (i.e., its ARK appears as a clustered item of another anchor) can no longer be put into “Prepare for clustering”; the UI blocks the action up-front with the same guardrails the backend enforces, keeping Intermarc edits and DB state aligned.
- Agent clustering stays in sync front-to-back: the UI rewrites the anchor Intermarc through `updateRecordIntermarc`, which calls `/api/datasets/{id}/update_record`; the FastAPI layer rejects saves when a manual 90F$3 ARK is already linked to another anchor, so the UI state and the Oxigraph store cannot diverge.
- UI shortcut for clustering: right-click an agent to “prepare for clustering”, then right-click a compatible agent (same kind) and confirm; the app writes the corresponding `90F$q Clusterisation manuelle` + `90F$3` in the anchor’s Intermarc using the same backend path as manual edits.
  - Double-click or use user-defined shortcuts on cluster/expression banners to jump between works ⇄ expressions ⇄ manifestations, and the pane auto-scrolls to the linked card.
  - Unchecked expressions automatically move to the independent block; their manifestations are greyed out to signal that they will not change the exported CSV.
  - WEM labels display each 150 / 140 / 245 subfield with its code for faster inspection.
  - Workspace tabs can be “unmoored” into their own windows; Intermarc panes in those windows remain synced and offer a full-window toggle for multi-monitor comparisons.
  - Right-click any ARK (work/expression/manifestation or agent) to open it in a new tab or directly in a detached window; agent ARKs route to the Agents workspace automatically.
  - Right-click a workspace entity row (work/expression/manifestation) or an Intermarc ARK link to open it in a new workspace tab or launch it directly in a detached workspace window; detached windows start with the Intermarc view expanded by default.
- Keyboard shortcuts work across WEM, Agents, and SPARQL tabs (inline or detached) and stay scoped to the window that currently has focus: arrows/listUp/listDown move through WEM/Agents lists without syncing other windows (detached agent lists remain independent from inline tabs), tab cycling works left/right, tiling/cascading again resizes detached windows, and the side-toolbar actions (detach tab, toggle backlinks, list, Intermarc width) are consistent everywhere; configure them in the shortcuts modal.

Editing anchor or independent entities :
- Click a work anchor, then "Modify record" to open a JSON editor (CodeMirror) for the anchor’s Intermarc.
- Edit existing zones/subzones or add new ones; click "Save" to apply. Changes are reflected in export and cluster view (e.g., title updates).
- The editing surface mirrors the pretty-printed view (colors, ARK label hover tooltips, highlighted background) and offers instant autocomplete for controlled values and entities—type the start of a label (e.g., `tex`) to pick the matching ARK, with suggestions restricted to the controlled lists and entity natures allowed in the current subfield.

Exploring W–E–M links
- Click an Expression or Manifestation to view its details in the right panel.
- For Expressions with `90F` fields, the UI displays the anchor/clustered hierarchy similarly to works.

SPARQL searches
- Whenever a CSV dataset is uploaded, it is ingested into an Oxigraph store exposed by the FastAPI server in `data_curation/api`.
- Open a SPARQL tab to explore the dataset. You can traverse W–E–M links, filter on MARC subfields, and join on `$3` relationships; see [`documentation/sparql_store.md`](documentation/sparql_store.md) for a quick vocabulary reference and example queries.
- Each entity links to blank-node fields via `<https://vendange.bnf.fr/hasField>`; fields expose their `fieldCode` and either a `fieldCompactValue` literal (for storage zones 990/907/90H/901/991) or nested `hasSubfield` blank nodes with sanitised codes (`$` → `s`) and values—filter on those nodes directly to reach any MARC subfield.
- The SPARQL tab also exposes a Sparnatural visual builder. Use it to assemble work → expression → manifestation hops, constrain MARC zones/subfields, and pick controlled values from a label-based list—the corresponding ARK is injected automatically into the generated query. The builder keeps the CodeMirror editor synchronised so you can start visually then finish by hand if needed.
- Sparnatural reads a SHACL profile. Update `data_inspection/src/app/sparql/sparnaturalConfig.ts` when you need to expose a new node/property.
- The builder also surfaces agent entities (person / collective / famille) with the 700/701/702/710/711/712 links, lets you pick relator codes from the controlled lists, and hides ARKs for agents in favour of their Intermarc label.
- Literal list widgets rely on the Select2 bootstrap in `data_inspection/src/app/vendor/select2.ts` to circumvent a typing issue.
- Vendange stores each record in its own named graph. The builder (and manual execution) rewrite Sparnatural output into one `GRAPH` block per entity (`GRAPH ?g_manifestation { … }`, `GRAPH ?g_expression { … }`, etc.) so W–E–M traversals span the right graphs out of the box. For custom logic you can still provide explicit `GRAPH` clauses—auto-wrapping steps aside as soon as it detects one.
- Graph wrapping also keeps MARC field/subfield filters with their parent entity graph, even when Sparnatural emits them in multiple BGP blocks (e.g., subfield code and value filters added in separate steps).

Design Notes
- UI performs all actions client-side; no network dependencies, but relies on FastAPI for the SPARQL store and query endpoint.
- Multi-window Intermarc exploration, including window lifecycle, synchronization, and library options, lives in [`documentation/multi_window_intermarc.md`](documentation/multi_window_intermarc.md).

### Installation

On MacOS Monterey 12.6.7, use Python 3.11 to install spaCy:

```
uv venv --python 3.11
uv sync
uv run -- spacy download fr_dep_news_trf
```
