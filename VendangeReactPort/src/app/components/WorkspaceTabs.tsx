import { useState, useCallback, type MouseEvent } from 'react'
import { WorkspaceView } from './WorkspaceView'
import type { WorkspaceTabState } from '../workspace/types'
import { DEFAULT_WORKSPACE_STATE } from '../workspace/types'
import { useTranslation } from '../hooks/useTranslation'

let tabSequence = 0

function createTab(title: string): WorkspaceTabState {
  return {
    id: `tab-${++tabSequence}`,
    title,
    ...DEFAULT_WORKSPACE_STATE,
  }
}

export function WorkspaceTabs() {
  const { t } = useTranslation()
  const [tabs, setTabs] = useState<WorkspaceTabState[]>(() => [createTab(t('workspace.tabDefault', { defaultValue: 'Workspace' }))])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')

  const addTab = useCallback(() => {
    const newTab = createTab(t('workspace.tabDefault', { defaultValue: 'Workspace' }))
    setTabs(prev => [...prev, newTab])
    setActiveId(newTab.id)
  }, [t])

  const closeTab = useCallback(
    (id: string) => {
      setTabs(prev => {
        if (prev.length <= 1) return prev
        const next = prev.filter(tab => tab.id !== id)
        if (!next.some(tab => tab.id === activeId)) {
          const fallback = next[next.length - 1]
          setActiveId(fallback.id)
        }
        return next
      })
    },
    [activeId],
  )

  const activate = useCallback((id: string) => setActiveId(id), [])

  const updateTabState = useCallback((id: string, updater: (prev: WorkspaceTabState) => WorkspaceTabState) => {
    setTabs(prev => prev.map(tab => (tab.id === id ? updater(tab) : tab)))
  }, [])

  const activeTab = tabs.find(tab => tab.id === activeId) ?? tabs[0]

  return (
    <div className="workspace-tabs">
      <div className="workspace-tab-bar" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`workspace-tab${tab.id === activeTab?.id ? ' is-active' : ''}`}
            role="tab"
            aria-selected={tab.id === activeTab?.id}
            onClick={() => activate(tab.id)}
          >
            <span>{tab.title}</span>
            {tabs.length > 1 && (
              <span
                className="close"
                role="button"
                aria-label={t('workspace.closeTab', { defaultValue: 'Close tab' })}
                onClick={(event: MouseEvent<HTMLSpanElement>) => {
                  event.stopPropagation()
                  closeTab(tab.id)
                }}
              >
                ×
              </span>
            )}
          </button>
        ))}
        <button className="workspace-tab add" onClick={addTab} aria-label={t('workspace.addTab', { defaultValue: 'Add tab' })}>
          +
        </button>
      </div>
      <div className="workspace-tab-content" role="tabpanel">
        {activeTab ? (
          <WorkspaceView
            state={activeTab}
            onStateChange={updater => updateTabState(activeTab.id, updater)}
          />
        ) : null}
      </div>
    </div>
  )
}
