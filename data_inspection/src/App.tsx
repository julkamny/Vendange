import { useEffect, useState } from 'react'
import './App.css'
import './app/style.css'
import { AppDataProvider, useAppData } from './app/providers/AppDataContext'
import { ToastProvider } from './app/providers/ToastContext'
import { WorkspaceTabs } from './app/components/WorkspaceTabs'
import { useTranslation } from './app/hooks/useTranslation'
import { ThemeProvider } from './app/providers/ThemeContext'
import { Toolbar } from './app/components/Toolbar'
import { UploadModal } from './app/components/UploadModal'
import { ShortcutModal } from './app/components/ShortcutModal'
import { ShortcutProvider } from './app/providers/ShortcutContext'
import { DatasetDashboard } from './app/components/DatasetDashboard'
import type { DatasetSummary } from './app/types'

function App() {
  const [view, setView] = useState<'dashboard' | 'inspection'>('dashboard')
  const [activeDataset, setActiveDataset] = useState<DatasetSummary | null>(null)

  const openInspection = (dataset: DatasetSummary) => {
    setActiveDataset(dataset)
    setView('inspection')
  }

  const goHome = () => {
    setView('dashboard')
  }

  return (
    <ThemeProvider>
      <ShortcutProvider>
        <ToastProvider>
          <AppDataProvider>
            {view === 'dashboard' ? <DatasetDashboard onOpenInspection={openInspection} /> : <AppShell onBack={goHome} dataset={activeDataset} />}
          </AppDataProvider>
        </ToastProvider>
      </ShortcutProvider>
    </ThemeProvider>
  )
}

type AppShellProps = {
  onBack?: () => void
  dataset?: DatasetSummary | null
}

function AppShell({ onBack, dataset }: AppShellProps) {
  const { t } = useTranslation()
  const { clusters, exportCurated } = useAppData()
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [atTop, setAtTop] = useState(true)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const handleScroll = () => {
      const top = window.scrollY <= 0
      setAtTop(top)
      if (!top && toolbarVisible) {
        setToolbarVisible(false)
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [toolbarVisible])

  return (
    <div className={`app-shell${toolbarVisible ? ' toolbar-open' : ''}`}>
      <Toolbar
        visible={toolbarVisible}
        atTop={atTop}
        onToggleVisible={() => setToolbarVisible(prev => !prev)}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenShortcuts={() => setShortcutOpen(true)}
        onExport={exportCurated}
        exportDisabled={!clusters.length}
        onNavigateHome={onBack}
      />
      <main className="app-main">
        <WorkspaceTabs shortcutModalOpen={shortcutOpen} />
      </main>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ShortcutModal open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <footer className="app-footer">
        <span>{t('app.title')}</span>
        {dataset ? <span className="app-footer__dataset">Base en cours&nbsp;: {dataset.title}</span> : null}
      </footer>
    </div>
  )
}

export default App
