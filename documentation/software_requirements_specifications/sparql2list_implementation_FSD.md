## 1. Objective

Implement a **global ARK-based filter** driven by Sparnatural SPARQL results:

* User selects one or more SPARQL result columns that contain **work ARKs** or **agent ARKs**.
* Clicking a button:

  * Extracts all ARKs from the selected columns.
  * Activates a **global filter**:

    * For **works**: affects **all WorkspaceView tabs** (inline and detached).
    * For **agents**: affects **all AgentView tabs** (inline and detached).
* In the list views:

  * Clusters / independent entities **with at least one ARK match** remain fully visible; matching items are **visually highlighted**.
  * Clusters / independent entities **with no match** are **collapsed + dimmed**, not hidden.
  * **Double-clicking** a collapsed, out-of-scope cluster / independent entity unfolds it (toggle expand/collapse).
* Filter stays active across tabs until the user **explicitly clears it**.

**Important constraint: **frontend only**. No changes to `api/app.py` or backend clustering. All mapping ARK → cluster / independent entity must be done with data already available via existing hooks (`useWorkspaceWorks`, `useWorkspaceAgents`, etc.).

---

## 2. Scope & Non-Goals

### In scope

* New UI in **SparqlWorkspaceView** allowing:

  * Column selection for work / agent ARKs.
  * “Apply filter to workspace/agents” button.
* New **global ARK filter state** in `WorkspaceTabs`:

  * Applies to **all WorkspaceView** tabs (works side) and **all AgentView** tabs (agents side) for the current dataset.
  * Propagates to **detached windows**.
* Changes in **WorkspaceView** / **WorkListPanel** to:

  * Highlight matching works inside clusters and independent works.
  * Collapse + dim out-of-scope clusters / independent works.
  * Support double-click to unfold out-of-scope items.
* Analogous changes in **AgentView**: clusters + unclustered agents.

### Out of scope

* Any new or modified backend endpoints.
* Server-side recomputation of clusters based on ARK subset.
* Advanced cross-type logic (e.g. “filter agents by works ARKs”); we stick to **work ARKs → works**, **agent ARKs → agents**.

---

## 3. Behaviour – User Stories & Flows

### 3.1 From SPARQL results to global filter

1. User opens a **SPARQL tab** and runs a query.

2. Results show as a table (existing behaviour).

3. Below / above the table is a new section:

   * Multi-select for **Work ARK columns**.
   * Multi-select for **Agent ARK columns**.
   * One primary button: **“Apply ARK filter”**.

4. User selects columns:

   * Example: `?work_ark` in “Work ARK columns”; `?agent_ark` in “Agent ARK columns”.

5. User clicks **“Apply ARK filter”**:

   * Frontend extracts ARKs from all selected columns, normalises them, deduplicates.
   * Global **work ARK filter** or **agent ARK filter** is activated for the dataset.

6. Toast / banner feedback:

   * Example: “Filtering: 124 work ARKs from SPARQL tab ‘SPARQL 1’.”
   * Example: “Filtering: 37 agent ARKs from SPARQL tab ‘SPARQL 2’.”

### 3.2 When a work filter is active

* **All WorkspaceView tabs** (inline and detached, any `viewMode`) recognise that a **work ARK filter** is active.
* In **viewMode = 'works'**:

  * Clusters with ≥1 work whose ARK is in the filter are **in scope**:

    * Shown as usual.
    * Matching rows are **highlighted**.
  * Clusters with **no matching work ARK**:

    * Rendered as **collapsed + dimmed** by default.
    * Double-click on the cluster header toggles expand/collapse. When expanded, all cluster items become visible but remain dimmed.
  * Unclustered works whose ARK is in the filter:

    * Shown at full height; row visually highlighted.
  * Unclustered works with no matching ARK:

    * Dimmed; treated as “collapsed” (can be slightly compressed via CSS).
    * Double-click toggles collapsed/expanded style for that row only.
* A **banner** above the workspace list indicates:

  * That a SPARQL-driven subset is active.
  * How many ARKs are in scope.
  * A **“Clear work filter”** button.

### 3.3 When an agent filter is active

