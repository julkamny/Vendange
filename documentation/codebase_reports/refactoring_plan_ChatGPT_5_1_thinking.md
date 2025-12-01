## 1. Objectives & Scope

We want to:

1. **Move clustering logic from frontend to backend**

   * Port `detectClusters` (and related helpers in `clusters.ts` / `unclustered.ts`) to the backend (`data_curation/api`), so the backend returns:

     * Work clusters (anchor work + clustered works)
     * Independent works
   * Apply the same idea to agents (manual clusters).

2. **Introduce just-in-time Intermarc loading**

   * Stop sending full Intermarc for every record via `list_dataset_records` (in `app.py`).
   * For lists (`div.entity-row` with `span.entity-pill`, `span.entity-count-badge`, `span.entity-media-emoji`) send only the minimal “view model” necessary.
   * Fetch full Intermarc on demand (when a row is selected) via the `/query` endpoint.

3. **Support expression/manifestation drill-down from the DB**

   * When navigating to `ExpressionPanel` and `ManifestationPanel`, fetch the information needed for:

     * Pills, count badges, media emoji
     * Backlinks (their own `BacklinksPanel`)
   * Do this both for:

     * Focus from a work cluster (“focusDown”)
     * Clicking expression links in `SparqlWorkspaceView` or a `BacklinksPanel`.

4. **Use TanStack Query for data fetching**

   * Use `@tanstack/react-query` as the standard abstraction for all calls that hit the backend.

5. **Incremental updates for permutations**

   * Anchor swap, originality swap, manual clustering, manifestation uprooting: backend should return only **modified clusters/entities**, not re-send/recompute everything.
   * UI patches local state / query cache instead of recomputing clusters from scratch.

6. **Minimize duplication and remove dead code**

   * Remove frontend cluster computation once backend is canonical.
   * Remove unused helpers and data structures after migration.

---

## 2. Current Architecture (very short recap)

From the codebase:

* `AppDataContext`:

  * Loads datasets and the full set of curated records via `list_dataset_records`.
  * Stores `curated.records` (full Intermarc), `original.records`, `clusters`, and `pristineRecords`. 
  * Computes clusters in the frontend via `detectClusters(curated.records, buildArkIndex(curated.records))`.

* Clustering:

  * Implemented in `src/app/core/clusters.ts` (`detectClusters`) and supporting pieces (`clusterCoverage.ts`, `unclustered.ts`, `workCounts.ts`).
  * Expression/manifestation grouping happens entirely in TS (`ExpressionAnchorGroup`, `ExpressionItem`, `ExpressionClusterItem`).

* UI:

  * `WorkspaceView` / `WorkListPanel` / `ExpressionPanel` / `ManifestationPanel` use `useWorkspaceData`, which relies on `curated.records` + `clusters`.
  * `EntityLabel`, `CountBadge`, `AgentBadge`, `RelationshipBadge`, media emoji and badges read directly from Intermarc via helpers in `core/entities.ts`, `core/media.ts`, `core/generalRelationships.ts`, and `useRecordLookup`, `useBacklinks`.

* Agents:

  * `useAgentData` filters `curated.records` to agent types and sorts using Intermarc labels. 
  * `AgentView` builds clusters on the client via `buildAgentClusters` and manual 90F parsing (`extractManualAgentTargets`, `addManualAgent90FEntries`).

* Backend:

  * `app.py` exposes `list_dataset_records` and `/api/datasets/{dataset_id}/query` for SPARQL.
  * `db_query.load_records` returns full Intermarc for all entities. 
  * Cluster-related write operations (anchor/originality swap, etc.) already exist in Python: `anchor_swap.py`, `originality_swap.py`, manifestation functions.

This gives us clear choke points: `list_dataset_records`, `detectClusters`, `useWorkspaceData`, `AgentView/useAgentData`, `IntermarcView/Editor`, and the mutation pipelines.

---

## 3. High-Level Target Architecture

Conceptually:

* **Backend as the Single Source of Truth** for:

  * Work clusters (works + expression groups + manifestations).
  * Agent manual clusters.
  * Backlink information.
  * Metrics required to render list rows (counts, relationships, media emoji).

