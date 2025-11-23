import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import './app/style.css'
import { AppDataProvider, useAppData } from './app/providers'
import { ToastProvider } from './app/providers'
import { WorkspaceTabs } from './app/components/WorkspaceTabs'
import { useTranslation } from './app/hooks/useTranslation'
import { ThemeProvider } from './app/providers'
import { Toolbar } from './app/components/Toolbar'
import { ShortcutModal } from './app/components/ShortcutModal'
import { ShortcutProvider } from './app/providers'
import { DatasetDashboard } from './app/components/DatasetDashboard'
import type { DatasetSummary } from './app/types'
import { DetachedWindowProvider } from './app/providers'

function App() {
  return (
    <ThemeProvider>
      <ShortcutProvider>
        <ToastProvider>
          <DetachedWindowProvider>
            <AppDataProvider>
              <AppRouter />
            </AppDataProvider>
          </DetachedWindowProvider>
        </ToastProvider>
      </ShortcutProvider>
    </ThemeProvider>
  )
}

function AppRouter() {
  const [view, setView] = useState<'dashboard' | 'inspection'>('dashboard')
  const [activeDataset, setActiveDataset] = useState<DatasetSummary | null>(null)
  const [openingDatasetId, setOpeningDatasetId] = useState<string | null>(null)
  const { loadDataset, clearData } = useAppData()

  const pathDatasetId = useMemo(() => {
    if (typeof window === 'undefined') return null
    const slug = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
    return slug || null
  }, [])

  const openInspection = useCallback(async (dataset: DatasetSummary) => {
    setOpeningDatasetId(dataset.id)
    try {
      const summary = await loadDataset(dataset.id, { title: dataset.title })
      setActiveDataset(summary)
      setView('inspection')
      if (typeof window !== 'undefined') {
        window.history.pushState({ datasetId: summary.id }, '', `/${summary.id}`)
      }
    } catch {
      // loadDataset already reports the error
    } finally {
      setOpeningDatasetId(null)
    }
  }, [loadDataset])

  const openInspectionBySlug = useCallback(
    async (slug: string, pushState: boolean) => {
      setOpeningDatasetId(slug)
      try {
        const summary = await loadDataset(slug)
        setActiveDataset(summary)
        setView('inspection')
        if (pushState && typeof window !== 'undefined') {
          window.history.pushState({ datasetId: summary.id }, '', `/${summary.id}`)
        }
      } catch {
        // loadDataset toasts errors
      } finally {
        setOpeningDatasetId(null)
      }
    },
    [loadDataset],
  )

  const goHome = useCallback(() => {
    clearData()
    setActiveDataset(null)
    setView('dashboard')
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/')
    }
  }, [clearData])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const slug = pathDatasetId
    if (slug) {
      openInspectionBySlug(slug, false)
    }
    const onPop = () => {
      const nextSlug = window.location.pathname.replace(/^\//, '').replace(/\/$/, '')
      if (nextSlug) {
        openInspectionBySlug(nextSlug, false)
      } else {
        goHome()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [goHome, openInspectionBySlug, pathDatasetId])

  if (view === 'dashboard') {
    return <DatasetDashboard onOpenInspection={openInspection} openingDatasetId={openingDatasetId ?? undefined} />
  }

  return <AppShell onBack={goHome} dataset={activeDataset} />
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
        onOpenShortcuts={() => setShortcutOpen(true)}
        onExport={exportCurated}
        exportDisabled={!clusters.length}
        onNavigateHome={onBack}
      />
      <main className="app-main">
        <WorkspaceTabs shortcutModalOpen={shortcutOpen} />
      </main>
      <ShortcutModal open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <footer className="app-footer">
        <span>{t('app.title')}</span>
        {dataset ? <span className="app-footer__dataset">Base en cours&nbsp;: {dataset.title}</span> : null}
      </footer>
    </div>
  )
}

export default App