* **All AgentView tabs** (inline and detached) recognise that an **agent ARK filter** is active.
* In Agent list:

  * Clusters with ≥1 agent (anchor or cluster item) whose ARK is in the filter are **in scope**:

    * Shown fully; matching rows highlighted.
  * Clusters with **no matching agent ARK**:

    * Shown collapsed + dimmed; items hidden until user expands.
    * Double-click cluster header toggles expand/collapse for that cluster.
  * Unclustered agents with ARK in filter:

    * Highlighted row.
  * Unclustered agents with no match:

    * Dimmed + “collapsed style” (CSS).
    * Double-click toggles collapsed style.
* Banner in Agent view:

  * Shows that an agent subset is active.
  * Offers **“Clear agent filter”** button.

### 3.4 Filter lifetime & scope

* Filter state is per-**dataset session**:

  * Changing dataset (if supported) or reloading the app resets filters.
* Filter is **global per entity type**:

  * At most one **work ARK filter** and one **agent ARK filter** active at a time.
  * When user applies a new filter from SPARQL, it **replaces** previous ARKs for that entity type.
* Filter applies to:

  * All **current** WorkspaceView/AgentView tabs.
  * Any **new** tabs created afterwards while the filter remains active.
  * All **detached** workspace/agent windows.

Clearing the work/agent filter from any tab clears it for **all** tabs of that type.

---

## 4. Functional Requirements (FR)

### 4.1 SPARQL tab – ARK column selection & apply

**FR-1** – Add ARK column selection UI
In `SparqlWorkspaceView`:

* Above the result table, add a new panel:

  * Label: e.g. “Use SPARQL results to filter workspace / agents”.
  * Two multi-select controls:

    1. **Work ARK columns** – multi-select over result columns.
    2. **Agent ARK columns** – multi-select over result columns.

* Multi-select entries:

  * Display the column label as seen in the table header.
  * Internally store column key (e.g. variable name `?work` → column `'work'`).

* Optional heuristic (not required, but recommended):

  * Preselect columns that look like ARKs (values matching `/ark:/`).

**FR-2** – Persist ARK column choices in tab state
Extend `WorkspaceTabStateSparql`:

```ts
export type WorkspaceTabStateSparql = {
  // existing fields...
  arkFilterColumns: {
    work: string[];   // column keys selected as work ARKs
    agent: string[];  // column keys selected as agent ARKs
  };
}
```

* `createDefaultSparqlState` initialises `arkFilterColumns` to `{ work: [], agent: [] }`.
* The multi-selects read/write `state.arkFilterColumns`.

**FR-3** – Apply ARK filter action
Add a button in `SparqlWorkspaceView`:

* Label: e.g. “Apply ARK filter to workspace”.
* State:

  * Disabled when:

    * No results (`state.result === null` or `rows.length === 0`), **or**
    * Both `arkFilterColumns.work` and `arkFilterColumns.agent` are empty.
* On click:

  * Extract ARKs from the selected columns (see §6.1).

  * Build payload:

    ```ts
    type ArkFilterPayload = {
      workArks: string[];    // deduped canonical ARKs
      agentArks: string[];   // deduped canonical ARKs
      source: {
        tabId: string;
        tabTitle: string;
        workColumns: string[];   // column names for UX
        agentColumns: string[];  // column names for UX
      };
    };
    ```

  * Call a new prop `onApplyArkFilter(payload)` provided by `WorkspaceTabs`.

**FR-4** – Feedback
After successful apply:

* Show toast:

  * Example (i18n): “Workspace filtered to 124 works and 37 agents from SPARQL tab ‘…’”.
* SPARQL tab stays open, selections preserved.

### 4.2 Global ARK filter state in WorkspaceTabs

**FR-5** – Global filter state
In `WorkspaceTabs`, maintain:

```ts
type ArkFilterSource = {
  tabId: string;
  tabTitle: string;
  workColumns: string[];
  agentColumns: string[];
};

type GlobalArkFilterState = {
  workArks: string[];     // empty = no work filter
  agentArks: string[];    // empty = no agent filter
  source: ArkFilterSource | null;
};

const [arkFilter, setArkFilter] = useState<GlobalArkFilterState>({
  workArks: [],
  agentArks: [],
  source: null,
});
```

