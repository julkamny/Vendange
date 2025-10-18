import { useState } from 'react'
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
import { SearchProvider } from './app/search/context'
import { SearchModal } from './app/components/SearchModal'

function App() {
  return (
    <ThemeProvider>
      <ShortcutProvider>
        <ToastProvider>
          <AppDataProvider>
            <SearchProvider>
              <AppShell />
            </SearchProvider>
          </AppDataProvider>
        </ToastProvider>
      </ShortcutProvider>
    </ThemeProvider>
  )
}

function AppShell() {
  const { t } = useTranslation()
  const { clusters, exportCurated } = useAppData()
  const [toolbarVisible, setToolbarVisible] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [shortcutOpen, setShortcutOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  return (
    <div className={`app-shell${toolbarVisible ? ' toolbar-open' : ''}`}>
      <Toolbar
        visible={toolbarVisible}
        onToggleVisible={() => setToolbarVisible(prev => !prev)}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenShortcuts={() => setShortcutOpen(true)}
        onExport={exportCurated}
        exportDisabled={!clusters.length}
      />
      <main className="app-main">
        <WorkspaceTabs shortcutModalOpen={shortcutOpen} />
      </main>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ShortcutModal open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <footer className="app-footer">
        <span>{t('app.title')}</span>
      </footer>
    </div>
  )
}

export default App
