# Code hygiene report

## Duplication to address
- Manual clustering rules for works vs. expressions mirror each other (validation of pending sources, parent checks, toast flows). Consider a shared utility that receives entity-specific predicates (e.g., parent compatibility, anchor protection) to cut the parallel branches down to a single flow.
- Context‑menu plumbing and record opening logic is duplicated between Intermarc links and list rows. A dedicated hook that registers the listeners once and exposes `openRecordByArk` / `openRecordFromRow` would simplify `WorkspaceView` and detached windows alike.

## Bloat & structure
- `src/app/components/WorkspaceView.tsx` is slimmer (from ~1,560 to ~970 LOC) but still above the 500‑line target. The remaining bulk is mostly UI orchestration (scroll sync, context menu wiring, layout rendering). Next steps:
  - Extract list/detail/backlinks panel layout into a presentational component.
  - Move scroll/auto-focus and context-menu effects into a hook (e.g., `useWorkspaceInteractions`).
- `src/app/components/WorkspaceTabs.tsx` and `src/app/components/WorkspaceView.tsx` both manage shortcut handling; centralizing shortcut wiring would reduce repetition and ease detached-window sync.