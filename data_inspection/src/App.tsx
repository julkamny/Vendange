import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Outlet,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  useNavigate,
  type ErrorComponentProps,
} from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
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
import { queryClient } from './app/lib/queryClient'

type AppRouterContext = {
  appData: {
    loadDataset: (datasetId: string, options?: { title?: string }) => Promise<DatasetSummary>
    clearData: () => void
  }
}

const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
})

const dashboardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DashboardRoute,
})

const inspectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$datasetId',
  loader: async ({ params, context }) => {
    const summary = await context.appData.loadDataset(params.datasetId)
    return summary
  },
  component: InspectionRoute,
  errorComponent: DatasetError,
})

const routeTree = rootRoute.addChildren([dashboardRoute, inspectionRoute])

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  context: {
    appData: undefined as unknown as AppRouterContext['appData'],
  },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
    </QueryClientProvider>
  )
}

function AppRouter() {
  const { loadDataset, clearData } = useAppData()
  const context = useMemo(
    () => ({
      appData: { loadDataset, clearData },
    }),
    [clearData, loadDataset],
  )

  return <RouterProvider router={router} context={context} />
}

type AppShellProps = {
  onBack?: () => void
  dataset?: DatasetSummary | null
}

function AppShell({ onBack, dataset }: AppShellProps) {
  const { t } = useTranslation()
  const { exportCurated } = useAppData()
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
        exportDisabled={!dataset}
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

function RootLayout() {
  return <Outlet />
}

function DashboardRoute() {
  const { loadDataset, clearData } = useAppData()
  const navigate = useNavigate({ from: dashboardRoute.id })
  const [openingDatasetId, setOpeningDatasetId] = useState<string | null>(null)

  useEffect(() => {
    clearData()
  }, [clearData])

  const openInspection = useCallback(
    async (dataset: DatasetSummary) => {
      setOpeningDatasetId(dataset.id)
      try {
        const summary = await loadDataset(dataset.id, { title: dataset.title })
        await navigate({ to: '/$datasetId', params: { datasetId: summary.id } })
      } catch (error) {
        console.error('Failed to open dataset', error)
      } finally {
        setOpeningDatasetId(null)
      }
    },
    [loadDataset, navigate],
  )

  return <DatasetDashboard onOpenInspection={openInspection} openingDatasetId={openingDatasetId ?? undefined} />
}

function InspectionRoute() {
  const dataset = inspectionRoute.useLoaderData()
  const { clearData } = useAppData()
  const navigate = useNavigate({ from: inspectionRoute.id })

  const goHome = useCallback(() => {
    clearData()
    navigate({ to: '/' })
  }, [clearData, navigate])

  return <AppShell onBack={goHome} dataset={dataset} />
}

function DatasetError({ error }: ErrorComponentProps) {
  const { clearData } = useAppData()
  const navigate = useNavigate({ from: inspectionRoute.id })

  useEffect(() => {
    clearData()
  }, [clearData])

  return (
    <div className="app-shell">
      <main className="app-main" style={{ padding: '1.5rem' }}>
        <h1>Base introuvable</h1>
        <p>{error instanceof Error ? error.message : "Impossible d'ouvrir cette base."}</p>
        <button type="button" onClick={() => navigate({ to: '/' })}>
          Retour au tableau de bord
        </button>
      </main>
    </div>
  )
}

export default App
