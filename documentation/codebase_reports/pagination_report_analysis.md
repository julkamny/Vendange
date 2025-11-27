---
date: 2025-11-27
nature:
  - Génération
repo: Vendange
model: ChatGPT 5.1 Thinking
linked:
  - [[pagination_and_search_integration.md]]
---

You’re absolutely right that pagination is the pain point here – the plan goes in a good direction, but there are some sharp edges worth calling out.

I’ll go through it in three layers:

1. How this fits your *actual* backend as it exists now
2. Merits and downsides of the **ID caching** strategy
3. Merits and downsides of the **SearchResultContext / “Open as list”** feature

---

## 1. Reality check: how things work today

From the code:

* `/api/datasets/{id}/clusters` → `clustering.list_clusters(dataset_id, limit, offset)`
* `/api/datasets/{id}/agents` → `agents.list_agents(dataset_id, limit, offset)` 

On each call:

* `list_clusters` runs `_anchor_work_ids(store, limit, offset)` which:

  * Does a SPARQL pass to find *anchor works* + cluster targets.
  * Does another SPARQL to list **all** works + their ARKs.
  * Builds `anchor_ids` and `independent_ids`, sorts, then slices.
* `list_agents` runs a SPARQL over **all agents**, collects all `record_id`s, sorts, then slices. 

So your plan’s problem statement is exactly right:

* Full-table scans on every page
* Sort of the whole id-set each time
* No reuse of ordering between requests

Given that the frontend is paging with `page` and `limit`, you’re paying O(N) per request instead of O(limit).

---

## 2. Server-side ID cache (PaginationCache)

### 2.1. Strong points

**a. Huge perf win for browse workflows**

Once you compute the ordered list of IDs for a dataset/context:

* Each page is just:

  * `ids[offset:offset+limit]`
  * Hydrate those IDs via `_load_entities` (which is already how you work).

For a curation tool where:

* Users spend time paging/filtering/browsing,
* But actual writes (update_record, ingest_csv, swap_anchor, etc.) are much rarer,

this “expensive first hit, then cheap pages” model is a very good match.

**b. Minimal disruption to existing logic**

You don’t have to change the semantics of:

* cluster ordering (anchors first, then independents)
* how clusters are constructed, or how expression/manifestation trees are built

You just split `_anchor_work_ids` / `_agent_ids` into:

* “build full ordered id list”
* “slice the list (or read from cache)”

The rest of `list_clusters` and `list_agents` can stay almost untouched.

**c. Simple and explicit invalidation model**

The plan’s **invalidate-on-write** strategy is exactly the right default:

* `db.update_record` already applies guard logic, rewrites quads, flushes, then `datasets.touch_dataset(dataset_id)` 
* `anchor_swap.swap_cluster_anchor` also mutates the store then calls `datasets.touch_dataset(dataset_id)`
* `ingest_csv` ingests all records, flushes, then touches the dataset. 

If you hook `PaginationCache.invalidate(dataset_id)` inside **`datasets.touch_dataset`**, you automatically invalidate whenever:

* Records are ingested
* Records are updated
* Cluster swaps and similar operations persist changes
* Dataset is re-clustered (`mark_clustered` also updates metadata)

That gives you a single, low-level, robust invalidation point instead of sprinkling invalidation calls across each FastAPI route.

**d. Fits nicely with your global `_STORE_LOCK`**

You already serialize access to the Oxigraph Store with `_STORE_LOCK`.

If `PaginationCache` is accessed *inside* the same lock when building the initial ID list, you avoid subtle races between:

* Writing a record
* Rebuilding / populating cache

So concurrency is conceptually straightforward.

---

### 2.2. Risks and rough edges

**a. Memory usage and unbounded contexts**

The plan proposes an in-memory dict:

`(dataset_id, context_id) -> List[str]`

Concerns:

* Large datasets = large ID lists = RAM blowup if:

  * Many datasets open
  * Many search contexts per dataset
* No eviction strategy is described.

