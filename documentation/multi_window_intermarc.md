# Multi-window Intermarc Research

## Goals
- Allow an entity's `div.intermarc-view` (rendered inside `data_inspection/src/app/components/IntermarcEditor.tsx`) to be opened inside its own browser window while staying connected to the main Vendange inspection workspace.
- Keep every detached window synchronized with the `AppDataContext` store (`data_inspection/src/app/providers/AppDataContext.tsx`) and with the FastAPI backend so edits, refreshes, and background updates hydrate everywhere.
- Support multiple simultaneous windows, including “unmooring” `WorkspaceTabs` so catalogers can align several Intermarc panes across monitors.
- Preserve current keyboard shortcuts, theming, and CodeMirror behavior regardless of the window that hosts the editor.

## Current state snapshot
- `AppDataProvider` fetches a dataset via `fetchDatasetRecords`, keeps three copies (original, curated, baseline), and exposes mutations via callbacks such as `updateRecordIntermarc`. The provider already pushes each change back to the backend with `syncRecordUpdate`.
- `WorkspaceTabs` orchestrates the `WorkspaceView` (tree navigator, result grid, detail panel). Intermarc text is displayed with `IntermarcEditor`, whose scroll container uses the `div.intermarc-view` class and CodeMirror to render a pretty-printed version of a record.
- The UI is rendered in a single DOM tree. There is no concept of a detached workspace, so the tab system and `AppDataContext` live in one window.

## Problem statement
Clerks need to compare multiple Intermarc records side by side, sometimes across monitors. Jumping between tabs is inefficient. We need “pop-out“ windows that:
1. Show exactly the same Intermarc editor pane as the owning tab, with the ability to go fullscreen inside that new window.
2. React to any mutation (either triggered locally or pulled from the backend).
3. Remain controllable from the origin window (closing a detached window should reconcile its tab, focus, keyboard shortcuts, etc.).

## Windowing models evaluated

### 1. Portaled windows (recommended baseline)
- We keep a *single* React tree that owns all application state. Opening a window calls `window.open` and uses `createPortal` to render the existing `IntermarcEditor` subtree into the new document.
- Because the React component instance remains part of the same tree, it automatically reads `AppDataContext` without extra synchronization layers. Backend changes are already broadcast by React re-renders.
- UX: the “pop-out“ action can live next to the “expand” button inside the Intermarc pane. When detached, the original tab can show a placeholder with a “Re-dock“ button.
- Implementation sketch:
  ```tsx
  const DetachedIntermarcWindow = ({ recordId }: { recordId: string }) => {
    const record = useWorkspaceRecord(recordId)
    const { portalContainer, close } = useDetachedWindow({
      title: `${record.humanLabel} — Intermarc`,
      classNames: ['vendange-theme'],
    })
    return record ? createPortal(<IntermarcEditor record={record} onCancel={close} />, portalContainer) : null
  }
  ```
- Pros: minimal duplication, instantaneous sync, easy cleanup (just close the portal).
- Cons: the origin window must stay open because the entire React tree hosts the state. If the user closes the origin tab the detached windows disappear.

### 2. Standalone windows that bootstrap a mini React root
- Each `window.open` loads a lightweight HTML file that mounts a pared-down React bundle containing only the Intermarc editor shell.
- Data synchronization now requires an inter-window store. `AppDataContext` would publish “record-update” events into a shared channel, and the detached window would hydrate itself from that channel and by reusing the REST endpoints.
- Pros: detached windows keep running even if the origin tab is minimized or reloaded (provided we persist enough state in a shared store).
- Cons: more plumbing (routing, translations, theme, keyboard shortcuts) must be duplicated. It is harder to keep component implementations in sync.

### 3. “Unmoored tabs” (hybrid)
- Promote the `WorkspaceTabState` object into something that can either be rendered locally or remotely. Clicking “unmoor” removes it from the local tab bar, opens a new portal window, and renders the same `WorkspaceView` for that tab. That window can then go fullscreen for the Intermarc pane.
- This combines the UX the user hinted at (“each tab is a separate window”) with the portal strategy from option 1. When redocked, the window closes and the tab is inserted back into the bar.

Given the tight coupling between `WorkspaceTabs`, `AppDataContext`, and `IntermarcEditor`, **option 3 implemented with portals** provides the best balance between effort and capabilities. We can later upgrade to option 2 if we truly need windows that survive the origin page.

## Detailed architecture (portal-based)

1. **Window manager context**
   - Implement a `DetachedWindowManager` provider that owns an array of `DetachedWindowState` objects (`id`, `recordId`, `type`, `windowRef`).
   - `useDetachedWindow(recordId, kind)` opens a new window with `window.open('', '_blank', 'noopener,...')`, writes a bare HTML skeleton that imports the global stylesheet(s), and returns a `DocumentFragment` to use as the portal target.
   - Listen to `beforeunload` on the child window to clean up state and optionally re-dock the tab.