* **Frontend as a thin view layer** that:

  * Uses `react-query` hooks for:

    * Dataset metadata.
    * Work/agent lists (with clusters).
    * Expression/manifestation drill-down.
    * Backlinks for a selected entity.
    * Just-in-time Intermarc records for selected entities.
  * No longer computes clustering from raw Intermarc.

* **Data shapes**:

  * Define small, typed “view models” returned by the API, e.g.:

    * `WorkListRow`, `AgentListRow`.
    * `Cluster` (same logical fields as current TS `Cluster` but without full Intermarc).
    * `ExpressionItemView`, `ManifestationItemView` carrying all badge/count/media info required by `ExpressionPanel`/`ManifestationPanel`.
    * `BacklinkViewItem`.

* **Mutations** (anchor/originality/manual clusters/uprooting):

  * Backend returns *delta* results:

    * Updated clusters and affected list rows.
  * Frontend updates react-query caches instead of recomputing clusters.

---

## 4. Phase 0 – Safety Net & Alignment

1. **Catalogue current data types & usages**

   * Confirm where `RecordRow` is used for:

     * Lists (work/agent lists, workspace).
     * Backlinks.
     * Intermarc editor/view.
   * List all places that use:

     * `detectClusters`, `computeClusterCoverageForRecords`, `getUnclusteredWorks`.
     * `useBacklinks`, `useRecordLookup`.

## 5. Phase 1 – Backend: Clustering & Summary View Models

### 5.1. Define backend DTOs

Add Pydantic models (either in a new `schemas.py` or in `app.py`) that mirror the *view* types used in the frontend, but without Intermarc:

* **Work cluster view** (aligned with `Cluster` in TS): 

  * `WorkCluster`:

    * `anchor_id`, `anchor_ark`, `anchor_title`
    * `items: list[WorkClusterItem]` (clustered works)
    * `expression_groups: list[ExpressionAnchorGroupView]`
    * `independent_expressions: list[ExpressionItemView]`
  * `WorkClusterItem`:

    * `ark`, `id`, `title`, `accepted`, `date`, `origin` (manual/script)
  * `ExpressionAnchorGroupView`:

    * `anchor: ExpressionItemView`
    * `clustered: list[ExpressionClusterItemView]`
  * `ExpressionItemView`:

    * `id`, `ark`, `title`, `work_ark`, `work_id`
    * `manifestations: list[ManifestationItemView]`
    * Plus **precomputed view data** for badges/counts/media (see §5.3).
  * `ExpressionClusterItemView`:

    * Same as `ExpressionItemView` + `anchor_expression_id`, `accepted`, `date`, `origin`.

* **Manifestation view**:

  * `ManifestationItemView`:

    * `id`, `ark`, `title`, `expression_ark`, `original_expression_ark`
    * Precomputed metrics/media as needed for pills & badges.

* **Unclustered work list**:

  * `WorkListRow`:

    * `id`, `ark`, `title`, `type_norm`
    * All fields needed for:

      * `EntityLabel` (pills).
      * `CountBadge` (expression/manifestation counts).
      * `RelationshipBadge`.
      * `Media emoji`.

* **Agent cluster view** (mirror of TS `AgentCluster`):

  * `AgentCluster`:

    * `anchor_id`, `anchor_ark`, `anchor_label`
    * `items: list[AgentClusterItem]` (with `ark`, `id`, `label`).
  * `AgentListRow`:

    * `id`, `ark`, `label`, `type_norm` (person/collective/family)
    * Backlink counts (for `EntityLabel` counts).
    * Maybe media / other metrics if needed.

### 5.2. Port `detectClusters` & unclustered logic to Python

Create a new module, e.g. `data_curation/curation/cluster_views.py`:

1. **Port `detectClusters` logic**:

   * Mirror `src/app/core/clusters.ts` in Python using the existing `Intermarc` model and helpers (expressionWorkArks, manifestationExpressionArks analogues exist or can be implemented similarly using `db_query`).
   * Use `load_records` to pull only the intermarc + typeNorm + id + ark for the dataset. 
   * Ensure the semantics match TS:

     * Skip works that are only clustered members (no outgoing 90F) like the TS version does. 
     * Use `CLUSTER_NOTE` / `MANUAL_CLUSTER_NOTE` to distinguish script vs manual origin. 

