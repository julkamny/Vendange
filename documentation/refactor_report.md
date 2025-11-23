# Refactor & Hygiene Notes (November 2025)

## Changes made now
- Removed the legacy `inventory` list scope and hardwired workspace list handling to clusters only. Related translations and shortcut paths were cleaned up.
- Split oversized workspace logic: clustering state/guards now live in `src/app/components/workspace/useWorkspaceClustering.ts` and Intermarc save guards in `useIntermarcSaveGuards.ts`; shared UI bits (breadcrumbs, clustering modals) moved to dedicated components.
- Trimmed `workspace/shortcutActions.ts` by deleting unreachable inventory navigation code.

## Duplication to address
- Manual clustering rules for works vs. expressions still mirror each other (validation of pending sources, parent checks, toast flows). Consider a shared utility that receives entity-specific predicates (e.g., parent compatibility, anchor protection) to cut the parallel branches down to a single flow.
- Context‑menu plumbing and record opening logic is duplicated between Intermarc links and list rows. A dedicated hook that registers the listeners once and exposes `openRecordByArk` / `openRecordFromRow` would simplify `WorkspaceView` and detached windows alike.

## Bloat & structure
- `src/app/components/WorkspaceView.tsx` is slimmer (from ~1,560 to ~970 LOC) but still above the 500‑line target. The remaining bulk is mostly UI orchestration (scroll sync, context menu wiring, layout rendering). Next steps:
  - Extract list/detail/backlinks panel layout into a presentational component.
  - Move scroll/auto-focus and context-menu effects into a hook (e.g., `useWorkspaceInteractions`).
- `src/app/components/WorkspaceTabs.tsx` and `src/app/components/WorkspaceView.tsx` both manage shortcut handling; centralizing shortcut wiring would reduce repetition and ease detached-window sync.

## Quick wins
- `src/app/data/controlledListsData.ts` is massive but pure data; consider lazy-loading or splitting per list to keep bundle size manageable.
- Several workspace state fields (`inventoryFocus*`) now only support the cluster scope; pruning them (plus related memo deps) would simplify state updates further once downstream components are adjusted.