**FR-6** – Applying new filter updates global state

```ts
function applyGlobalArkFilter(payload: ArkFilterPayload) {
  setArkFilter({
    workArks: dedupe(payload.workArks),
    agentArks: dedupe(payload.agentArks),
    source: {
      tabId: payload.source.tabId,
      tabTitle: payload.source.tabTitle,
      workColumns: payload.source.workColumns,
      agentColumns: payload.source.agentColumns,
    },
  });
}
```

* If `payload.workArks` or `payload.agentArks` is empty, that side is considered “no active filter”.
* Applying a new filter **replaces** the previous filter state, not merged.

**FR-7** – Clear functions

* New helpers in `WorkspaceTabs`:

```ts
function clearWorkArkFilter() {
  setArkFilter(prev => {
    if (!prev) return prev;
    const next = { ...prev, workArks: [] };
    if (!next.agentArks.length) return { workArks: [], agentArks: [], source: null };
    return next;
  });
}

function clearAgentArkFilter() {
  setArkFilter(prev => {
    if (!prev) return prev;
    const next = { ...prev, agentArks: [] };
    if (!next.workArks.length) return { workArks: [], agentArks: [], source: null };
    return next;
  });
}
```

**FR-8** – Propagate to **all** tabs of relevant type

* For each inline **WorkspaceView** in `WorkspaceTabs`:

```tsx
<WorkspaceView
  // existing props...
  workArkFilter={arkFilter.workArks.length ? arkFilter.workArks : null}
  workArkFilterSource={arkFilter.source && arkFilter.workArks.length ? arkFilter.source : null}
  onClearWorkArkFilter={clearWorkArkFilter}
/>
```

* For each inline **AgentView**:

```tsx
<AgentView
  // existing props...
  agentArkFilter={arkFilter.agentArks.length ? arkFilter.agentArks : null}
  agentArkFilterSource={arkFilter.source && arkFilter.agentArks.length ? arkFilter.source : null}
  onClearAgentArkFilter={clearAgentArkFilter}
/>
```

* For **DetachedWorkspacePortal** and **DetachedAgentPortal**, forward the same props:

  * Update their prop types to include `workArkFilter`, `workArkFilterSource`, `onClearWorkArkFilter` (for workspace) and analogous for agents.
  * Pass these down to `WorkspaceView` / `AgentView` inside the portals.

> **Explicit requirement:**
> When a work ARK filter is active, it **must apply to all WorkspaceView tabs**, inline and detached, until cleared.
> When an agent ARK filter is active, it **must apply to all AgentView tabs**, inline and detached, until cleared.

### 4.3 WorkspaceView – list behaviour with work ARK filter

**FR-9** – New props in `WorkspaceView`

Extend `WorkspaceViewProps`:

```ts
type WorkspaceViewProps = {
  // existing props...
  workArkFilter?: string[] | null;
  workArkFilterSource?: ArkFilterSource | null;
  onClearWorkArkFilter?: () => void;
};
```

These are optional; existing callers can pass nothing.

**FR-10** – Filter banner in WorkspaceView header

* In `WorkspaceView`, within `<header className="workspace-view__header">`:

  * If `workArkFilter` is non-null and non-empty:

    * Show a small banner / pill (e.g. `div.workspace-filter-banner`) with:

      * A text like:
        “Filtered by SPARQL subset – {workArkFilter.length} work ARKs in scope”.
      * If available: “Source: SPARQL tab ‘{source.tabTitle}’, columns: {source.workColumns.join(', ')}”.
      * A button: **“Clear work filter”** calling `onClearWorkArkFilter`.

**FR-11** – Pass filter to WorkListPanel

* `WorkspaceView` builds `mappedClusters` and `unclusteredWorks` as currently.
* When `state.viewMode === 'works'`, call `renderListPanel` with `WorkListPanel` but pass new props:

```tsx
<WorkListPanel
  state={state}
  clusters={mappedClusters}
  unclusteredWorks={unclusteredWorks}
  // existing props...
  workArkFilter={workArkFilter ?? null}
/>
```

(Exact signature of `WorkListPanel` may differ; adapt as needed.)