**Mitigation / recommendation**

* Add a basic policy:

  * Global max number of contexts (e.g. 100–200).
  * LRU eviction when exceeded.
  * Optional max number of IDs per context (e.g. 100k) – if exceeded, either:

    * Refuse to create that context, or
    * Require the user to refine the query.
* Track per-dataset size so one monstrous dataset can’t starve others.

This doesn’t add much complexity but saves you from “oh, someone just built a context of 1M IDs and now this worker is on its knees”.

---

**b. Multi-process / multi-node deployments**

As written, `PaginationCache` is in-memory only. That’s fine **if** you’re running:

* A single Uvicorn worker, single process.

But if you scale to:

* Gunicorn with multiple workers, or
* Multiple pods/containers,

then:

* The cached ID lists exist per process.
* A `contextId` created on worker A does **not** exist on worker B.

Effects:

* Performance: first page on each worker is “slow” (full indexing).
* Functionality: search contexts (`contextId`) can randomly be “not found” if the next HTTP request hits a different worker.

**Mitigation options, ordered by effort:**

1. **Document the constraint**: “Vendange backend currently expects a single process; multi-worker deployments will degrade ‘Open as list’ UX.” (cheap, but honest).

2. **Stick cache into a tiny on-disk store per dataset**:

   * e.g. JSON file `datasets/<dataset_id>/pagination_index_*.json`, parallel to your existing datasets directory layout.
   * Still not cross-node, but at least cross-worker on the same host.

3. **External shared cache** (Redis, etc.): more ops overhead but fully solves this.

Given the size and scope of Vendange, I’d probably start with (1) or (2).

---

**c. Cache invalidation granularity vs simplicity**

The plan says “invalidate cache on any write” (update_record, ingest, swap_anchor, etc.).

This is conceptually simple, but:

* Some writes don’t change the relevant listing at all (e.g. editing a title doesn’t affect cluster/agent membership or ordering).
* You still pay the full re-indexing cost after *any* change.

This is likely acceptable for your domain (curation != high-frequency writes), but three tweaks could help:

1. **Scope invalidation per type**:

   * Maintain separate caches:

     * `default_works`, `default_agents`
     * plus search contexts
   * When you know you only touched an agent, you can **optionally** invalidate only agent-related contexts.

   This is easily implementable: `PaginationCache.invalidate(dataset_id, prefix="agents")`.

2. **Instrument reindex time**:

   * Log “pagination index rebuilt” with:

     * dataset_id
     * context
     * number of IDs
     * time taken
   * If it’s consistently cheap, don’t over-optimise. If it’s seconds+ for real datasets, you may want more nuance later.

3. **Leave smarter invalidation as future work**:

   * The simple model is good enough now; make sure the interfaces make it *possible* to improve later.

---

**d. First-load latency and UX**

The first time someone opens clusters/agents after:

* Ingest
* Major edit session
* Cluster recalculation

they’ll pay the full “build ID list” cost.

Today they already pay this cost *every* time; with caching it becomes “only after changes”.

So you’re strictly better off than today performance-wise, but:

* It might be worth signalling this to the user (spinner / “Updating view…” on the frontend), because after a big write, first browse can be a bit slower than subsequent ones.

Not strictly a backend issue, but relevant to perceived quality.

---

**e. Thread-safety of the cache itself**

You already have `_STORE_LOCK` for the store; make sure `PaginationCache`:

* Uses its own lock or reuses `_STORE_LOCK` for mutation.
* Doesn’t do any I/O while holding the lock beyond what you already do.

Given your current pattern of doing all SPARQL accesses under `_STORE_LOCK`, hanging the cache builds (`if not cached: build+save`) under the same lock is safe and simple.

---

## 3. “Search results as context” / `SearchResultContext`

### 3.1. Strong points

Your plan to treat search results as *just another context* in the same caching system is very elegant:

* A search context is: ordered `List[str]` of record IDs.
* You push the IDs into a back-end endpoint, which:

  * Creates a `contextId` (UUID).
  * Stores the ordered IDs in `PaginationCache` under `(dataset_id, contextId)`.
  * Returns `contextId` to the client.

Then:

* `WorkspaceView / AgentView` call `GET /clusters` or `/agents` with `contextId` to page through the same id list. 

Merits:

* **Reuses** all paging machinery: `limit`, `offset`, hydration, arkLabels, etc.
* Keeps search semantics on the SPARQL side and display semantics on the list side.
* Very user-friendly: “Run arbitrary SPARQL → click a column → browse like a normal list”.

This is the nicest part of the whole proposal.

---

### 3.2. Risks / edge cases

**a. Very large result sets**

Frontend sending `ids: string[]` in JSON can be expensive:

* Network cost and request parsing overhead grow with number of IDs.
* If someone runs a query that hits 500k works and clicks “Open as list”, you’ve just serialised 500k IDs.

**Mitigations:**

* Hard limit on size of `ids` payload you accept (e.g. 50k IDs).
* If the client wants more:

  * Either refuse and show a message (“Result set too large to open as list; refine your query”), or
  * Introduce a secondary mode where you send a *query* plus column name instead of IDs (but then you must re-execute the SPARQL server-side, which your plan explicitly wants to avoid).

Given the goal of robustness, I’d start with “hard limit + explicit error” – it keeps behaviour predictable.

---

**b. Context lifetime & invalidation semantics**

When dataset data changes, it’s not just the default contexts that become stale – `SearchResultContext`s are too:

* Some IDs may disappear (deleted)
* Cluster membership, ark labels, etc. might change.

If you implement `PaginationCache.invalidate(dataset_id)` → clear *all* contexts for that dataset, then:

* `contextId`s become invalid after a write.
* The next call with that `contextId` should probably return 404 / “context expired” so the frontend can offer to re-run the search.

That’s not a bug; it’s a reasonable trade-off. But it’s an important **contract** to define:

* Contexts are **ephemeral** and **dataset-version-specific**.
* Any write may invalidate them.

---

**c. Multi-process inconsistency (again)**

Same issue as above but more user-visible for contexts:

* `contextId` created via `POST /search_context` on worker A.
* User bookmarks or navigates, later hits `/clusters?contextId=X` on worker B.
* Worker B’s cache doesn’t know about `X` → you must decide:

  * Return a 404ish error: “context not found/expired”.
  * Or silently rebuild from somewhere else (disk/Redis).

Returning a clear “expired context” error is fine if this is rare; but on multi-worker setups without shared cache it could be *frequent* and feel flaky.

---

**d. Security / boundaries (minor)**

Right now datasets appear to be in a single-tenant context (no auth in the snippets).

If you introduce contexts keyed by:

* `(dataset_id, contextId)`

then:

* As long as you always check `dataset_id` + `contextId` combos, you won’t leak anything across datasets.
* Given there’s no per-user auth in the backend, per-user isolation isn’t a concern *yet* – but if you ever add users, you’ll want to include a `user_id` dimension in the cache key space.

Right now this is more “future you” than “today you”, but worth keeping in mind.

---

## 4. Concrete implementation advice for *this* codebase

If I were to implement your plan within Vendange as it stands, I’d do:

### 4.1. PaginationCache API

Create a small module, e.g. `pagination_cache.py`, with something like:

```python
@dataclass
class CacheEntry:
    ids: list[str]
    created_at: float
    last_access_at: float
    kind: str  # "default_works" | "default_agents" | "search_work" | ...

class PaginationCache:
    _lock = threading.RLock()
    _entries: dict[tuple[str, str], CacheEntry] = {}
    _max_entries = 200
    _max_ids_per_entry = 100_000

    @classmethod
    def get(cls, dataset_id: str, context_id: str) -> Optional[list[str]]:
        # update last_access_at, enforce eviction, etc.

    @classmethod
    def put(cls, dataset_id: str, context_id: str, ids: list[str], kind: str) -> None:
        # enforce max_ids_per_entry, then store + maybe evict LRU

    @classmethod
    def invalidate_dataset(cls, dataset_id: str, kind_prefix: str | None = None) -> None:
        # delete all keys starting with dataset_id and matching prefix
```