2. **Port coverage & unclustered works logic**:

   * Reimplement `computeClusterCoverage`, `getUnclusteredWorks` in Python using the same algorithm as `clusterCoverage.ts` + `unclustered.ts`.
   * Keep sort semantics (`Intl.Collator` in TS) as close as possible (locale-aware compare).

### 5.3. Compute metrics/badges/media in backend

To avoid sending whole Intermarc, backend must produce the fields needed for:

* `span.entity-pill` (text + tooltip).
* `span.entity-count-badge` (counts).
* `span.entity-media-emoji` (media kind icons) for works/expressions/manifestations.

From the frontend code:

* Study:

  * `core/entities.ts`: `titleOf`, `expressionWorkArks`, `manifestationsForExpression`, `countExpressionWorkLinks`.
  * `core/generalRelationships.ts`: `relationshipsFor`, `countGeneralRelationships`.
  * `core/media.ts`: `extractMediaKinds`. 
  * `EntityLabel.tsx`: what it actually renders into badges and counts. 

**Plan for metrics**:

* Implement Python equivalents of:

  * `relationshipsFor` / `countGeneralRelationships`.
  * `extractMediaKinds`.
  * Expression/manifestation count logic currently in `workCounts.ts` (for a cluster/work pair). 

* For each `WorkListRow` and each `ExpressionItemView` / `ManifestationItemView`, compute and include:

  * `counts = { expressions, manifestations }` (where appropriate).
  * `relationships = { outgoing, incoming }`.
  * `media_kinds = [{ kind_code, emoji, label }, ...]` (or equivalent).

This way, the UI can build the same `EntityBadgeSpec[]` and `MediaKind[]` purely from backend data without having raw Intermarc.

### 5.4. New backend endpoints

Introduce new endpoints in `app.py` (or a sub-router):

1. **Work workspace data** (replaces “read everything” style):

   ```text
   GET /api/datasets/{dataset_id}/workspace/works
   ```

   Response shape:

   ```json
   {
     "clusters": [WorkCluster],
     "unclustered_works": [WorkListRow]
   }
   ```

   * Internally:

     * Uses `load_records` and `compute_work_clusters`.
     * Uses coverage to find unclustered works.

2. **Expression/manifestation drill-down**:

   For ExpressionPanel / ManifestationPanel:

   ```text
   GET /api/datasets/{dataset_id}/workspace/work/{anchor_id_or_ark}
   ```

   * Returns the single `WorkCluster` for this anchor plus any contextual data needed.

   Optionally a second endpoint:

   ```text
   GET /api/datasets/{dataset_id}/workspace/expression/{expression_id_or_ark}
   ```

   * Resolves: containing cluster, expression’s manifestations, and metrics needed to render ExpressionPanel when entering directly from SPARQL/backlinks.

3. **Agent list & clusters**:

   ```text
   GET /api/datasets/{dataset_id}/workspace/agents
   ```

   Response:

   ```json
   {
     "clusters": [AgentCluster],
     "unclustered_agents": [AgentListRow]
   }
   ```

   * Implementation mirrors `buildAgentClusters` + `useAgentData` logic in Python (90F manual cluster parsing + label building).

4. **Backlinks for a given entity**:

   Either:

   * Add a convenience endpoint:

     ```text
     GET /api/datasets/{dataset_id}/backlinks?ark={ark}
     ```

     That returns the current `BacklinkViewItem`–like structure (records referencing this entity, with minimal data needed to render `BacklinksPanel`).

5. **Record detail / Intermarc**:

   The spec says “use the `/query` endpoint” when an entity row is selected; two options:

   * **Option A (preferable but requires some backend work)**:
     Add a dedicated endpoint:

     ```text
     GET /api/datasets/{dataset_id}/records/{record_id}
     ```

     * Returns a `RecordRow`-like payload with full Intermarc.

### 5.5. Mutations: extend responses to carry cluster deltas