**FR-12** – Soft filtering & highlight in WorkListPanel

Extend `WorkListPanel`:

* New prop: `workArkFilter?: string[] | null`.

* Behaviour:

  1. Internally build `const filterSet = new Set(normalizeArkList(workArkFilter))`.

  2. For each **cluster**:

     * Compute:

       ```ts
       const anchorArks = [cluster.anchor_ark].filter(Boolean);
       const itemArks = cluster.items.map(i => i.ark).filter(Boolean);
       const clusterArks = [...anchorArks, ...itemArks];
       const hasMatch = clusterArks.some(ark => filterSet.has(normalizeArk(ark)));
       ```

     * If `filterSet` is empty → `hasMatch` is ignored; list behaves as before.

     * If `filterSet` non-empty and `hasMatch === true`:

       * Cluster is **in scope**:

         * Do **not** auto-collapse.
         * No dimming CSS on container.
       * For visual emphasis:

         * For each row (anchor or item) where `ark` is in `filterSet`, add CSS class like `entity-row--filter-match`.

     * If `filterSet` non-empty and `hasMatch === false`:

       * Cluster is **out of scope**:

         * Apply classes `cluster--out-of-scope cluster--collapsed`.
         * Anchor row also gets `entity-row--out-of-scope`.
         * Items are hidden when collapsed (see §5.3).

  3. For each **unclustered work**:

     ```ts
     const isMatch = work.ark && filterSet.has(normalizeArk(work.ark));
     ```

     * If `isMatch`:

       * Add class `entity-row--filter-match`.
     * If not:

       * Add class `entity-row--out-of-scope entity-row--collapsed`.

**FR-13** – Double-click behaviour for out-of-scope entries

* `WorkListPanel` maintains internal state (per mount) for expanded out-of-scope entries:

  ```ts
  const [expandedOutOfScopeClusters, setExpandedOutOfScopeClusters] = useState<Set<string>>(new Set());
  const [expandedOutOfScopeWorks, setExpandedOutOfScopeWorks] = useState<Set<string>>(new Set());
  ```

* For **clusters**:

  * When `hasMatch === false` and filter active:

    * Determine `isExpanded = expandedOutOfScopeClusters.has(cluster.anchor_id)`.
    * If `isExpanded` is `false`:

      * Add `cluster--collapsed` and hide items.
    * `onDoubleClick` handler on cluster header:

      ```ts
      if (filterSet.size && !hasMatch) {
        // toggle expansion only, do not open expressions
        toggleExpandedOutOfScopeCluster(cluster.anchor_id);
        return;
      }
      // existing behaviour (open expressions) if filter inactive or cluster has matches
      onOpenExpressions(cluster.anchor_id);
      ```

* For **unclustered works**:

  * Similar pattern:

    * `isOutOfScope = filterSet.size && !isMatch`.
    * `isExpanded = expandedOutOfScopeWorks.has(work.id)`.
    * Apply `entity-row--collapsed` only when `isOutOfScope && !isExpanded`.
    * `onDoubleClick`:

      ```ts
      if (isOutOfScope) {
        toggleExpandedOutOfScopeWork(work.id);
        return;
      }
      // existing behaviour (e.g. open expressions, clustering, etc.)
      ```

* Expansion state is per list instance; doesn’t need to be stored in `WorkspaceTabStateWorkspace`.

**FR-14** – Other view modes

* When `viewMode !== 'works'` (expressions / manifestations), the ARK filter **does not change list scope** (no collapsing), but you may optionally:

  * Highlight expressions / manifestations linked to filtered work ARKs (nice to have).
  * Simplest acceptable behaviour: filter only affects **works view**; banner still visible to remind user that view is relative to a subset of works.

### 4.4 AgentView – list behaviour with agent ARK filter

**FR-15** – New props in AgentView

Extend `AgentViewProps`:

```ts
type AgentViewProps = {
  // existing props...
  agentArkFilter?: string[] | null;
  agentArkFilterSource?: ArkFilterSource | null;
  onClearAgentArkFilter?: () => void;
};
```

**FR-16** – Agent filter banner

