import { createPortal } from 'react-dom'
import { WorkspaceView } from '../WorkspaceView'
import type { AgentTabState, ArkFilterSource, WorkspaceTabStateWorkspace } from '../../workspace/types'

type DetachedWorkspacePortalProps = {
  tab: WorkspaceTabStateWorkspace
  container: HTMLDivElement | null
  dockLabel: string
  onDock: () => void
  onStateChange: (updater: (prev: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenDetachedTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentDetachedTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  sharedPendingManifestationId?: string | null
  setSharedPendingManifestationId?: (next: string | null) => void
  workArkFilter?: string[] | null
  workArkFilterSource?: ArkFilterSource | null
  onClearWorkArkFilter?: () => void
}

export function DetachedWorkspacePortal({
  tab,
  container,
  dockLabel,
  onDock,
  onStateChange,
  onOpenTab,
  onOpenDetachedTab,
  onOpenAgentTab,
  onOpenAgentDetachedTab,
  sharedPendingManifestationId,
  setSharedPendingManifestationId,
  workArkFilter,
  workArkFilterSource,
  onClearWorkArkFilter,
}: DetachedWorkspacePortalProps) {
  if (!container) return null
  return createPortal(
    <div className="detached-workspace-shell">
      <header className="detached-workspace-shell__header">
        <button type="button" onClick={onDock}>
          {dockLabel}
        </button>
      </header>
      <WorkspaceView
        state={tab}
        mode="detached"
        onRequestDock={onDock}
        onStateChange={onStateChange}
        onOpenTab={onOpenTab}
        onOpenDetachedTab={onOpenDetachedTab}
        onOpenAgentTab={onOpenAgentTab}
        onOpenAgentDetachedTab={onOpenAgentDetachedTab}
        sharedPendingManifestationId={sharedPendingManifestationId}
        setSharedPendingManifestationId={setSharedPendingManifestationId}
        workArkFilter={workArkFilter}
        workArkFilterSource={workArkFilterSource}
        onClearWorkArkFilter={onClearWorkArkFilter}
      />
    </div>,
    container,
  )
}