For existing mutation endpoints (`swap_work_anchor`, `swap_originality`, manifestation attach/detach, etc.):

* Extend their responses to include:

  ```json
  {
    "updated_clusters": [WorkCluster],       // only clusters that have changed
    "removed_cluster_ids": ["..."],          // if anchors changed or clusters collapsed
    "updated_work_rows": [WorkListRow],      // minimal list entries that changed
    "updated_records": [RecordPayload]       // only if Intermarc details are still needed
  }
  ```

* For agent manual clustering, do the same:

  * When saving a modified agent Intermarc that changes 90F manual clusters, return updated `AgentCluster`/`AgentListRow`.

---

## 6. Phase 2 – Introduce TanStack Query and Data Fetching Hooks

### 6.1. Wiring up QueryClient

* In `src/app/App.tsx` (or the top-level), wrap the app in `QueryClientProvider`.
* Consider a small default configuration:

  * Reasonable stale times for:

    * Workspace lists (e.g. 5–10 minutes).
    * Record details (could be short, but cache for back/forward navigation).
  * Retry policy tuned for your environment.

### 6.2. Create typed API wrappers + hooks

In `src/app/lib/api.ts`, extend existing wrappers (`fetchDatasets`, `executeSparqlQuery`) with new ones for:

* `fetchWorkspaceWorks(datasetId)` -> calls `/workspace/works`.
* `fetchWorkspaceAgents(datasetId)` -> calls `/workspace/agents`.
* `fetchWorkCluster(datasetId, anchorKey)`.
* `fetchExpressionContext(datasetId, expressionKey)`.
* `fetchBacklinks(datasetId, ark)`.
* `fetchIntermarcRecord(datasetId, idOrArk)` (using `/query` or `/records/{id}`).

Then create hooks using `@tanstack/react-query`:

* `useWorkspaceWorks(datasetId)`.
* `useWorkspaceAgents(datasetId)`.
* `useWorkCluster(datasetId, anchorKey)`.
* `useExpressionContext(datasetId, expressionKey)`.
* `useBacklinksQuery(datasetId, ark)`.
* `useIntermarcRecordQuery(datasetId, idOrArk)`.

Add mutations:

* `useSwapWorkAnchorMutation`, `useSwapExpressionAnchorMutation`, `useOriginalitySwapMutation`, `useManifestationUprootMutation`, `useManualAgentClusterMutation`, etc.

  * Each mutation:

    * Calls the corresponding backend endpoint.
    * On success, updates the relevant query caches (see next sections) using `queryClient.setQueryData` with the returned `updated_clusters` / `updated_work_rows`.

---

## 7. Phase 3 – Refactor Workspace (Works/Expressions/Manifestations)

### 7.1. `AppDataContext` – narrow its responsibility

Currently `AppDataContext` is doing too much: it holds full datasets, clusters, pristine records, and data loading. 

Refactor towards:

* Keep global app-level state that is truly cross-cutting:

  * Active dataset id.
  * Current tab/workspace states.
  * `pristineRecords` for currently edited records only.
  * Methods like `updateRecordIntermarc`, `getCuratedBaselineRecord`, but re-implemented on top of per-record queries (see Phase 5).

* Remove:

  * Direct calls to `list_dataset_records`.
  * Direct calls to `detectClusters`.
  * Storing `curated.records` and `original.records` as giant arrays for workspace use.

Instead, workspace-level components will use `react-query` hooks.

### 7.2. `useWorkspaceData` and `WorkListPanel`

`useWorkspaceData` currently builds indices and passes down `clusters`, selected work, etc. from `AppDataContext`. 

Refactor:

* Fetch workspace work data via `useWorkspaceWorks(activeDatasetId)`:

  * Provide `clusters`, `unclusteredWorks` directly from backend.
* Keep `useWorkspaceData` as a thin adapter that:

  * Glues query results to `WorkspaceTabStateWorkspace` (selection, filters, sorting).
  * Exposes:

    * `allWorks[]` (derived from clusters + unclustered).
    * Current `cluster` object for the selected work.
    * Derived counts for UI (but using precomputed fields, not Intermarc).