* In `<header className="workspace-view__header">` of `AgentView`:

  * If `agentArkFilter` non-empty:

    * Render banner similar to workspace:

      * “Filtered agents by SPARQL subset – {agentArkFilter.length} ARKs in scope”.
      * Optional source description.
      * **“Clear agent filter”** button calling `onClearAgentArkFilter`.

**FR-17** – Soft filtering & highlight in AgentView list

In `AgentView`:

* After building `entries` (clusters + singles), build `filterSet` from `agentArkFilter` (normalised ARKs).

* For **clusters** (`renderCluster`):

  * Compute:

    ```ts
    const anchorArk = cluster.anchor_ark;
    const itemArks = cluster.items.map(item => item.ark).filter(Boolean);
    const hasMatch = !!filterSet.size && (
      (anchorArk && filterSet.has(normalizeArk(anchorArk))) ||
      itemArks.some(ark => filterSet.has(normalizeArk(ark)))
    );
    ```

  * If filter inactive (`filterSet.size === 0`): keep current behaviour.

  * If filter active:

    * When `hasMatch === true`:

      * Cluster is **in scope**.
      * For rows whose `ark` is in `filterSet`, add `entity-row--filter-match`.
    * When `hasMatch === false`:

      * Cluster is **out of scope**.
      * Render container with `cluster cluster--out-of-scope cluster--collapsed`.
      * Anchor row gets `entity-row--out-of-scope`.
      * Items hidden when collapsed.

* For **unclustered agents** (`renderUnclustered`):

  ```ts
  const isMatch = agent.ark && filterSet.has(normalizeArk(agent.ark));
  ```

  * If `isMatch`: add class `entity-row--filter-match`.
  * Else: `entity-row--out-of-scope entity-row--collapsed`.

**FR-18** – Double-click behaviour in Agent list

* Maintain in `AgentView`:

  ```ts
  const [expandedOutOfScopeAgentClusters, setExpandedOutOfScopeAgentClusters] = useState<Set<string>>(new Set());
  const [expandedOutOfScopeAgents, setExpandedOutOfScopeAgents] = useState<Set<string>>(new Set());
  ```

* For cluster header rows:

  * `onDoubleClick`:

    ```ts
    if (filterSet.size && !hasMatch) {
      toggleExpandedOutOfScopeAgentCluster(cluster.anchor_id);
      return;
    }
    // default behaviour (if any) when filter inactive or cluster has match
    ```

* For unclustered agents:

  * `onDoubleClick` toggles collapsed style for out-of-scope agents; no extra navigation.

---

## 5. Data & Type Changes

### 5.1 WorkspaceTabStateSparql

Add ARK column selection:

```ts
export type WorkspaceTabStateSparql = {
  // existing...
  arkFilterColumns: {
    work: string[];
    agent: string[];
  };
};
```

Initialised in `createDefaultSparqlState`.

### 5.2 WorkspaceTabs – new local types

Inside `WorkspaceTabs.tsx`:

```ts
type ArkFilterSource = {
  tabId: string;
  tabTitle: string;
  workColumns: string[];
  agentColumns: string[];
};

type GlobalArkFilterState = {
  workArks: string[];
  agentArks: string[];
  source: ArkFilterSource | null;
};
```

State:

```ts
const [arkFilter, setArkFilter] = useState<GlobalArkFilterState>({
  workArks: [],
  agentArks: [],
  source: null,
});
```

### 5.3 WorkspaceView & WorkListPanel props

* `WorkspaceViewProps` gains:

```ts
workArkFilter?: string[] | null;
workArkFilterSource?: ArkFilterSource | null;
onClearWorkArkFilter?: () => void;
```

* `WorkListPanel` gains:

```ts
workArkFilter?: string[] | null;
```

### 5.4 AgentView props

* `AgentViewProps` gains:

```ts
agentArkFilter?: string[] | null;
agentArkFilterSource?: ArkFilterSource | null;
onClearAgentArkFilter?: () => void;
```

---

## 6. Algorithms & Normalisation

### 6.1 ARK extraction from SPARQL results

Use / reuse `ARK_REGEX` already defined in `SparqlWorkspaceView`:

```ts
const ARK_REGEX = /ark:\/\S+/giu;
```

