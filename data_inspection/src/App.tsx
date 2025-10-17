import { useState } from 'react'
import './App.css'
import './app/style.css'
import { AppDataProvider, useAppData } from './app/providers/AppDataContext'
import { WorkspaceTabs } from './app/components/WorkspaceTabs'
import { useTranslation } from './app/hooks/useTranslation'
import { ThemeProvider } from './app/providers/ThemeContext'
import { Toolbar } from './app/components/Toolbar'
import { UploadModal } from './app/components/UploadModal'
import { ShortcutModal } from './app/components/ShortcutModal'
import { ShortcutProvider } from './app/providers/ShortcutContext'

function App() {
  return (
    <ThemeProvider>
      <ShortcutProvider>
        <AppDataProvider>
          <AppShell />
        </AppDataProvider>
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

  return (
    <div className={`app-shell${toolbarVisible ? ' toolbar-open' : ''}`}>
      <Toolbar
        visible={toolbarVisible}
        onToggleVisible={() => setToolbarVisible(prev => !prev)}
        onOpenUpload={() => setUploadOpen(true)}
        onOpenShortcuts={() => setShortcutOpen(true)}
        onExport={exportCurated}
        exportDisabled={!clusters.length}
      />
      <main className="app-main">
        <WorkspaceTabs shortcutModalOpen={shortcutOpen} />
      </main>
      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <ShortcutModal open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <footer className="app-footer">
        <span>{t('app.title')}</span>
      </footer>
    </div>
  )
}

export default App
