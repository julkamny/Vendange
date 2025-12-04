import type { AgentTabState, WorkspaceTabStateWorkspace } from '../../workspace/types'
import { DEFAULT_AGENT_STATE, DEFAULT_WORKSPACE_STATE } from '../../workspace/types'

let tabSequence = 0

export function nextTabId(prefix: string) {
  tabSequence += 1
  return `${prefix}-${tabSequence}`
}

export function createWorkspaceTab(title: string, explicitId?: string): WorkspaceTabStateWorkspace {
  const id = explicitId ?? nextTabId('tab')
  return {
    ...DEFAULT_WORKSPACE_STATE,
    id,
    title,
  }
}

export function createAgentTab(title: string, explicitId?: string): AgentTabState {
  const id = explicitId ?? nextTabId('agent')
  return {
    ...DEFAULT_AGENT_STATE,
    id,
    title,
  }
}