`WorkListPanel`:

* Stop reading full records from context.
* Use `WorkListRow` + `Cluster` view models:

  * For each `div.entity-row`, pass:

    * `title`/`titleSegments` from `WorkListRow` or cluster’s anchor.
    * `badges`, `counts`, `mediaKinds` built from backend data.
  * Remove calls that indirectly use Intermarc for these rows (`titleOf`, `extractMediaKinds`, etc.).

### 7.3. `ExpressionPanel` and `ManifestationPanel`

Current code: `ExpressionPanel` uses a `Cluster` plus `useRecordLookup` + `useBacklinks` to derive counts & media from client-side Intermarc. 

Refactor:

* Change the props so that `ExpressionPanel` and `ManifestationPanel` receive *fully populated* view items:

  * Use `useWorkCluster(datasetId, anchorIdOrArk)` when:

    * User focuses down from a work in the workspace.
    * User comes from SparqlWorkspaceView and selects a work.

  * Use `useExpressionContext(datasetId, expressionKey)` when:

    * User enters from an expression reference (BacklinksPanel, SPARQL view).

* Each expression/manifestation entry should already have:

  * Count badges.
  * Agent names.
  * Relationship counts.
  * Media kinds.

* Replace usage of:

  * `useRecordLookup` inside `ExpressionPanel`.
  * `useBacklinks` for expression/manifestation metrics (but keep backlinks for the right-hand panel, see next section).

This keeps `ExpressionPanel`/`ManifestationPanel` as presentational components over server-computed view data.

### 7.4. `BacklinksPanel` and `useBacklinks`

`useBacklinks` currently uses the in-memory dataset to compute backlinks. 

Refactor:

* Introduce `useBacklinksQuery(datasetId, ark)` hook using:

  * Either `/backlinks` endpoint.
  * Or `/query` with parameterised SPARQL.

* Update `BacklinksPanel` to consume the new hook and display backend-provided backlinks, replacing all dataset-wide computations.

* Keep the existing in-memory backlinks code only as long as needed for migration, then retire it.

---

## 8. Phase 4 – Agents: `AgentView` and `useAgentData`

Current behaviour:

* `useAgentData`:

  * Derives `agents` from `curated.records` using `isAgentRecord` and `buildLabelFromIntermarc`.
* `AgentView`:

  * Builds clusters via `buildAgentClusters`.
  * Renders cluster anchors and items using `EntityLabel`, `BacklinksPanel`, etc.

Refactor:

1. **Backend**: use the new `/workspace/agents` endpoint (Phase 1.4).

2. **Frontend**:

   * Replace `useAgentData` implementation with a `react-query`-based hook:

     ```ts
     export function useAgentData() {
       const { data } = useWorkspaceAgents(activeDatasetId)
       return {
         agents: data?.unclustered_agents ?? [],
         clusters: data?.clusters ?? [],
       }
     }
     ```

   * Adjust `AgentView` to:

     * Use `clusters` from `useAgentData`.
     * Use `AgentListRow` data for unclustered agents.
     * Use backend-precomputed backlink counts (or call `useBacklinksQuery` per selected agent for more detailed panel data).

   * Update context menu and manual clustering flows:

     * `prepareForClustering`, `requestClusterWith`, `confirmPendingCluster` currently write 90F via `addManualAgent90FEntries` and `updateRecordIntermarc`.
     * Keep the 90F editing behaviour in the editor, but on save:

       * Let backend recompute manual agent clusters and respond with updated `AgentCluster` / `AgentListRow` for affected anchors/agents.
       * Patch local `agents`/`clusters` state via `react-query` cache updates.

---

## 9. Phase 5 – Just-in-time Intermarc for IntermarcView / IntermarcEditor

Currently:

* `IntermarcView` and `IntermarcEditor` receive a `RecordRow` with full `intermarc` from `AppDataContext`.
* Intermarc suggestions use `buildEntitySuggestions(curated?.records ?? [], language)` (whole dataset). 

Refactor:

1. **Record selection flow**:

   * When the user selects a `div.entity-row` (work or agent) in workspace or AgentView:

     * Instead of passing a `RecordRow` from `curated.records`, pass an identifier (`id` or ARK).
     * Use `useIntermarcRecordQuery(datasetId, recordKey)` to fetch full Intermarc from the backend when:

       * Intermarc tab/pane is shown.
       * Or user opens “edit” view.

2. **`IntermarcView` / `IntermarcEditor`**:

   * Accept a `loading` + `error` state plus `record` from the query hook.
   * Keep the editor / diff logic unchanged, but read from the JIT-fetched `record`.

3. **Saving edits**:

   * `updateRecordIntermarc` should be rewritten to:

     * Call the backend update endpoint (possibly already present in `db_ingest`/`db.py` wrappers).
     * On success:

       * Update `react-query` cache for `useIntermarcRecordQuery`.
       * If this record affects clustering:

         * Rely on mutation endpoints that return updated clusters (Phase 5.5).

4. **Entity suggestions** for Intermarc editor:

   * Instead of using the whole `curated.records`:

     * Introduce a new backend endpoint that returns a compact list of “entity suggestions” (ARK + label + type) for autocomplete.
     * Cache it with `react-query`.
   * Update `buildEntitySuggestions` to accept these suggestion view models instead of full records.

---

## 10. Phase 6 – Mutation Flows & Incremental Cluster Updates

Revisit the workspace clustering logic (`useWorkspaceClustering.ts`):

Currently:

* Clustering operations:

  * Update Intermarc in memory.
  * Snapshot records for undo.
  * Recompute `clusters` via `detectClusters`.
  * Sync updates to backend via `syncRecordUpdate`.

Target behaviour:

1. **All cluster-changing operations go through backend**:

   * For work clustering (manual 90F), anchor swaps, originality swaps, and manifestation uprooting:

     * Use dedicated mutation hooks that call backend endpoints.
     * Backend:

       * Writes Intermarc.
       * Ensures 90F/cluster consistency (already partly done in `anchor_swap.py` etc.).
       * Recomputes affected clusters server-side.
       * Returns minimal delta payload as described in §5.5.

2. **Frontend only patches query cache**:

   * Use `queryClient.setQueryData` to:

     * Update clusters in `useWorkspaceWorks` (and `useWorkCluster` for specific anchors).
     * Update records in `useIntermarcRecordQuery` if Intermarc changed.
     * Update `useWorkspaceAgents` for manual agent clusters.

3. **Simplify `useWorkspaceClustering`**:

   * Keep UI-level concerns only:

     * Selecting pending source/target.
     * Validating preconditions that depend on UI state (e.g., “missing ARK”, “type mismatch”).
   * Remove logic that tries to enforce global invariants requiring full dataset knowledge (duplicate cluster membership, cluster anchors already anchored, etc.) if now handled by backend guards (which they partly are, see `anchor_swap` / `_ensure_unique_work_clusters`). 

---

## 11. Phase 7 – Cleanup & Dead Code Removal

Once everything runs on the new APIs:

1. **Frontend**:

   * Remove:

     * `src/app/core/clusters.ts` (or leave only types imported from backend if necessary). 
     * `core/unclustered.ts` if not used anywhere else. 
     * `core/clusterCoverage.ts` if coverage is now computed server-side.
     * Any `useBacklinks` logic relying on entire dataset in memory.
     * `buildAgentClusters` and any agent clustering logic that doesn’t rely on backend data.
   * Simplify:

     * `AppDataContext` so it no longer carries `curated.records` for the whole dataset or recomputes clusters.

2. **Backend**:

   * If `list_dataset_records` is no longer used:

     * Replace it with either:

       * The new `workspace` endpoints.
       * Or a slim version returning the minimal per-record view model (if still needed by miscellaneous parts).
   * Remove old helper functions that exist only to support “load everything, compute locally” behaviour.

3. **Tests**:

   * Add backend tests for `workspace` endpoints.
   * Port any key assertions from frontend cluster tests into backend tests (so the canonical logic is on the server).

---

## Appendix – Doubts, Open Questions, and Things to Clarify

These are areas where the SWE will likely need your input or a design decision.

