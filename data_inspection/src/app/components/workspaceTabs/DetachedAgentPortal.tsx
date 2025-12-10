import { createPortal } from 'react-dom'
import { AgentView } from '../../agents/AgentView'
import type { AgentTabState, ArkFilterSource, WorkspaceTabStateWorkspace } from '../../workspace/types'

type DetachedAgentPortalProps = {
  tab: AgentTabState
  container: HTMLDivElement | null
  dockLabel: string
  onDock: () => void
  onStateChange: (updater: (prev: AgentTabState) => AgentTabState) => void
  onOpenTab: (initializer: (base: WorkspaceTabStateWorkspace) => WorkspaceTabStateWorkspace) => void
  onOpenAgentTab: (initializer: (base: AgentTabState) => AgentTabState) => void
  onOpenAgentTabDetached: (initializer: (base: AgentTabState) => AgentTabState) => void
  agentArkFilter?: string[] | null
  agentArkFilterSource?: ArkFilterSource | null
  onClearAgentArkFilter?: () => void
}

export function DetachedAgentPortal({
  tab,
  container,
  dockLabel,
  onDock,
  onStateChange,
  onOpenTab,
  onOpenAgentTab,
  onOpenAgentTabDetached,
  agentArkFilter,
  agentArkFilterSource,
  onClearAgentArkFilter,
}: DetachedAgentPortalProps) {
  if (!container) return null
  return createPortal(
    <div className="detached-workspace-shell">
      <header className="detached-workspace-shell__header">
        <button type="button" onClick={onDock}>
          {dockLabel}
        </button>
      </header>
      <AgentView
        state={tab}
        mode="detached"
        onRequestDock={onDock}
        onStateChange={onStateChange}
        onOpenTab={onOpenTab}
        onOpenAgentTab={onOpenAgentTab}
        onOpenAgentTabDetached={onOpenAgentTabDetached}
        agentArkFilter={agentArkFilter}
        agentArkFilterSource={agentArkFilterSource}
        onClearAgentArkFilter={onClearAgentArkFilter}
      />
    </div>,
    container,
  )
}