Then:

* Default contexts: `context_id = "default_works"` / `"default_agents"`.
* Search contexts: random UUIDs.

---

### 4.2. Hook invalidation at the **dataset** level

In `datasets.touch_dataset(dataset_id)` add:

```python
from .pagination_cache import PaginationCache

def touch_dataset(dataset_id: str) -> None:
    with _METADATA_LOCK:
        ...
        meta.updated_at = _now_iso()
        ...
        _save_metadata_unlocked(data.values())
    PaginationCache.invalidate_dataset(dataset_id)
```

Because:

* All meaningful writes already call `touch_dataset` after they change the store.
* Some purely-metadata ops (rename dataset, mark_clustered) will also invalidate cache – which is harmless (slightly more rebuilding, but simple and safe).

---

### 4.3. Refactor pagination in `clustering.py` and `agents.py`

For `clustering`:

* Split `_anchor_work_ids` into:

```python
def _all_anchor_and_independent_ids(store) -> list[str]:
    # current SPARQL logic, but returns full ordered list (no slicing)
```

* Add a helper:

```python
def _get_work_ids_for_context(dataset_id: str, context_id: str | None, limit: int, offset: int) -> tuple[list[str], int]:
    with _STORE_LOCK:
        store = get_store_locked(dataset_id)
        cid = context_id or "default_works"
        ids = PaginationCache.get(dataset_id, cid)
        if ids is None:
            ids = _all_anchor_and_independent_ids(store)
            PaginationCache.put(dataset_id, cid, ids, kind="default_works" if not context_id else "search_work")
        total = len(ids)
        start = max(offset, 0)
        end = start + max(limit, 1)
        return ids[start:end], total
```

* Update `list_clusters` to call `_get_work_ids_for_context(...)` instead of `_anchor_work_ids(...)`.

Similarly for `agents`:

* Build `ids = _all_agent_ids(store)` once, cache it, then slice; `list_agents` already hydrates via `_load_entities`.

---

### 4.4. New `POST /search_context` endpoint

In `app.py`:

* Add:

```python
class PaginationContextPayload(BaseModel):
    ids: List[str]
    type: Literal["work", "agent"]

@app.post("/api/datasets/{dataset_id}/search_context")
def create_search_context(dataset_id: str, payload: PaginationContextPayload):
    _ensure_dataset(dataset_id)
    # sanity checks on len(ids) etc.
    context_id = str(uuid.uuid4())
    kind = f"search_{payload.type}"
    PaginationCache.put(dataset_id, context_id, payload.ids, kind=kind)
    return {"contextId": context_id}
```

* Extend `/clusters` and `/agents` to accept `contextId: Optional[str]` and pass it through to `list_clusters` / `list_agents`.

You already have `execute_query` for SPARQL; this new endpoint sits cleanly next to it.

---

## 5. Overall verdict

**Conceptually, the plan is solid and fits your codebase well.**

Big pluses:

* Directly addresses the real bottleneck (recomputing ID sets every time).
* Plays nicely with your read-heavy / write-light usage pattern.
* Uses a simple, understandable invalidation model.
* Enables a very nice UX (“Open SPARQL result column as list”) with minimal extra backend machinery.

Key things I’d tighten before/while implementing:

1. Put invalidation in a **single low-level place** (`datasets.touch_dataset`) rather than in each route.
2. Add **capacity limits and maybe LRU** to `PaginationCache`.
3. Decide and clearly document behaviour in **multi-worker** setups and for **expired search contexts**.
4. Enforce a **max result size** for “Open as list” contexts to avoid “send half a million IDs as JSON”.

If you do those, this is a high-value, low-regret change for Vendange.
