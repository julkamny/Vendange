# Pagination Optimization and Search Integration Plan

## 1. Problem Analysis

### Current Bottlenecks
The current implementation of pagination in `list_dataset_clusters` and `list_dataset_agents` is inefficient for large datasets because:
1.  **Full Table Scans:** Every request triggers a full scan of the dataset (SPARQL `SELECT DISTINCT ...`) to identify all relevant entities (anchors, agents).
2.  **Redundant Sorting:** The entire result set is sorted in Python memory on every request, only to discard all but a small slice (e.g., 50 items).
3.  **No State Persistence:** The backend does not remember the order or the set of entities between requests, forcing a re-computation.

### Impact of New Features (Creation/Editing)
Adding or modifying entities (Works, Expressions, Agents) currently invalidates the implicit state of the database. Since the list is re-computed every time, changes are immediately reflected (consistency is high), but performance remains poor. 
If we introduce caching, we introduce a **consistency vs. performance** trade-off. We must ensure that adding a new work updates the cache or invalidates it so the user sees the new item.

---

## 2. Optimization Proposal: Backend Caching

We will implement a **Server-Side ID Cache** that stores the ordered list of IDs for the current dataset state.

### 2.1. Cache Mechanism
Instead of re-querying the store, we will compute the ordered list of IDs once (on the first page request) and store it.

**Workflow:**
1.  **Client requests Page 1:**
    *   Backend checks for an existing cached list for `(dataset_id, context_type)`.
    *   *Cache Miss:* Backend executes the full SPARQL queries (`_anchor_work_ids` or `_agent_ids`), sorts the results, and stores the full list of IDs in memory (e.g., in a `PaginationCache` singleton or attached to the `Dataset` object).
    *   *Cache Hit:* Backend retrieves the list.
2.  **Slicing:** The backend slices the cached list (`ids[offset : offset + limit]`).
3.  **Hydration:** The backend loads only the entities in the slice (`_load_entities`).
4.  **Response:** Returns the populated entities.

### 2.2. Handling Data Modifications (Cache Invalidation)
When a "write" operation occurs (e.g., `ingest_records`, `update_record` involving ARK/link changes, creation of new entities), we must ensure consistency.

**Strategy: Invalidate-on-Write**
*   **Action:** Whenever a mutation API endpoint is called (e.g., `/api/datasets/{id}/update_record`, `/api/datasets/{id}/swap_anchor`), we explicitly **clear** the cache for that dataset.
*   **Consequence:** The very next read request will be slow (re-indexing), but subsequent requests will be fast.
*   **Rationale:** In a curation tool, reads (browsing) vastly outnumber writes. The cost of re-indexing once after an edit is acceptable and much simpler than trying to "patch" the sorted list correctly (which would require knowing exactly where the new/modified item fits in the sort order).

**Specific Scenario: Adding a New Work/Agent**
*   **User Action:** User creates a new Work.
*   **Backend Action:** 
    1.  Insert Quad into Store.
    2.  `PaginationCache.invalidate(dataset_id)`
*   **User Experience:** The user is redirected to the list or stays on the view. The list reloads. The reload takes 1-2 seconds (depending on dataset size) instead of *every* page turn taking 1-2 seconds.

---

## 3. Feature Integration: Search Results as Context

We want to allow users to "Open as List" from the SPARQL/Sparnatural view. This fits perfectly with the Caching architecture if we treat "Search Results" as just another **Context**.

### 3.1. Concept: `SearchResultContext`
Currently, the "Default" context is "All entities of type X". 
A "Search" context is "Entities with IDs [A, B, C...]".

### 3.2. Workflow
1.  **User Query:** User runs a SPARQL query in `SparqlWorkspaceView`.
2.  **Selection:** User identifies a column representing the entities they want (e.g., `?work`, `?agent`).
3.  **Action:** User clicks "Open as Work List" (or Agent List).
4.  **Context Creation (New API):**
    *   Frontend sends the list of IDs (or the query to re-execute, though sending IDs is safer for arbitrary results) to a new endpoint: `POST /api/datasets/{id}/pagination_context`.
    *   Payload: `{ ids: string[], type: 'work' | 'agent' }`
    *   Backend generates a `context_id` (UUID) and stores the list in the `PaginationCache` under this ID.
    *   Returns `{ contextId: "..." }`.
5.  **Navigation:**
    *   Frontend navigates to `WorkspaceView` or `AgentView` with a query parameter: `?contextId=...`.
6.  **Data Fetching:**
    *   The existing `list_dataset_clusters` and `list_dataset_agents` endpoints accept an optional `contextId`.
    *   If `contextId` is present, they fetch IDs from the cache key corresponding to that context instead of the default "all" list.
    *   Pagination works exactly the same (slicing the cached list).

### 3.3. UI Integration
*   **SparqlWorkspaceView:** Add a dropdown/button on column headers: "Open column as Work List" / "Open column as Agent List".
*   **WorkspaceView / AgentView:** 
    *   Check for `contextId` in URL or State.
    *   If present, display a banner: "Viewing Custom Search Results (X items) [Exit to Full List]".
    *   "Exit" button clears the `contextId` and reloads the default list.

---

## 4. Detailed Implementation Plan

### 4.1. Backend (`data_curation`)

1.  **Create `PaginationCache` Module:**
    *   A simple in-memory store (dictionary) mapping `context_key` -> `List[str]`.
    *   `context_key` structure: `f"{dataset_id}:{context_id}"`.
    *   Default context ID can be `"default_works"` and `"default_agents"`.

2.  **Update `clustering.py` and `agents.py`:**
    *   Modify `list_clusters` / `list_agents` to check the cache first.
    *   Refactor `_anchor_work_ids` and `_agent_ids` to returning the full list for caching, rather than slicing immediately (or separate the "indexing" phase from the "paging" phase).
    *   Implement `context_id` parameter handling.

3.  **Implement Invalidation:**
    *   In `db.py` or `app.py`, call `PaginationCache.clear(dataset_id)` whenever a write operation succeeds.

4.  **New Endpoint:**
    *   `POST /api/datasets/{dataset_id}/search_context`: Accepts IDs, returns `contextId`.

### 4.2. Frontend (`data_inspection`)

1.  **Update API Client (`lib/api.ts`):**
    *   Update `fetchDatasetClusterPage` and agent fetching to accept `contextId`.
    *   Add `createSearchContext(ids)` function.

2.  **Update `AppDataContext`:**
    *   Add `contextId` to the state.
    *   Update `loadNextClusterPage` to pass `contextId`.
    *   Add `setSearchContext(id)` action.

3.  **Update `SparqlWorkspaceView`:**
    *   Add "Open as List" UI to result table headers.
    *   Implement the flow: Extract IDs -> Call API -> Navigate.

4.  **Update `WorkspaceView` / `AgentView`:**
    *   Visual indication that a filtered list is active.
    *   Mechanism to clear the filter.

## 5. Conclusion
This approach solves the performance issue by "memoizing" the expensive sort/query operation and naturally extends to support the "Search Results as List" feature by treating search results as just another memoized list. The Invalidate-on-Write strategy ensures data consistency with minimal complexity.