Define a local `normalizeArk` function (can live in `SparqlWorkspaceView` or a shared util):

```ts
function normalizeArk(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const match = trimmed.match(ARK_REGEX);
  const ark = match?.[0] ?? trimmed;
  return ark.toLowerCase();
}
```

Extraction logic:

```ts
function extractArksFromResult(result: SparqlQueryResult, columns: string[]): string[] {
  const set = new Set<string>();
  for (const row of result.rows) {
    for (const column of columns) {
      const value = (row as Record<string, unknown>)[column];
      const normalized = normalizeArk(value);
      if (normalized) set.add(normalized);
    }
  }
  return Array.from(set);
}
```

* Use for `workArks` (with `arkFilterColumns.work`) and `agentArks` (with `arkFilterColumns.agent`).

### 6.2 Matching in WorkspaceView / AgentView

To ensure consistency:

* For each `rec.ark` or `cluster.anchor_ark`, always call `normalizeArk(ark)` before checking `filterSet.has(normalizedArk)`.

* Build filter sets as:

```ts
const filterSet = new Set((workArkFilter ?? []).map(a => a.toLowerCase()));
```

Same for agents.

---

## 7. Visual Design & CSS

Introduce new CSS classes (names illustrative; adapt to your naming):

* For **matches**:

  * `.entity-row--filter-match`

    * Slightly thicker border or accent color.
    * Optional tag/badge (e.g. “SPARQL subset”).

* For **out-of-scope**:

  * `.cluster--out-of-scope`
  * `.cluster--collapsed`
  * `.entity-row--out-of-scope`
  * `.entity-row--collapsed`

Suggested effects:

* Out-of-scope rows:

  * Reduced opacity (e.g. 0.5).
  * Smaller font size or muted text color.
* Collapsed clusters:

  * `display: none` for `.cluster-items` when collapsed.
* Collapsed independent rows:

  * Reduced padding / max-height; truncated text (`text-overflow: ellipsis`).

Banner:

* `.workspace-filter-banner`

  * Small bar under header with subtle background (e.g. pale yellow or blue).
  * Contains description + clear button.

Make sure:

* The **selected row** and **pending cluster source** styles still override or coexist with filter styles (e.g. `selected` + `entity-row--filter-match` can both be present).

---

## 8. Acceptance Criteria & Edge Cases

1. **Global scope**

   * Apply filter in a SPARQL tab that selects work ARKs.
   * Confirm **all workspace tabs** (existing and newly created) show banner and soft filtering in **works** view.
   * Detach a workspace tab and confirm detached window also uses the filter.
   * Clear filter from **one** workspace tab → banner gone and normal behaviour restored in **all** workspace tabs (including detached).

2. **Agent scope**

   * Apply filter selecting agent ARKs only.
   * All Agent tabs show banner and soft filtering, including detached windows.
   * Clearing agent filter from one tab clears for all agent tabs.

3. **Soft filtering**

   * With work filter active:

     * At least one cluster and one unclustered work with match: they remain expanded.
     * At least one cluster and one unclustered work with no match: they appear dimmed and collapsed.
     * Double-click on an out-of-scope cluster: items appear; double-click again: items collapse.
     * Double-click on an out-of-scope independent work: toggles its “collapsed” style.

4. **No-results / empty filter**

   * SPARQL query results in no rows → “Apply filter” disabled.
   * Columns chosen but none contain ARKs → extraction yields `[]`.

     * After applying, no banner should appear for that entity type (we treat this as no active filter).

5. **Mixed filters**

   * SPARQL result with both work and agent ARKs:

     * Workspace and Agent views are both filtered.
     * Clear only work filter → agent filter remains active, and vice versa.

6. **Keyboard shortcuts / navigation**

   * `navigateWorkList` and `navigateAgentList` still work meaningfully:

     * They should be able to navigate into out-of-scope entries even when dimmed/collapsed.
     * Collapsing is visual; rows remain in DOM.

7. **Performance**

   * Workspaces with many clusters:

     * Matching and class application runs inside `useMemo` or equivalent to avoid heavy recomputation on every render.
   * ARK matching uses `Set` lookups.