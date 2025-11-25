# Performance Refactoring Report: Scaling Vendange

## Executive Summary

**Current Status:** The application utilizes a "Firehose" architecture where the backend dumps the entire dataset (Intermarc records) to the frontend upon dataset load. The frontend then parses, indexes, clusters, and renders this data in-memory.

**The Problem:** This architecture has $O(N)$ memory and processing complexity on the client-side.
- **4k entities (Current):** ~20MB strings, ~111MB objects. Usable but sluggish.
- **40k entities (Target):** ~200MB strings, ~1.1GB objects. **Will crash most browsers.**

**The Solution:** Transition to a **"Load-on-Demand"** architecture. The backend must become the source of truth for clustering and searching, while the frontend becomes a view layer that fetches only what is currently visible.

---

## 1. Deep Dive: The Bottlenecks

### A. Backend: The Data Dump (`data_curation/api/db_query.py`)
The `load_records` function executes a global query to retrieve every single record in the Oxigraph store.
```python
# Current Logic
def load_records(dataset_id: str):
    # ... fetches ALL subjects ...
    for record_id in subjects:
        # ... loads full Intermarc JSON ...
        records.append(...)
    return records
```
**Impact:**
- High latency on initial load.
- Excessive network bandwidth usage.
- Server memory pressure to serialize the huge JSON response.

### B. Frontend: State Bloat (`AppDataContext.tsx`)
Upon receiving the data, the `AppDataProvider`:
1. Stores the raw JSON strings (Linear memory cost).
2. Parses *every* JSON string into an Intermarc object tree (High memory overhead).
3. Runs `detectClusters` on the entire array (Blocking CPU operation).
4. Builds `originalIndexes` (Memory overhead).

**Impact:**
- **Heap Exhaustion:** The browser holds the entire database in RAM.
- **Main Thread Blocking:** Parsing and clustering 40k records will freeze the UI for seconds or minutes.

### C. Frontend: Rendering (`WorkListPanel.tsx`)
The list of works/clusters is rendered using a standard `.map()`:
```tsx
sortedEntries.map(entry => ( ... ))
```
**Impact:**
- **DOM Overload:** Rendering 5,000+ rows creates tens of thousands of DOM nodes.
- **Reflow/Repaint:** Any state change triggers massive recalculations.
- **Slow Interaction:** "FocusUp" and other interactions feel laggy because the browser is struggling to manage the huge DOM tree.

---

## 2. Refactoring Plan

### Phase 1: Stop the Bleeding (Frontend Rendering)
*Goal: Make the UI responsive for the current 4k dataset.*

1.  **Virtualization:** Implement **`react-virtuoso`** (recommended over `react-window` for its handling of variable item heights) in `WorkListPanel.tsx`.
    -   Only render the ~20 items currently visible on screen.
    -   This solves the "slow focusUp" and DOM bloat immediately.

### Phase 2: Architectural Shift (The "Real" Fix)
*Goal: Enable scaling to 40k+ entities.*

#### Backend Changes
1.  **Server-Side Clustering:**
    -   Move the logic from `detectClusters` (frontend) to the backend.
    -   The API should return *clusters*, not just raw records.
    -   Store cluster relationships in the graph (or cache them) so they don't need to be recomputed on every request.
2.  **Pagination & Filtering:**
    -   Modify `load_records` to accept `limit`, `offset`, and `search` parameters.
    -   **New Endpoint:** `GET /api/datasets/{id}/clusters?page=1&limit=50`
    -   **New Endpoint:** `GET /api/datasets/{id}/records/{record_id}` (Fetch single record details on demand).

#### Frontend Changes
1.  **State Management:**
    -   **Remove** `curated` (the huge array) from `AppDataContext`.
    -   Adopt **TanStack Query (React Query)**. This library is the industry standard for async state management.
        -   It handles caching, loading states, and pagination automatically.
        -   It allows you to keep the "in-memory" footprint small (only caching what has been visited).
2.  **Data Fetching Strategy:**
    -   **List View:** Fetch a page of clusters (lightweight summaries: ID, Title, Anchor).
    -   **Detail View:** When a user clicks a cluster/record, fetch the full Intermarc object for *that specific record* (if not already cached).
    -   **Backlinks:** Fetch backlinks asynchronously when the record is selected, rather than pre-calculating them for the whole universe.

---

## 3. Proposed Technology Stack

-   **List Virtualization:** `react-virtuoso`
    -   *Why?* Handles dynamic heights automatically (essential for wrapped titles and badges).
-   **Data Fetching:** `@tanstack/react-query`
    -   *Why?* Decouples server state from UI state. Built-in infinite scroll support.
-   **Backend:** Keep FastAPI + Oxigraph.
    -   *Optimization:* Use SPARQL `LIMIT`/`OFFSET` for pagination. Use full-text search features of Oxigraph if available, or simple regex filtering for now.

## 4. Roadmap



### Phase 1: Stop the Bleeding (Frontend Rendering) - **COMPLETED**

- [x] **Virtualization:** Implemented `react-virtuoso` in `WorkListPanel.tsx`.

- [x] **Scroll Container Fix:** Modified `WorkspaceViewLayout` to handle virtualization scroll correctly.

- [x] **Optimized Rendering:** The UI now handles 5,000+ items without DOM overload.



### Phase 2: Architectural Shift (The "Real" Fix)

*Goal: Enable scaling to 40k+ entities by moving clustering to the backend.*



#### Step 1: Backend - Cluster-Oriented API

Instead of sending raw records, the backend should serve pre-calculated clusters.



1.  **Define Data Models (`data_curation/api/models.py`)**:

    -   Create Pydantic models matching the frontend `Cluster`, `ClusterItem`, `ExpressionItem` structures.

2.  **Implement Clustering Logic (`data_curation/api/clustering.py`)**:

    -   **Strategy:** Do not replicate the $O(N)$ loop in Python. Use SPARQL to fetch "Top Level Works" (Anchors).

    -   **Query 1 (Pagination):** Select distinct `?work` where `?work` is a Work AND `?work` is NOT a target of a clustering `90F` field. Apply `LIMIT` / `OFFSET`.

    -   **Query 2 (Hydration):** For the retrieved works, fetch their `90F` targets (clustered works), their expressions (via `750` backlinks), and manifestations.

3.  **New Endpoint**:

    -   `GET /api/datasets/{id}/clusters?page=1&limit=50`

    -   Returns: `{ items: Cluster[], total: number }`



#### Step 2: Frontend - Data Fetching

1.  **React Query Integration**:

    -   Replace `useAppData`'s `curated` array with `useInfiniteQuery` calling the new endpoint.

    -   Update `WorkListPanel` to use `Virtuoso`'s `endReached` prop to trigger `fetchNextPage`.



#### Step 3: Detail View on Demand

1.  **Single Record Fetch**:

    -   When a user clicks a work/expression to view details, check if the full Intermarc is already loaded.

    -   If not (or if only partial data is available), call `GET /api/datasets/{id}/records/{record_id}`.



---



## 3. Proposed Technology Stack