2. **UI affordances**
   - Add a “Pop out” icon button next to the existing expand and reset actions inside `IntermarcEditor`.
   - When a tab is detached, `WorkspaceTabs` should mark it as `mode: 'detached'` so keyboard shortcuts skip it and the original slot shows a `“Windowed in <title>”` message with a “Bring back” button.
   - Provide a “Full window” toggle inside the detached window that hides the tree/table panes and expands `.intermarc-view` to use the full viewport.

3. **State synchronization**
   - Because portals reuse the same React tree, no extra synchronization is needed for UI state.
   - For backend-driven refreshes, continue using the existing `loadDataset`/`refreshDataset` logic; every mounted `IntermarcEditor` (local or detached) will automatically re-render with the latest record because its props refer to objects stored inside `AppDataContext`.

4. **Hydrating backend changes into every window**
   - Ensure `AppDataContext` exposes an effect that listens to server-generated events announcing record updates (e.g., convert `/api/datasets/<id>/records` into an SSE endpoint, or poll when we know a collaborator is editing the same dataset).
   - After each update, notify the backend via `syncRecordUpdate`, and also broadcast it locally through a `BroadcastChannel`. This channel ensures multiple top-level browser tabs (should the user duplicate the interface) remain in sync.
   - Child windows receive the same React update because they are portals, not standalone apps. If we ever migrate to standalone windows, the `BroadcastChannel` will already be in place to hydrate them.

5. **Tab-to-window mapping**
   - Extend `WorkspaceTabState` with `mode: 'inline' | 'detached'` and `detachedWindowId?: string`.
   - When the user unmoors a tab, hand the tab’s identifier to the window manager. The child window renders a specialized `DetachedTabShell` that receives the tab state via props and draws the same `WorkspaceView`, but with CSS overrides that hide left/right panes unless the user toggles “split view”.

6. **Styles and fonts**
   - Use `document.adoptedStyleSheets` or copy `<link rel="stylesheet">` tags from the origin document so the detached window inherits Vendange’s CSS variables, CodeMirror theme, Monaco fonts, etc.
   - Mirror the current theme (light/dark) inside the child window by calling `ThemeProvider` with the same context value. Keep it synchronized via a `BroadcastChannel` message (“theme-changed”) so flipping the theme updates all windows.

## Alternative (standalone window) considerations
If we eventually need windows that live independently of the origin page, we can:
- Bundle a trimmed React entry point (e.g., `/popout.html`) that mounts only `ThemeProvider`, `ShortcutProvider`, `AppDataProvider`, and an `IntermarcWindow` route.
- Persist the current `AppDataState` (dataset id/title, curated record map, cluster indexes) in `IndexedDB`. When the popout window bootstraps, it reloads that state and subscribes to a shared `BroadcastChannel` to receive delta updates.
- Push backend-originated updates through SSE (`/api/datasets/<id>/events`). The main window listens to the stream and forwards each event over the broadcast channel, so every window refetches only the modified records.

## Libraries that help
- **`react-new-window`** or **`react-portal-window`**: eliminate boilerplate when rendering React portals into a child window and handle cleanup automatically.
- **`broadcast-channel`**: a robust wrapper around the browser `BroadcastChannel` API with fallbacks to `localStorage` and `IndexedDB`, ensuring state synchronization continues to work in Safari and older Chromium versions.
- **`zustand`** or **`valtio`** with `subscribeWithSelector`: both state libraries can be combined with `broadcast-channel` to keep detached windows in sync even if we move away from a single React tree.
- **`react-use` `useMedia` / `useFullscreen`**: makes it trivial to implement the “expand Intermarc pane to full window” affordance.
- **`yjs` + `y-websocket`** (stretch): if we later need collaborative editing of Intermarc fields, Yjs provides a CRDT we could use to keep CodeMirror documents in sync across windows and users.

## Implementation checklist
1. Extract the current Intermarc pane into a self-contained `IntermarcWindow` component whose only props are the `recordId` and callbacks.
2. Add a `DetachedWindowProvider` + `useDetachedWindow` hook that supports opening, re-docking, and tracking lifecycle events.
3. Instrument `WorkspaceTabs` so each tab knows whether it is inlined or detached, expose “pop out” and “re-dock” actions, and ensure keyboard shortcuts skip detached tabs unless their external window has focus.
4. Wire the `IntermarcWindow` to the manager: clicking “pop out” opens a detached window, while closing the window or clicking “re-dock” updates the tab state and cleans up any React portal.
5. Introduce a small broadcast service (wrapping `BroadcastChannel`) that relays dataset updates, theme changes, and shortcut focus hints so future standalone windows can reuse it.
6. Optional: create a `/popout.html` Vite entry point guarded by a feature flag to experiment with the standalone model without disrupting the current portal approach.

With this strategy, catalogers can instantly pop out any tab, stretch the editor to fullscreen, align several monitors, and trust that edits coming from the FastAPI backend or other local windows will be reflected everywhere without redundant fetches or complicated synchronization code.