1. **Exact endpoint for record detail**

   * Spec says: “use the `/query` endpoint […] to retrieve the full Intermarc record”.
   * For maintainability and type safety, a dedicated REST endpoint (`/records/{id}`) is much nicer than encoding this into SPARQL from the frontend.
   * **Decision to make**:

     * Strictly stick to `/query` (frontend builds SPARQL), or
     * Add a REST wrapper and document that Intermarc detail queries should use that.

2. **Where to compute metrics (relationships, media, counts)?**

   * Moving **all** of `generalRelationships.ts` and `media.ts` to Python is non-trivial, but necessary if we want to avoid sending raw Intermarc and still show badges/emojis.
   * Alternative: send richer, but still partial, Intermarc slices (only relevant zones/subfields) and keep some logic in TS.
   * **Decision**: how strictly do we want to minimise payload size vs avoiding code duplication across languages?

3. **Intermarc editor suggestions**

   * Today, suggestions for Intermarc editing are computed client-side from all `curated.records` (`buildEntitySuggestions`). 
   * If we no longer ship the whole dataset, we need:

     * Either a dedicated backend endpoint for suggestions (precomputed), or
     * A decision that suggestions can work with a smaller subset (e.g., top N entities, recent, etc.).
   * **Risk**: without a clear plan, JIT loading may silently degrade the editing UX.

4. **Backlinks computation**

   * `useBacklinks` currently works purely from in-memory records; the spec asks to “query from the DB” instead. 
   * There is already SPARQL infrastructure (`queryUtils`, `ensureGraphWrapping`).
   * **Decision**:

     * Centralise backlink SPARQL on the backend (easier to reuse).
     * Or keep SPARQL strings in the frontend and just treat `/query` as a generic SPARQL endpoint.

5. **Detached windows & shared state**

   * You use `DetachedWindowContext` and `broadcast.ts` to keep state in sync across windows/tabs. 
   * `react-query` caches are **not shared** across windows by default.
   * **Question**: do we need cross-window synchronisation of the new query-based data?

     * If yes, we may need to:

       * Re-leverage `BroadcastChannel` to manually invalidate caches across windows, or
       * Accept slightly stale views until refetch.

6. **Granularity of incremental cluster updates**

   * The spec says: “return from the backend only modified clusters / entities”.
   * But some operations (e.g., originality transfer across works) may affect:

     * Multiple clusters.
     * Counts and media icons.
     * Backlink stats.
   * **Design detail**:

     * The mutation response format must be rich enough to handle all side-effects, or
     * We accept that some queries (e.g., workspace list) will be invalidated and refetched fully for simplicity.

7. **Compatibility with existing manual constraints**

   * There is already backend logic ensuring uniqueness of cluster membership and protected anchors (`_ensure_unique_work_clusters`, `_is_work_anchor`, etc.).
   * Frontend `useWorkspaceClustering` also enforces some constraints.
   * After moving logic server-side, we should:

     * Decide which validations remain UI-only (e.g. easier to give immediate feedback).
     * Avoid duplicating heavy consistency checks on both sides.

8. **Scope creep around agents**

   * The spec says “apply the same logic to agents”, but current agent handling is simpler and fully manual.
   * Implementing all of:

     * JIT Intermarc.
     * Backend manual clusters.
     * Backend backlink counts.
   * Might be overkill for first iteration.
   * **Option**:

     * Prioritise works/expressions/manifestations, then port agents once patterns are stable.

9. **Dataset sizes & performance trade-offs**

   * Without knowing typical dataset cardinalities:

     * It’s hard to pick optimal chunking (e.g., whether `/workspace/works` should paginate).
   * **Question**:

     * Are work lists small enough to fetch all at once?
     * Or do we need pagination + virtualisation beyond what `react-virtuoso` already handles?

---

If your SWE follows this plan phase by phase, they should be able to:

* Make the backend the sole owner of clustering and metrics.
* Keep the UI behaviour identical (or improved) while significantly reducing initial payload size.
* Transition safely to a `react-query`-centric data layer.
* End with a codebase where “Just-in-time Intermarc” is real, not just aspirational.
