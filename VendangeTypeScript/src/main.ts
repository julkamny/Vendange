import './style.css'
import { parseCsv, stringifyCsv } from './lib/csv'
import {
  parseIntermarc,
  prettyPrintIntermarc,
  add90FEntries,
  findZones,
  resolveArkLabel,
  ARK_TOKEN_START,
  ARK_TOKEN_END,
} from './lib/intermarc'
import type { PrettyIntermarcResult } from './lib/intermarc'
import type { Intermarc } from './lib/intermarc'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import i18n, { initI18n, t, changeLanguage, supportedLanguages, getCurrentLanguage } from './i18n'

await initI18n()

type RecordRow = {
  id: string
  type: string
  typeNorm: string
  ark?: string
  rowIndex: number
  intermarcStr: string
  intermarc: Intermarc
  raw: string[]
}

type ClusterItem = { ark: string; id?: string; title?: string; accepted: boolean; date?: string }
type ManifestationItem = {
  id: string
  ark: string
  title?: string
  expressionArk: string
  expressionId?: string
  originalExpressionArk: string
}

type ExpressionItem = {
  id: string
  ark: string
  title?: string
  workArk: string
  workId?: string
  manifestations: ManifestationItem[]
}

type ExpressionClusterItem = ExpressionItem & {
  anchorExpressionId: string
  accepted: boolean
  date?: string
}

type ManifestationDragPayload = {
  clusterAnchorId: string
  sourceAnchorExpressionId: string | null
  sourceExpressionArk: string
  manifestationId: string
}

type SelectedEntity = {
  id: string
  source: 'curated' | 'original'
  entityType?: 'work' | 'expression' | 'manifestation' | 'person' | 'collective' | 'brand' | 'concept' | 'controlled'
  clusterAnchorId?: string
  isAnchor?: boolean
  workArk?: string
  expressionId?: string
  expressionArk?: string
}

type ExpressionAnchorGroup = {
  anchor: ExpressionItem
  clustered: ExpressionClusterItem[]
}

type Cluster = {
  anchorId: string
  anchorArk: string
  anchorTitle?: string
  items: ClusterItem[]
  expressionGroups: ExpressionAnchorGroup[]
  independentExpressions: ExpressionItem[]
}

type InventoryEntityType =
  | 'work'
  | 'expression'
  | 'manifestation'
  | 'person'
  | 'collective'
  | 'brand'
  | 'concept'
  | 'controlled'

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
    <button class="toolbar-toggle" id="toolbarToggle" type="button" aria-expanded="false" aria-controls="appToolbar" aria-label="${t('toolbarToggle.show')}">🛠️</button>
    <header class="toolbar toolbar-collapsed" id="appToolbar" data-collapsed="true">
      <div class="toolbar-left">
        <button id="uploadBtn" type="button">${t('toolbar.loadCsv')}</button>
        <button id="themeToggleBtn" type="button" aria-pressed="false">${t('toolbar.darkMode')}</button>
        <button id="shortcutBtn" type="button">${t('toolbar.shortcuts')}</button>
      </div>
      <div class="spacer"></div>
      <select id="languageSelect" class="language-select" aria-label="${t('language.ariaLabel')}"></select>
      <button id="exportBtn" disabled>${t('toolbar.export')}</button>
    </header>
    <main class="layout">
      <section class="panel list" id="clusters"></section>
      <section class="panel details" id="details"><em>${t('layout.loadPrompt')}</em></section>
    </main>
    <div class="drop-hint" id="dropHint"><div class="box">${t('layout.dropHint')}</div></div>
    <div class="modal-backdrop" id="uploadModal" hidden>
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="uploadModalTitle">
        <button type="button" class="modal-close" id="uploadCloseBtn" aria-label="${t('uploadModal.close')}">×</button>
        <h2 id="uploadModalTitle">${t('uploadModal.title')}</h2>
        <p class="modal-instructions">${t('uploadModal.instructions')}</p>
        <div class="modal-dropzone" id="uploadDropzone">
          <span>${t('uploadModal.drop')}</span>
          <small>${t('uploadModal.expected')}</small>
        </div>
        <div class="modal-inputs">
          <label class="modal-file">
            <span>${t('uploadModal.original')}</span>
            <input type="file" id="origFile" accept=".csv" />
          </label>
          <label class="modal-file">
            <span>${t('uploadModal.curated')}</span>
            <input type="file" id="curFile" accept=".csv" />
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" id="uploadClearBtn">${t('uploadModal.clear')}</button>
          <button type="button" id="uploadDismissBtn">${t('uploadModal.close')}</button>
        </div>
      </div>
    </div>
    <div class="modal-backdrop" id="shortcutModal" hidden>
      <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcutModalTitle">
        <button type="button" class="modal-close" id="shortcutCloseBtn" aria-label="${t('uploadModal.close')}">×</button>
        <h2 id="shortcutModalTitle">${t('shortcutsModal.title')}</h2>
        <p class="modal-instructions">${t('shortcutsModal.instructions')}</p>
        <div class="shortcut-list" id="shortcutList"></div>
        <div class="modal-actions">
          <button type="button" id="shortcutResetBtn">${t('shortcutsModal.reset')}</button>
          <button type="button" id="shortcutDoneBtn">${t('shortcutsModal.done')}</button>
        </div>
      </div>
    </div>
`

const toastHost = document.createElement('div')
toastHost.className = 'toast-host'
app.appendChild(toastHost)

const toolbarToggleBtn = document.getElementById('toolbarToggle') as HTMLButtonElement
const toolbarEl = document.getElementById('appToolbar') as HTMLElement
const uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement
const themeToggleBtn = document.getElementById('themeToggleBtn') as HTMLButtonElement
const shortcutBtn = document.getElementById('shortcutBtn') as HTMLButtonElement
const uploadModal = document.getElementById('uploadModal') as HTMLDivElement
const uploadDropzone = document.getElementById('uploadDropzone') as HTMLDivElement
const uploadCloseBtn = document.getElementById('uploadCloseBtn') as HTMLButtonElement
const uploadDismissBtn = document.getElementById('uploadDismissBtn') as HTMLButtonElement
const uploadClearBtn = document.getElementById('uploadClearBtn') as HTMLButtonElement
const shortcutModal = document.getElementById('shortcutModal') as HTMLDivElement
const shortcutCloseBtn = document.getElementById('shortcutCloseBtn') as HTMLButtonElement
const shortcutDoneBtn = document.getElementById('shortcutDoneBtn') as HTMLButtonElement
const shortcutResetBtn = document.getElementById('shortcutResetBtn') as HTMLButtonElement
const shortcutList = document.getElementById('shortcutList') as HTMLDivElement

const origInput = document.getElementById('origFile') as HTMLInputElement
const curInput = document.getElementById('curFile') as HTMLInputElement
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement
const languageSelect = document.getElementById('languageSelect') as HTMLSelectElement
const uploadModalTitle = document.getElementById('uploadModalTitle') as HTMLHeadingElement
const uploadInstructions = uploadModal.querySelector('.modal-instructions') as HTMLParagraphElement
const shortcutModalTitle = document.getElementById('shortcutModalTitle') as HTMLHeadingElement
const shortcutInstructions = shortcutModal.querySelector('.modal-instructions') as HTMLParagraphElement
const clustersEl = document.getElementById('clusters') as HTMLDivElement
const detailsEl = document.getElementById('details') as HTMLDivElement
const dropHint = document.getElementById('dropHint') as HTMLDivElement

let originalCsv: { headers: string[]; rows: string[][] } | null = null
let curatedCsv: { headers: string[]; rows: string[][] } | null = null
let originalRecords: RecordRow[] = []
let curatedRecords: RecordRow[] = []
let clusters: Cluster[] = []
let editorView: EditorView | null = null

const combinedRecordsByArk = new Map<string, RecordRow>()
const combinedRecordsById = new Map<string, RecordRow>()

let viewMode: 'works' | 'expressions' | 'manifestations' = 'works'
let activeWorkAnchorId: string | null = null
let highlightedWorkArk: string | null | undefined = undefined
let activeExpressionAnchorId: string | null = null
let highlightedExpressionArk: string | null = null
let expressionFilterArk: string | null = null
let selectedEntity: SelectedEntity | null = null
let pendingScrollEntity: SelectedEntity | null = null
let uploadModalOpen = false
let shortcutsModalOpen = false
let shortcutCaptureAction: ShortcutAction | null = null
let shortcutCaptureButton: HTMLButtonElement | null = null

const THEME_STORAGE_KEY = 'vendange:theme'
type ThemeMode = 'light' | 'dark'
let currentTheme: ThemeMode = 'dark'

type ShortcutAction =
  | 'focusUp'
  | 'focusDown'
  | 'listUp'
  | 'listDown'
  | 'openExpressionFilter'
  | 'openWorkFilter'

type ShortcutConfig = {
  action: ShortcutAction
  labelKey: string
  descriptionKey: string
  defaultBinding: string
}

const SHORTCUT_STORAGE_KEY = 'vendange:shortcuts'

const SHORTCUTS: ShortcutConfig[] = [
  {
    action: 'focusUp',
    labelKey: 'shortcuts.focusUp.label',
    descriptionKey: 'shortcuts.focusUp.description',
    defaultBinding: 'Ctrl+ArrowUp',
  },
  {
    action: 'focusDown',
    labelKey: 'shortcuts.focusDown.label',
    descriptionKey: 'shortcuts.focusDown.description',
    defaultBinding: 'Ctrl+ArrowDown',
  },
  {
    action: 'listUp',
    labelKey: 'shortcuts.listUp.label',
    descriptionKey: 'shortcuts.listUp.description',
    defaultBinding: 'ArrowUp',
  },
  {
    action: 'listDown',
    labelKey: 'shortcuts.listDown.label',
    descriptionKey: 'shortcuts.listDown.description',
    defaultBinding: 'ArrowDown',
  },
  {
    action: 'openExpressionFilter',
    labelKey: 'shortcuts.openExpressionFilter.label',
    descriptionKey: 'shortcuts.openExpressionFilter.description',
    defaultBinding: 'Ctrl+Alt+E',
  },
  {
    action: 'openWorkFilter',
    labelKey: 'shortcuts.openWorkFilter.label',
    descriptionKey: 'shortcuts.openWorkFilter.description',
    defaultBinding: 'Ctrl+Alt+W',
  },
]

let shortcutBindings: Record<ShortcutAction, string> = Object.fromEntries(
  SHORTCUTS.map(shortcut => [shortcut.action, shortcut.defaultBinding]),
) as Record<ShortcutAction, string>

let toolbarVisible = false
function setToolbarVisibility(visible: boolean) {
  toolbarVisible = visible
  toolbarEl.dataset.collapsed = String(!visible)
  toolbarEl.classList.toggle('toolbar-collapsed', !visible)
  toolbarToggleBtn.setAttribute('aria-expanded', String(visible))
  toolbarToggleBtn.classList.toggle('active', visible)
  const label = visible ? t('toolbarToggle.hide') : t('toolbarToggle.show')
  toolbarToggleBtn.setAttribute('aria-label', label)
  setTooltip(toolbarToggleBtn, label)
}
setToolbarVisibility(false)
toolbarToggleBtn.onclick = () => setToolbarVisibility(!toolbarVisible)

function populateLanguageSelect() {
  languageSelect.innerHTML = ''
  for (const lng of supportedLanguages) {
    const option = document.createElement('option')
    option.value = lng
    option.textContent = t(`language.options.${lng}`)
    languageSelect.appendChild(option)
  }
  languageSelect.value = getCurrentLanguage()
}

function applyStaticTranslations() {
  uploadBtn.textContent = t('toolbar.loadCsv')
  shortcutBtn.textContent = t('toolbar.shortcuts')
  exportBtn.textContent = t('toolbar.export')
  const dropHintBox = dropHint.querySelector('.box')
  if (dropHintBox) dropHintBox.textContent = t('layout.dropHint')
  uploadCloseBtn.setAttribute('aria-label', t('uploadModal.close'))
  uploadDismissBtn.textContent = t('uploadModal.close')
  uploadClearBtn.textContent = t('uploadModal.clear')
  uploadModalTitle.textContent = t('uploadModal.title')
  uploadInstructions.textContent = t('uploadModal.instructions')
  const dropLabel = uploadDropzone.querySelector('span')
  if (dropLabel) dropLabel.textContent = t('uploadModal.drop')
  const dropHintText = uploadDropzone.querySelector('small')
  if (dropHintText) dropHintText.textContent = t('uploadModal.expected')
  const origLabel = origInput.previousElementSibling as HTMLSpanElement | null
  if (origLabel) origLabel.textContent = t('uploadModal.original')
  const curLabel = curInput.previousElementSibling as HTMLSpanElement | null
  if (curLabel) curLabel.textContent = t('uploadModal.curated')
  shortcutCloseBtn.setAttribute('aria-label', t('uploadModal.close'))
  shortcutModalTitle.textContent = t('shortcutsModal.title')
  shortcutInstructions.textContent = t('shortcutsModal.instructions')
  shortcutResetBtn.textContent = t('shortcutsModal.reset')
  shortcutDoneBtn.textContent = t('shortcutsModal.done')
  populateLanguageSelect()
  updateThemeToggleButton()
  setToolbarVisibility(toolbarVisible)
}

uploadBtn.onclick = () => openUploadModal()
uploadCloseBtn.onclick = () => closeUploadModal()
uploadDismissBtn.onclick = () => closeUploadModal()
uploadClearBtn.onclick = () => {
  origInput.value = ''
  curInput.value = ''
}
uploadModal.addEventListener('click', event => {
  if (event.target === uploadModal) closeUploadModal()
})
uploadDropzone.addEventListener('dragover', event => {
  event.preventDefault()
  uploadDropzone.classList.add('dragging')
})
uploadDropzone.addEventListener('dragenter', event => {
  event.preventDefault()
  uploadDropzone.classList.add('dragging')
})
uploadDropzone.addEventListener('dragleave', event => {
  if (!(event instanceof DragEvent)) return
  const related = event.relatedTarget as Node | null
  if (related && uploadDropzone.contains(related)) return
  uploadDropzone.classList.remove('dragging')
})
uploadDropzone.addEventListener('drop', event => {
  event.preventDefault()
  uploadDropzone.classList.remove('dragging')
  const files = event.dataTransfer?.files
  if (files?.length) {
    processDroppedFiles(files)
  }
})

shortcutBtn.onclick = () => openShortcutModal()
shortcutCloseBtn.onclick = () => closeShortcutModal(true)
shortcutDoneBtn.onclick = () => closeShortcutModal(true)
shortcutResetBtn.onclick = () => resetShortcutBindingsToDefault()
shortcutModal.addEventListener('click', event => {
  if (event.target === shortcutModal) closeShortcutModal(true)
})

populateLanguageSelect()
languageSelect.addEventListener('change', () => {
  const next = languageSelect.value
  if (next && next !== getCurrentLanguage()) changeLanguage(next)
})

applyStaticTranslations()

i18n.on('languageChanged', () => {
  applyStaticTranslations()
  renderCurrentView()
  renderDetailsPanel()
  renderShortcutList()
})

const storedTheme = readStoredTheme()
loadShortcutBindings()
applyTheme(storedTheme ?? detectPreferredTheme())
themeToggleBtn.onclick = () => {
  applyTheme(currentTheme === 'dark' ? 'light' : 'dark')
}

window.addEventListener('keydown', handleGlobalKeydown)
window.addEventListener('keydown', event => {
  if (!shortcutsModalOpen || shortcutCaptureAction) return
  if (event.key === 'Escape') {
    event.preventDefault()
    closeShortcutModal(true)
  }
})

type NormalizedShortcut = {
  key: string
  ctrl: boolean
  alt: boolean
  shift: boolean
  meta: boolean
}

function normalizeShortcutString(binding: string): NormalizedShortcut | null {
  const parts = binding
    .split('+')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) return null
  const result: NormalizedShortcut = { key: '', ctrl: false, alt: false, shift: false, meta: false }
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') {
      result.ctrl = true
    } else if (part === 'alt' || part === 'option') {
      result.alt = true
    } else if (part === 'shift') {
      result.shift = true
    } else if (part === 'meta' || part === 'cmd' || part === 'command') {
      result.meta = true
    } else {
      result.key = part
    }
  }
  return result.key ? result : null
}

function shortcutMatchesEvent(binding: string, event: KeyboardEvent): boolean {
  const normalized = normalizeShortcutString(binding)
  if (!normalized) return false
  if (normalized.ctrl !== event.ctrlKey) return false
  if (normalized.alt !== event.altKey) return false
  if (normalized.shift !== event.shiftKey) return false
  if (normalized.meta !== event.metaKey) return false
  const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase()
  return normalized.key === eventKey
}

function formatShortcutFromEvent(event: KeyboardEvent): string | null {
  const key = event.key
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  if (event.metaKey) parts.push('Meta')
  const printableKey = key.length === 1 ? key.toUpperCase() : key
  parts.push(printableKey)
  return parts.join('+')
}

function renderShortcutList() {
  shortcutList.innerHTML = ''
  for (const shortcut of SHORTCUTS) {
    const row = document.createElement('div')
    row.className = 'shortcut-row'

    const info = document.createElement('div')
    info.className = 'shortcut-info'

    const name = document.createElement('div')
    name.className = 'shortcut-name'
    name.textContent = t(shortcut.labelKey)
    info.appendChild(name)

    const description = document.createElement('div')
    description.className = 'shortcut-description'
    description.textContent = t(shortcut.descriptionKey)
    info.appendChild(description)

    const bindingBtn = document.createElement('button')
    bindingBtn.type = 'button'
    bindingBtn.className = 'shortcut-binding'
    bindingBtn.dataset.action = shortcut.action
    bindingBtn.textContent = shortcutBindings[shortcut.action]
    bindingBtn.onclick = () => beginShortcutCapture(shortcut.action, bindingBtn)

    row.appendChild(info)
    row.appendChild(bindingBtn)
    shortcutList.appendChild(row)
  }
}

function beginShortcutCapture(action: ShortcutAction, button: HTMLButtonElement) {
  shortcutCaptureAction = action
  shortcutCaptureButton = button
  button.textContent = t('shortcutsModal.recordPrompt')
  button.classList.add('recording')
  window.addEventListener('keydown', handleShortcutCaptureEvent, true)
}

function handleShortcutCaptureEvent(event: KeyboardEvent) {
  if (!shortcutCaptureAction || !shortcutCaptureButton) return
  event.preventDefault()
  event.stopPropagation()
  if (event.key === 'Escape') {
    shortcutCaptureButton.textContent = shortcutBindings[shortcutCaptureAction]
    shortcutCaptureButton.classList.remove('recording')
    shortcutCaptureAction = null
    shortcutCaptureButton = null
    window.removeEventListener('keydown', handleShortcutCaptureEvent, true)
    return
  }
  const formatted = formatShortcutFromEvent(event)
  if (!formatted) {
    shortcutCaptureButton.textContent = t('shortcutsModal.recordPrompt')
    return
  }
  const captureAction = shortcutCaptureAction
  shortcutBindings[captureAction] = formatted
  for (const other of Object.keys(shortcutBindings) as ShortcutAction[]) {
    if (other !== captureAction && shortcutBindings[other].toLowerCase() === formatted.toLowerCase()) {
      const fallback = SHORTCUTS.find(sc => sc.action === other)?.defaultBinding
      if (fallback) shortcutBindings[other] = fallback
    }
  }
  window.removeEventListener('keydown', handleShortcutCaptureEvent, true)
  shortcutCaptureButton = null
  shortcutCaptureAction = null
  persistShortcutBindings()
  renderShortcutList()
}

function resetShortcutBindingsToDefault() {
  for (const shortcut of SHORTCUTS) {
    shortcutBindings[shortcut.action] = shortcut.defaultBinding
  }
  persistShortcutBindings()
  renderShortcutList()
}

function openShortcutModal() {
  if (shortcutsModalOpen) return
  shortcutsModalOpen = true
  shortcutModal.removeAttribute('hidden')
  document.body.classList.add('modal-open')
  renderShortcutList()
}

function closeShortcutModal(save = true) {
  if (!shortcutsModalOpen) return
  shortcutsModalOpen = false
  shortcutModal.setAttribute('hidden', '')
  document.body.classList.remove('modal-open')
  if (shortcutCaptureAction) {
    window.removeEventListener('keydown', handleShortcutCaptureEvent, true)
    shortcutCaptureAction = null
    shortcutCaptureButton = null
  }
  if (save) persistShortcutBindings()
}

function readStoredTheme(): ThemeMode | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
    if (stored === 'light' || stored === 'dark') return stored
  } catch {}
  return null
}

function detectPreferredTheme(): ThemeMode {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light'
  }
  return 'dark'
}

function updateThemeToggleButton() {
  const isDark = currentTheme === 'dark'
  const label = isDark ? t('theme.switchToLight') : t('theme.switchToDark')
  themeToggleBtn.textContent = label
  themeToggleBtn.setAttribute('aria-pressed', String(!isDark))
  const tooltip = isDark ? t('theme.activateLight') : t('theme.activateDark')
  setTooltip(themeToggleBtn, tooltip)
}

function applyTheme(mode: ThemeMode) {
  currentTheme = mode
  document.documentElement.setAttribute('data-theme', mode)
  updateThemeToggleButton()
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode)
  } catch {}
}

function loadShortcutBindings() {
  try {
    const stored = localStorage.getItem(SHORTCUT_STORAGE_KEY)
    if (!stored) return
    const parsed = JSON.parse(stored) as Partial<Record<ShortcutAction, string>>
    for (const shortcut of SHORTCUTS) {
      const value = parsed[shortcut.action]
      if (typeof value === 'string' && value.trim()) {
        shortcutBindings[shortcut.action] = value
      }
    }
  } catch {
    // ignore corrupted entries
  }
}

function persistShortcutBindings() {
  try {
    localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(shortcutBindings))
  } catch {}
}

let curatedIntermarcCol = -1
const baselineIntermarc = new Map<string, Intermarc>()

// Names used for default detection and override-by-name
const DEFAULT_CURATED_NAME = 'curated.csv'
const DEFAULT_ORIGINAL_CANDIDATES = ['current_export.csv', 'original.csv']
const CLUSTER_NOTE = 'Clusterisation script'
const EXPRESSION_DRAG_MIME = 'application/x-expression-cluster'
const MANIFESTATION_DRAG_MIME = 'application/x-manifestation-cluster'
const FILE_DRAG_TYPE = 'Files'

function normalizeType(value: string): string {
  if (!value) return ''
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/œ/gi, 'oe')
    .toLowerCase()
    .trim()
}

function bindSingleAndDouble(
  el: HTMLElement,
  onSingle: (event: MouseEvent) => void,
  onDouble: (event: MouseEvent) => void,
  delay = 250,
) {
  let singleTimer: number | undefined
  el.addEventListener('click', event => {
    if (event.detail === 1) {
      singleTimer = window.setTimeout(() => onSingle(event), delay)
    } else if (event.detail === 2) {
      if (singleTimer !== undefined) {
        window.clearTimeout(singleTimer)
        singleTimer = undefined
      }
      onDouble(event)
    }
  })
}

function readFile(input: HTMLInputElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const f = input.files?.[0]
    if (!f) return reject(new Error('No file'))
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsText(f, 'utf-8')
  })
}

function indexRecords(csv: { headers: string[]; rows: string[][] }): RecordRow[] {
  const headers = csv.headers
  const idIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'id_entitelrm')
  const typeIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'type_entite')
  const intIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'intermarc')
  if (idIdx < 0 || typeIdx < 0 || intIdx < 0) throw new Error('Missing expected headers')
  return csv.rows.slice(1).map((row, idx) => {
    const intermarcStr = row[intIdx]
    const intermarc = parseIntermarc(intermarcStr)
    const arkZone = findZones(intermarc, '001')[0]
    const ark = arkZone?.sousZones.find(sz => sz.code === '001$a')?.valeur
    return {
      id: row[idIdx],
      type: row[typeIdx],
      typeNorm: normalizeType(row[typeIdx]),
      rowIndex: idx + 1,
      intermarcStr,
      intermarc,
      ark,
      raw: row,
    }
  })
}

function refreshCuratedColumnIndexes() {
  if (!curatedCsv) {
    curatedIntermarcCol = -1
    return
  }
  curatedIntermarcCol = curatedCsv.headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'intermarc')
}

function cloneIntermarc(im: Intermarc): Intermarc {
  return {
    zones: im.zones.map(z => ({
      code: z.code,
      sousZones: z.sousZones.map(sz => ({ code: sz.code, valeur: sz.valeur })),
    })),
  }
}

function captureBaseline() {
  baselineIntermarc.clear()
  for (const rec of curatedRecords) {
    baselineIntermarc.set(rec.id, cloneIntermarc(rec.intermarc))
  }
}

function refreshCombinedRecordIndexes() {
  combinedRecordsByArk.clear()
  combinedRecordsById.clear()
  const add = (rec: RecordRow) => {
    if (rec.ark) combinedRecordsByArk.set(rec.ark.toLowerCase(), rec)
    combinedRecordsById.set(rec.id, rec)
  }
  originalRecords.forEach(add)
  curatedRecords.forEach(add)
}

function updateRecordIntermarc(record: RecordRow, intermarc: Intermarc) {
  record.intermarc = intermarc
  record.intermarcStr = JSON.stringify(intermarc)
  if (!curatedCsv || curatedIntermarcCol === -1) return
  const row = curatedCsv.rows[record.rowIndex]
  if (!row) return
  row[curatedIntermarcCol] = record.intermarcStr
  record.raw[curatedIntermarcCol] = record.intermarcStr
}

function notify(message: string) {
  const entry = document.createElement('div')
  entry.className = 'toast-message'
  entry.textContent = message
  toastHost.appendChild(entry)
  requestAnimationFrame(() => entry.classList.add('visible'))
  setTimeout(() => {
    entry.classList.remove('visible')
    setTimeout(() => entry.remove(), 300)
  }, 2500)
}

function openUploadModal() {
  if (uploadModalOpen) return
  uploadModalOpen = true
  uploadModal.removeAttribute('hidden')
  uploadModal.classList.add('visible')
  document.body.classList.add('modal-open')
  dropHint.classList.remove('visible')
  uploadDropzone.classList.remove('dragging')
}

function closeUploadModal() {
  if (!uploadModalOpen) return
  uploadModalOpen = false
  uploadModal.setAttribute('hidden', '')
  uploadModal.classList.remove('visible')
  document.body.classList.remove('modal-open')
  uploadDropzone.classList.remove('dragging')
}

function maybeCloseUploadModal() {
  if (uploadModalOpen && originalCsv && curatedCsv) {
    closeUploadModal()
  }
}

function syncWorkClusterIntermarc(cluster: Cluster) {
  const anchor = curatedRecords.find(r => r.id === cluster.anchorId)
  if (!anchor) return
  const today = new Date().toISOString().slice(0, 10)
  const entries = cluster.items
    .filter(item => item.accepted)
    .map(item => {
      if (!item.date) item.date = today
      return { ark: item.ark, date: item.date, note: CLUSTER_NOTE }
    })
  const updated = add90FEntries(anchor.intermarc, entries)
  updateRecordIntermarc(anchor, updated)
}

function syncExpressionClusterIntermarc(cluster: Cluster, anchorExpressionId: string) {
  const record = curatedRecords.find(r => r.id === anchorExpressionId)
  if (!record) return
  const group = cluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
  if (!group) return
  const today = new Date().toISOString().slice(0, 10)
  const entries = group.clustered
    .filter(item => item.accepted)
    .map(item => {
      if (!item.date) item.date = today
      return { ark: item.ark, date: item.date, note: CLUSTER_NOTE }
    })
  const updated = add90FEntries(record.intermarc, entries)
  updateRecordIntermarc(record, updated)
}

function handleWorkCheckboxChange(cluster: Cluster, item: ClusterItem, accepted: boolean) {
  item.accepted = accepted
  const affectedAnchors = new Set<string>()
  if (!accepted) {
    for (const group of cluster.expressionGroups) {
      for (const expr of group.clustered) {
        if (expr.workArk === item.ark && expr.accepted) {
          expr.accepted = false
          affectedAnchors.add(group.anchor.id)
        }
      }
    }
  }

  for (const anchorId of affectedAnchors) {
    syncExpressionClusterIntermarc(cluster, anchorId)
  }
  syncWorkClusterIntermarc(cluster)
  notify(accepted ? t('notifications.workKept') : t('notifications.workUnchecked'))
  renderCurrentView()
  renderDetailsPanel()
}

function handleExpressionCheckboxChange(
  cluster: Cluster,
  anchorExpressionId: string,
  item: ExpressionClusterItem,
  accepted: boolean,
) {
  item.accepted = accepted
  syncExpressionClusterIntermarc(cluster, anchorExpressionId)
  notify(accepted ? t('notifications.expressionKept') : t('notifications.expressionUnchecked'))
  renderCurrentView()
  renderDetailsPanel()
}

function handleExpressionDrop(
  cluster: Cluster,
  sourceAnchorId: string,
  expressionArk: string,
  targetAnchorId: string,
) {
  if (sourceAnchorId === targetAnchorId) return
  const sourceGroup = cluster.expressionGroups.find(g => g.anchor.id === sourceAnchorId)
  const targetGroup = cluster.expressionGroups.find(g => g.anchor.id === targetAnchorId)
  if (!sourceGroup || !targetGroup) return
  const idx = sourceGroup.clustered.findIndex(e => e.ark === expressionArk)
  if (idx === -1) return
  const [item] = sourceGroup.clustered.splice(idx, 1)
  item.anchorExpressionId = targetAnchorId
  item.accepted = true
  item.date = undefined
  targetGroup.clustered.push(item)
  syncExpressionClusterIntermarc(cluster, sourceAnchorId)
  syncExpressionClusterIntermarc(cluster, targetAnchorId)
  highlightedExpressionArk = item.ark
  activeExpressionAnchorId = targetAnchorId
  notify(t('notifications.expressionMoved'))
  renderCurrentView()
  renderDetailsPanel()
}

type EntityPillKind = 'work' | 'expression' | 'manifestation' | 'person' | 'collective' | 'brand' | 'concept' | 'controlled'

type EntityBadgeSpec = {
  type: EntityPillKind
  text: string
  tooltip?: string
}

function setTooltip(target: HTMLElement, text?: string | null) {
  if (text && text.trim()) {
    target.dataset.tooltip = text
    target.classList.add('has-tooltip')
    target.setAttribute('aria-label', text)
  } else {
    delete target.dataset.tooltip
    target.classList.remove('has-tooltip')
    target.removeAttribute('aria-label')
  }
}

const ARK_REGEX = /ark:\/\S+/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function decorateEntityTitleWithArkLabels(titleSpan: HTMLElement) {
  const text = titleSpan.textContent || ''
  if (!text.includes('ark:/')) return
  const matches = Array.from(new Set(text.match(ARK_REGEX) ?? []))
  if (!matches.length) return
  Promise.all(
    matches.map(async ark => ({
      ark,
      label: await resolveArkLabel(ark),
    })),
  )
    .then(results => {
      const replacements = results.filter(
        (entry): entry is { ark: string; label: string } => !!entry.label && entry.label !== entry.ark,
      )
      if (!replacements.length) return
      const current = titleSpan.textContent || ''
      let updated = current
      let changed = false
      for (const { ark, label } of replacements) {
        if (!updated.includes(ark)) continue
        updated = updated.replace(new RegExp(escapeRegExp(ark), 'g'), label)
        changed = true
      }
      if (changed) {
        titleSpan.textContent = updated
      }
    })
    .catch(err => {
      console.error('Failed to decorate entity title with ARK labels', err)
    })
}

function createEntityPill(type: EntityPillKind, text: string, tooltip?: string): HTMLSpanElement {
  const pill = document.createElement('span')
  pill.className = `entity-pill entity-pill-${type}`
  pill.textContent = text
  setTooltip(pill, tooltip)
  return pill
}

type CountBadgeKind = 'expressions' | 'manifestations'

function createCountBadge(kind: CountBadgeKind, count: number): HTMLSpanElement {
  const badge = document.createElement('span')
  badge.className = `entity-count-badge entity-count-badge--${kind}`
  badge.textContent = String(count)
  const tooltipKey = kind === 'expressions' ? 'badges.expressions' : 'badges.manifestations'
  setTooltip(badge, t(tooltipKey, { count }))
  return badge
}

function appendCountBadges(
  target: HTMLElement,
  counts: { expressions?: number; manifestations?: number },
) {
  const badges: HTMLSpanElement[] = []
  if (typeof counts.expressions === 'number') {
    badges.push(createCountBadge('expressions', counts.expressions))
  }
  if (typeof counts.manifestations === 'number') {
    badges.push(createCountBadge('manifestations', counts.manifestations))
  }
  if (!badges.length) return
  let host = target.querySelector<HTMLElement>(':scope > .entity-badges')
  if (!host) {
    host = document.createElement('span')
    host.className = 'entity-badges'
    target.appendChild(host)
  }
  for (const badge of badges) host.appendChild(badge)
}

function populateEntityLabel(
  target: HTMLElement,
  config: {
    title: string
    subtitle?: string
    badges?: EntityBadgeSpec[]
  },
) {
  target.classList.add('entity-label')
  target.innerHTML = ''
  const titleSpan = document.createElement('span')
  titleSpan.className = 'entity-title'
  titleSpan.textContent = config.title
  decorateEntityTitleWithArkLabels(titleSpan)
  target.appendChild(titleSpan)
  if (config.subtitle) {
    const subtitle = document.createElement('span')
    subtitle.className = 'entity-subtitle'
    subtitle.textContent = config.subtitle
    target.appendChild(subtitle)
  }
  if (config.badges && config.badges.length) {
    const badgeWrap = document.createElement('span')
    badgeWrap.className = 'entity-badges'
    for (const badge of config.badges) {
      badgeWrap.appendChild(createEntityPill(badge.type, badge.text, badge.tooltip))
    }
    target.appendChild(badgeWrap)
  }
}

function buildExpressionGroupLabel(
  expression: ExpressionItem | ExpressionClusterItem,
  options: { isAnchor: boolean; manifestationCount?: number },
): HTMLSpanElement {
  const label = document.createElement('span')
  label.className = 'entity-label expression-group-label'

  const marker = document.createElement('span')
  marker.className = 'expression-marker'
  marker.textContent = options.isAnchor ? '⚓︎' : '🍇'
  label.appendChild(marker)

  label.appendChild(createEntityPill('expression', expression.id, expression.ark))
  if (expression.workId) {
    label.appendChild(createEntityPill('work', expression.workId, expression.workArk))
  }

  if (typeof options.manifestationCount === 'number') {
    label.appendChild(createCountBadge('manifestations', options.manifestationCount))
  }

  return label
}

function prependAgentBadge(target: HTMLElement, recordId?: string | null) {
  const host = target.matches('.entity-label') ? (target as HTMLElement) : target.querySelector<HTMLElement>(':scope .entity-label')
  if (!host) return
  let badgeWrap = host.querySelector<HTMLElement>(':scope > .entity-badges')
  if (!badgeWrap) {
    badgeWrap = document.createElement('span')
    badgeWrap.className = 'entity-badges'
    host.appendChild(badgeWrap)
  }
  badgeWrap.querySelector(':scope > .agent-badge')?.remove()
  const info = getAgentInfoForRecord(recordId)
  const badge = document.createElement('span')
  badge.className = 'entity-pill entity-pill-agent agent-badge'
  badge.textContent = String(info.names.length)
  setTooltip(badge, info.names.length ? info.names.join('\n') : t('messages.noAgents'))
  badgeWrap.appendChild(badge)
}

function computeWorkCounts(cluster: Cluster, workArk?: string | null): { 
  expressions: number
  manifestations: number
} {
  if (!workArk) return { expressions: 0, manifestations: 0 }
  let expressions = 0
  let manifestations = 0
  const consider = (expression: ExpressionItem | ExpressionClusterItem) => {
    if (expression.workArk !== workArk) return
    expressions += 1
    manifestations += expression.manifestations.length
  }
  for (const group of cluster.expressionGroups) {
    consider(group.anchor)
    for (const expr of group.clustered) consider(expr)
  }
  for (const expr of cluster.independentExpressions) consider(expr)
  return { expressions, manifestations }
}

function isClusterWorkAccepted(cluster: Cluster, workArk?: string): boolean {
  if (!workArk || workArk === cluster.anchorArk) return true
  const target = cluster.items.find(item => item.ark === workArk)
  if (!target) return true
  return target.accepted
}

function buildArkIndex(records: RecordRow[]): Map<string, RecordRow> {
  const idx = new Map<string, RecordRow>()
  for (const r of records) {
    if (r.ark) idx.set(r.ark, r)
    const zones001 = findZones(r.intermarc, '001')
    for (const z of zones001) {
      const ark = z.sousZones.find(sz => sz.code === '001$a')?.valeur
      if (ark) idx.set(ark, r)
    }
  }
  return idx
}

function detectClusters(curated: RecordRow[], originalIdxByArk: Map<string, RecordRow>): Cluster[] {
  const worksByArk = new Map<string, RecordRow>()
  const workIdByArk = new Map<string, string>()
  const workTitleByArk = new Map<string, string>()
  const expressionsByArk = new Map<string, RecordRow>()
  const expressionsByWorkArk = new Map<string, RecordRow[]>()
  const manifestationsByExpressionArk = new Map<string, RecordRow[]>()

  for (const rec of curated) {
    if (rec.typeNorm === 'oeuvre') {
      const workArk = rec.ark
      if (workArk) {
        worksByArk.set(workArk, rec)
        workIdByArk.set(workArk, rec.id)
        workTitleByArk.set(workArk, titleOf(rec) || rec.id)
      }
    } else if (rec.typeNorm === 'expression') {
      if (rec.ark) expressionsByArk.set(rec.ark, rec)
      const workArks = expressionWorkArks(rec)
      for (const workArk of workArks) {
        if (!expressionsByWorkArk.has(workArk)) expressionsByWorkArk.set(workArk, [])
        expressionsByWorkArk.get(workArk)!.push(rec)
      }
    } else if (rec.typeNorm === 'manifestation') {
      for (const exprArk of manifestationExpressionArks(rec)) {
        if (!manifestationsByExpressionArk.has(exprArk)) manifestationsByExpressionArk.set(exprArk, [])
        manifestationsByExpressionArk.get(exprArk)!.push(rec)
      }
    }
  }

  const result: Cluster[] = []
  for (const work of curated) {
    if (work.typeNorm !== 'oeuvre') continue

    const zones = findZones(work.intermarc, '90F')
    const items: ClusterItem[] = []
    for (const z of zones) {
      const note = z.sousZones.find(sz => sz.code === '90F$q')?.valeur
      if (note !== CLUSTER_NOTE) continue
      const ark = z.sousZones.find(sz => sz.code === '90F$a')?.valeur
      if (!ark) continue
      const date = z.sousZones.find(sz => sz.code === '90F$d')?.valeur
      const curatedTarget = worksByArk.get(ark)
      const fallback = curatedTarget || originalIdxByArk.get(ark)
      const title = curatedTarget ? titleOf(curatedTarget) : fallback?.intermarc?.zones
        .filter(zz => zz.code === '150')
        .flatMap(zz => zz.sousZones)
        .find(sz => sz.code === '150$a')?.valeur
      const id = curatedTarget?.id || fallback?.id
      items.push({ ark, id, title, accepted: true, date })
    }
    if (!items.length) {
      continue
    }

    const anchorArk = work.ark || ''
    const anchorTitle = titleOf(work)

    const anchorExpressions = expressionsByWorkArk.get(anchorArk) || []
    const expressionGroups: ExpressionAnchorGroup[] = []
    const usedExpressionArks = new Set<string>()

    for (const expr of anchorExpressions) {
      const anchorManifestations = expr.ark
        ? manifestationsForExpression(expr.ark, manifestationsByExpressionArk, expressionsByArk)
        : []
      const anchorExpression: ExpressionItem = {
        id: expr.id,
        ark: expr.ark || expr.id,
        title: titleOf(expr) || expr.id,
        workArk: anchorArk,
        workId: work.id,
        manifestations: anchorManifestations,
      }

      const clustered: ExpressionClusterItem[] = []
      for (const { ark: targetArk, date } of expressionClusterTargets(expr)) {
        const target = expressionsByArk.get(targetArk)
        const workArks = target ? expressionWorkArks(target) : []
        const sourceWorkArk = workArks[0] || ''
        const sourceWorkId = sourceWorkArk ? workIdByArk.get(sourceWorkArk) : undefined
        const targetManifestations = manifestationsForExpression(
          targetArk,
          manifestationsByExpressionArk,
          expressionsByArk,
        )
        clustered.push({
          id: target?.id || targetArk,
          ark: targetArk,
          title: target ? titleOf(target) || target.id : targetArk,
          workArk: sourceWorkArk,
          workId: sourceWorkId,
          anchorExpressionId: expr.id,
          accepted: true,
          date,
          manifestations: targetManifestations,
        })
        usedExpressionArks.add(targetArk)
      }

      expressionGroups.push({ anchor: anchorExpression, clustered })
    }

    const independentExpressions: ExpressionItem[] = []
    for (const item of items) {
      const workExpressions = expressionsByWorkArk.get(item.ark) || []
      for (const expr of workExpressions) {
        const exprArk = expr.ark
        if (!exprArk || usedExpressionArks.has(exprArk)) continue
        const manifests = manifestationsForExpression(exprArk, manifestationsByExpressionArk, expressionsByArk)
        independentExpressions.push({
          id: expr.id,
          ark: exprArk,
          title: titleOf(expr) || expr.id,
          workArk: item.ark,
          workId: item.id,
          manifestations: manifests,
        })
        usedExpressionArks.add(exprArk)
      }
    }

    result.push({
      anchorId: work.id,
      anchorArk,
      anchorTitle,
      items,
      expressionGroups,
      independentExpressions,
    })
  }
  return result
}

function countOriginalWorkEntities(workArk?: string | null): { expressions: number; manifestations: number } {
  if (!workArk) return { expressions: 0, manifestations: 0 }
  const expressions = originalExpressionsByWorkArk.get(workArk) ?? []
  const manifestations = expressions.reduce((total, expr) => {
    const list = originalManifestationsByExpressionArk.get(expr.ark || '') ?? []
    return total + list.length
  }, 0)
  return { expressions: expressions.length, manifestations }
}

type InventoryScope = 'clusters' | 'inventory'

type InventoryRow =
  | { kind: 'header'; label: string; count: number }
  | {
      kind: 'entity'
      entityType: InventoryEntityType
      record: RecordRow
      source: 'curated' | 'original'
      title: string
      subtitle?: string
      badges?: EntityBadgeSpec[]
      counts?: { expressions?: number; manifestations?: number }
      context?: InventoryEntityContext
    }

type InventoryEntityRow = Extract<InventoryRow, { kind: 'entity' }>

const clusterCoverage = {
  workIds: new Set<string>(),
  workArks: new Set<string>(),
  expressionIds: new Set<string>(),
  expressionArks: new Set<string>(),
  manifestationIds: new Set<string>(),
  manifestationArks: new Set<string>(),
  manifestationsByExpressionArk: new Map<string, Set<string>>(),
}

const originalWorksByArk = new Map<string, RecordRow>()
const originalExpressionsByArk = new Map<string, RecordRow>()
const originalExpressionsByWorkArk = new Map<string, RecordRow[]>()
const originalManifestationsByExpressionArk = new Map<string, RecordRow[]>()

let listScope: InventoryScope = 'clusters'
let inventoryRows: InventoryRow[] = []
const inventoryExpressionIndexById = new Map<string, number>()
const inventoryManifestationIndexById = new Map<string, Map<string, number>>()
let inventoryExpressionFilterArk: string | null = null
let inventoryFocusWork: RecordRow | null = null
let inventoryFocusExpression: RecordRow | null = null

type InventoryEntityContext = {
  workArk?: string | null
  expressionId?: string | null
  expressionArk?: string | null
}

function manifestationIndexKey(expressionId?: string | null, expressionArk?: string | null): string {
  if (expressionId) return `id:${expressionId}`
  if (expressionArk) return `ark:${expressionArk}`
  return 'global'
}

function rebuildClusterCoverage() {
  clusterCoverage.workIds.clear()
  clusterCoverage.workArks.clear()
  clusterCoverage.expressionIds.clear()
  clusterCoverage.expressionArks.clear()
  clusterCoverage.manifestationIds.clear()
  clusterCoverage.manifestationArks.clear()
  clusterCoverage.manifestationsByExpressionArk.clear()

  const registerManifestation = (item: ManifestationItem) => {
    clusterCoverage.manifestationIds.add(item.id)
    if (item.ark) clusterCoverage.manifestationArks.add(item.ark)
    if (item.expressionArk) {
      if (!clusterCoverage.manifestationsByExpressionArk.has(item.expressionArk)) {
        clusterCoverage.manifestationsByExpressionArk.set(item.expressionArk, new Set())
      }
      clusterCoverage.manifestationsByExpressionArk.get(item.expressionArk)!.add(item.id)
    }
  }

  const registerExpression = (item: ExpressionItem | ExpressionClusterItem) => {
    clusterCoverage.expressionIds.add(item.id)
    if (item.ark) clusterCoverage.expressionArks.add(item.ark)
    item.manifestations.forEach(registerManifestation)
  }

  for (const cluster of clusters) {
    clusterCoverage.workIds.add(cluster.anchorId)
    if (cluster.anchorArk) clusterCoverage.workArks.add(cluster.anchorArk)
    cluster.items.forEach(item => {
      if (item.id) clusterCoverage.workIds.add(item.id)
      if (item.ark) clusterCoverage.workArks.add(item.ark)
    })
    for (const group of cluster.expressionGroups) {
      registerExpression(group.anchor)
      group.clustered.forEach(registerExpression)
    }
    cluster.independentExpressions.forEach(registerExpression)
  }
}

function rebuildOriginalIndexes() {
  originalWorksByArk.clear()
  originalExpressionsByArk.clear()
  originalExpressionsByWorkArk.clear()
  originalManifestationsByExpressionArk.clear()

  for (const rec of originalRecords) {
    if (rec.ark && rec.typeNorm === 'oeuvre') {
      originalWorksByArk.set(rec.ark, rec)
    }
    if (rec.typeNorm === 'expression') {
      if (rec.ark) originalExpressionsByArk.set(rec.ark, rec)
      const workArks = expressionWorkArks(rec)
      for (const workArk of workArks) {
        if (!originalExpressionsByWorkArk.has(workArk)) {
          originalExpressionsByWorkArk.set(workArk, [])
        }
        originalExpressionsByWorkArk.get(workArk)!.push(rec)
      }
      continue
    }
    if (rec.typeNorm === 'manifestation') {
      const expressionArks = manifestationExpressionArks(rec)
      for (const exprArk of expressionArks) {
        if (!originalManifestationsByExpressionArk.has(exprArk)) {
          originalManifestationsByExpressionArk.set(exprArk, [])
        }
        originalManifestationsByExpressionArk.get(exprArk)!.push(rec)
      }
    }
  }

  const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
  originalExpressionsByWorkArk.forEach(list => {
    list.sort((a, b) => collator.compare(inventoryExpressionTitle(a), inventoryExpressionTitle(b)))
  })
  originalManifestationsByExpressionArk.forEach(list => {
    list.sort((a, b) => collator.compare(inventoryManifestationTitle(a), inventoryManifestationTitle(b)))
  })
}

function isWorkClustered(rec: RecordRow): boolean {
  if (clusterCoverage.workIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && clusterCoverage.workArks.has(ark)) return true
  return false
}

function isExpressionClustered(rec: RecordRow): boolean {
  if (clusterCoverage.expressionIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && clusterCoverage.expressionArks.has(ark)) return true
  return false
}

function isManifestationClustered(rec: RecordRow): boolean {
  const expressionArks = manifestationExpressionArks(rec)
  if (expressionArks.length) {
    const uncovered = expressionArks.some(exprArk => {
      const ids = clusterCoverage.manifestationsByExpressionArk.get(exprArk)
      return !ids || !ids.has(rec.id)
    })
    if (uncovered) return false
  }
  if (clusterCoverage.manifestationIds.has(rec.id)) return true
  const ark = rec.ark
  if (ark && clusterCoverage.manifestationArks.has(ark)) return true
  return false
}

function inventoryWorkTitle(rec: RecordRow): string {
  return titleOf(rec) || rec.id
}

function inventoryExpressionTitle(rec: RecordRow): string {
  return titleOf(rec) || rec.id
}

function inventoryManifestationTitle(rec: RecordRow): string {
  return manifestationTitle(rec) || rec.id
}

function brandLabel(rec: RecordRow): string {
  const zone = findZones(rec.intermarc, '163')[0]
  const value = zone?.sousZones.find(sz => sz.code === '163$a')?.valeur?.trim()
  return value && value.length ? value : rec.id
}

function controlledLabel(rec: RecordRow): string {
  const zone = findZones(rec.intermarc, '169')[0]
  const value = zone?.sousZones.find(sz => sz.code === '169$a')?.valeur?.trim()
  return value && value.length ? value : rec.id
}

function conceptLabels(rec: RecordRow): { title: string; subtitle?: string } {
  const zone = findZones(rec.intermarc, '186')[0]
  let title = zone?.sousZones.find(sz => sz.code === '186$i')?.valeur?.trim() || ''
  const subtitle = zone?.sousZones.find(sz => sz.code === '186$a')?.valeur?.trim()
  if (!title) title = rec.id
  return subtitle ? { title, subtitle } : { title }
}

function buildInventoryRowForWork(rec: RecordRow): InventoryRow {
  const title = inventoryWorkTitle(rec)
  const subtitle = rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'work', text: rec.id, tooltip: rec.ark }]
  const counts = countOriginalWorkEntities(rec.ark)
  const context: InventoryEntityContext = {}
  if (rec.ark) context.workArk = rec.ark
  return {
    kind: 'entity',
    entityType: 'work',
    record: rec,
    source: 'original',
    title,
    subtitle,
    badges,
    counts,
    context,
  }
}

function buildInventoryRowForExpression(rec: RecordRow): InventoryRow {
  const title = inventoryExpressionTitle(rec)
  const workArks = expressionWorkArks(rec)
  const primaryArk = workArks[0]
  const relatedWork = primaryArk ? originalWorksByArk.get(primaryArk) ?? null : null
  const subtitle = primaryArk || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'expression', text: rec.id, tooltip: rec.ark }]
  if (relatedWork) {
    badges.push({ type: 'work', text: relatedWork.id, tooltip: relatedWork.ark })
  } else if (primaryArk) {
    badges.push({ type: 'work', text: primaryArk })
  }
  const manifestationCount = originalManifestationsByExpressionArk.get(rec.ark || '')?.length ?? 0
  const counts = manifestationCount ? { manifestations: manifestationCount } : undefined
  const context: InventoryEntityContext = {
    expressionId: rec.id,
    expressionArk: rec.ark,
  }
  if (primaryArk) context.workArk = primaryArk
  return {
    kind: 'entity',
    entityType: 'expression',
    record: rec,
    source: 'original',
    title,
    subtitle,
    badges,
    counts,
    context,
  }
}

function buildInventoryRowForManifestation(
  rec: RecordRow,
  context: InventoryEntityContext = {},
): InventoryRow {
  const title = inventoryManifestationTitle(rec)
  const expressionArks = manifestationExpressionArks(rec)
  const primaryArk = context.expressionArk ?? expressionArks[0]
  const expressionId = context.expressionId ?? (primaryArk ? originalExpressionsByArk.get(primaryArk)?.id : undefined)
  const relatedExpression =
    expressionId
      ? combinedRecordsById.get(expressionId) ?? originalExpressionsByArk.get(primaryArk || '') ?? null
      : primaryArk
        ? originalExpressionsByArk.get(primaryArk) ?? null
        : null
  const subtitle = primaryArk || rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'manifestation', text: rec.id, tooltip: rec.ark }]
  if (relatedExpression) {
    badges.push({ type: 'expression', text: relatedExpression.id, tooltip: relatedExpression.ark })
  } else if (primaryArk) {
    badges.push({ type: 'expression', text: primaryArk })
  }
  const resolvedContext: InventoryEntityContext = {}
  const workArkFromContext = context.workArk ?? (relatedExpression ? expressionWorkArks(relatedExpression)[0] : undefined)
  if (workArkFromContext) resolvedContext.workArk = workArkFromContext
  const resolvedExpressionId = context.expressionId ?? expressionId
  if (resolvedExpressionId) resolvedContext.expressionId = resolvedExpressionId
  if (primaryArk) resolvedContext.expressionArk = primaryArk
  return {
    kind: 'entity',
    entityType: 'manifestation',
    record: rec,
    source: 'original',
    title,
    subtitle,
    badges,
    context: resolvedContext,
  }
}

function buildInventoryRowForPerson(rec: RecordRow): InventoryRow {
  const title = labelForAgentRecord(rec)
  const subtitle = rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'person', text: rec.id, tooltip: rec.ark }]
  return { kind: 'entity', entityType: 'person', record: rec, source: 'original', title, subtitle, badges }
}

function buildInventoryRowForCollective(rec: RecordRow): InventoryRow {
  const title = labelForAgentRecord(rec)
  const subtitle = rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'collective', text: rec.id, tooltip: rec.ark }]
  return { kind: 'entity', entityType: 'collective', record: rec, source: 'original', title, subtitle, badges }
}

function buildInventoryRowForBrand(rec: RecordRow): InventoryRow {
  const title = brandLabel(rec)
  const subtitle = rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'brand', text: rec.id, tooltip: rec.ark }]
  return { kind: 'entity', entityType: 'brand', record: rec, source: 'original', title, subtitle, badges }
}

function buildInventoryRowForConcept(rec: RecordRow): InventoryRow {
  const labels = conceptLabels(rec)
  const badges: EntityBadgeSpec[] = [{ type: 'concept', text: rec.id, tooltip: rec.ark }]
  return { kind: 'entity', entityType: 'concept', record: rec, source: 'original', title: labels.title, subtitle: labels.subtitle, badges }
}

function buildInventoryRowForControlled(rec: RecordRow): InventoryRow {
  const title = controlledLabel(rec)
  const subtitle = rec.ark || undefined
  const badges: EntityBadgeSpec[] = [{ type: 'controlled', text: rec.id, tooltip: rec.ark }]
  return { kind: 'entity', entityType: 'controlled', record: rec, source: 'original', title, subtitle, badges }
}

function rebuildInventoryRows() {
  const rows: InventoryRow[] = []
  const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })

  const pushRow = (row: InventoryRow) => {
    rows.push(row)
  }

  const addSection = (labelKey: string, items: RecordRow[], builder: (rec: RecordRow) => InventoryRow) => {
    if (!items.length) return
    pushRow({ kind: 'header', label: t(labelKey, { count: items.length }), count: items.length })
    items.forEach(rec => pushRow(builder(rec)))
  }

  const works = originalRecords
    .filter(rec => rec.typeNorm === 'oeuvre' && !isWorkClustered(rec))
    .sort((a, b) => collator.compare(inventoryWorkTitle(a), inventoryWorkTitle(b)))
  const expressions = originalRecords
    .filter(rec => rec.typeNorm === 'expression' && !isExpressionClustered(rec))
    .sort((a, b) => collator.compare(inventoryExpressionTitle(a), inventoryExpressionTitle(b)))
  const manifestations = originalRecords
    .filter(rec => rec.typeNorm === 'manifestation' && !isManifestationClustered(rec))
    .sort((a, b) => collator.compare(inventoryManifestationTitle(a), inventoryManifestationTitle(b)))

  const persons = originalRecords
    .filter(rec => rec.typeNorm === 'identite publique de personne')
    .sort((a, b) => collator.compare(labelForAgentRecord(a), labelForAgentRecord(b)))
  const collectives = originalRecords
    .filter(rec => rec.typeNorm === 'collectivite')
    .sort((a, b) => collator.compare(labelForAgentRecord(a), labelForAgentRecord(b)))
  const brands = originalRecords
    .filter(rec => rec.typeNorm === 'marque')
    .sort((a, b) => collator.compare(brandLabel(a), brandLabel(b)))
  const concepts = originalRecords
    .filter(rec => rec.typeNorm === 'concept dewey')
    .sort((a, b) => collator.compare(conceptLabels(a).title, conceptLabels(b).title))
  const controlled = originalRecords
    .filter(rec => rec.typeNorm === 'valeur controlee')
    .sort((a, b) => collator.compare(controlledLabel(a), controlledLabel(b)))

  addSection('inventory.sections.works', works, buildInventoryRowForWork)
  addSection('inventory.sections.expressions', expressions, buildInventoryRowForExpression)
  addSection('inventory.sections.manifestations', manifestations, buildInventoryRowForManifestation)
  addSection('inventory.sections.persons', persons, buildInventoryRowForPerson)
  addSection('inventory.sections.collectives', collectives, buildInventoryRowForCollective)
  addSection('inventory.sections.brands', brands, buildInventoryRowForBrand)
  addSection('inventory.sections.concepts', concepts, buildInventoryRowForConcept)
  addSection('inventory.sections.controlled', controlled, buildInventoryRowForControlled)

  inventoryRows = rows
}

function renderCurrentView() {
  clustersEl.innerHTML = ''

  if (listScope === 'clusters') {
    if (viewMode === 'works') {
      renderUnifiedWorkList()
    } else {
      if (!clusters.length) {
        const empty = document.createElement('em')
        empty.textContent = t('messages.noClusters')
        clustersEl.appendChild(empty)
        exportBtn.disabled = true
        pendingScrollEntity = null
        return
      }
      exportBtn.disabled = false
      const clusterBreadcrumb = buildClusterBreadcrumb()
      if (clusterBreadcrumb) clustersEl.appendChild(clusterBreadcrumb)
      if (viewMode === 'expressions') {
        renderExpressionClusters()
      } else {
        renderManifestationClusters()
      }
    }
  } else {
    exportBtn.disabled = !clusters.length
    renderInventoryView()
  }

  const scrollTarget = pendingScrollEntity
  pendingScrollEntity = null
  if (scrollTarget) {
    requestAnimationFrame(() => scrollEntityIntoView(scrollTarget))
  }
}

function renderUnifiedWorkList() {
  rebuildClusterCoverage()
  const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })

  const clusterEntries = clusters.map(cluster => ({
    kind: 'cluster' as const,
    title: cluster.anchorTitle || cluster.anchorId,
    cluster,
  }))

  const unclusteredEntries = getUnclusteredWorks().map(work => ({
    kind: 'unclustered' as const,
    title: inventoryWorkTitle(work),
    work,
  }))

  const combined = [...clusterEntries, ...unclusteredEntries]
  combined.sort((a, b) => {
    const cmp = collator.compare(a.title, b.title)
    if (cmp !== 0) return cmp
    if (a.kind === b.kind) return 0
    return a.kind === 'cluster' ? -1 : 1
  })

  exportBtn.disabled = clusters.length === 0

  if (!combined.length) {
    const empty = document.createElement('em')
    empty.textContent = t('messages.noClusters')
    clustersEl.appendChild(empty)
    pendingScrollEntity = null
    return
  }

  combined.forEach(entry => {
    if (entry.kind === 'cluster') {
      clustersEl.appendChild(buildClusterElement(entry.cluster))
    } else {
      clustersEl.appendChild(buildUnclusteredWorkElement(entry.work))
    }
  })
}

function getUnclusteredWorks(): RecordRow[] {
  const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
  return originalRecords
    .filter(rec => rec.typeNorm === 'oeuvre' && !isWorkClustered(rec))
    .sort((a, b) => collator.compare(inventoryWorkTitle(a), inventoryWorkTitle(b)))
}

function computeUnclusteredWorkCounts(work: RecordRow): { expressions: number; manifestations: number } {
  const workArk = work.ark
  if (!workArk) return { expressions: 0, manifestations: 0 }
  const expressions = originalExpressionsByWorkArk.get(workArk) ?? []
  let manifestationCount = 0
  for (const expr of expressions) {
    if (!expr.ark) continue
    manifestationCount += originalManifestationsByExpressionArk.get(expr.ark)?.length ?? 0
  }
  return { expressions: expressions.length, manifestations: manifestationCount }
}

function buildClusterElement(cluster: Cluster): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'cluster'
  if (cluster.anchorId === activeWorkAnchorId) container.classList.add('active')
  container.dataset.clusterAnchorId = cluster.anchorId
  container.dataset.workArk = cluster.anchorArk
  container.dataset.workId = cluster.anchorId

  const headerCounts = computeWorkCounts(cluster, cluster.anchorArk)
  const header = document.createElement('div')
  header.className = 'cluster-header'
  const headerTitle = cluster.anchorTitle || cluster.anchorId
  const workLabel = t('entity.work', { id: cluster.anchorId })
  header.textContent = `${headerTitle} (${workLabel}) ⚓︎`
  header.dataset.workArk = cluster.anchorArk
  header.textContent = ''
  const anchorMarker = document.createElement('span')
  anchorMarker.className = 'cluster-anchor-marker'
  anchorMarker.textContent = '⚓︎'
  const headerLabel = document.createElement('span')
  populateEntityLabel(headerLabel, {
    title: headerTitle,
    subtitle: t('banners.anchorSubtitle'),
    badges: [{ type: 'work', text: cluster.anchorId, tooltip: cluster.anchorArk }],
  })
  appendCountBadges(headerLabel, {
    expressions: headerCounts.expressions,
    manifestations: headerCounts.manifestations,
  })
  header.appendChild(anchorMarker)
  header.appendChild(headerLabel)
  prependAgentBadge(header, cluster.anchorId)
  bindSingleAndDouble(
    header,
    event => {
      if ((event.target as HTMLElement | null)?.closest('.agent-badge')) return
      activeWorkAnchorId = cluster.anchorId
      highlightedWorkArk = cluster.anchorArk
      activeExpressionAnchorId = null
      highlightedExpressionArk = null
      showRecordDetails(cluster.anchorId, true, {
        entityType: 'work',
        clusterAnchorId: cluster.anchorId,
        isAnchor: true,
        workArk: cluster.anchorArk,
      })
    },
    event => {
      if ((event.target as HTMLElement | null)?.closest('.agent-badge')) return
      activeWorkAnchorId = cluster.anchorId
      highlightedWorkArk = cluster.anchorArk
      activeExpressionAnchorId = null
      highlightedExpressionArk = null
      viewMode = 'works'
      renderCurrentView()
    },
  )
  const headerRow = document.createElement('div')
  headerRow.className = 'cluster-header-row entity-row entity-row--work'
  headerRow.dataset.workId = cluster.anchorId
  headerRow.dataset.workArk = cluster.anchorArk
  const headerHighlighted =
    (highlightedWorkArk && highlightedWorkArk === cluster.anchorArk) ||
    (selectedEntity?.entityType === 'work' && selectedEntity.isAnchor && selectedEntity.id === cluster.anchorId)
  if (headerHighlighted) headerRow.classList.add('highlight')
  headerRow.appendChild(header)
  container.appendChild(headerRow)

  const list = document.createElement('div')
  list.className = 'cluster-items'
  for (const item of cluster.items) {
    const row = document.createElement('div')
    row.className = 'cluster-item entity-row entity-row--work'
    if (!item.accepted) row.classList.add('unchecked')
    if (highlightedWorkArk === item.ark) row.classList.add('highlight')
    row.dataset.workArk = item.ark
    if (item.id) row.dataset.workId = item.id
    const itemCounts = computeWorkCounts(cluster, item.ark)

    const cb = document.createElement('input')
    cb.type = 'checkbox'
    cb.checked = item.accepted
    cb.onchange = () => handleWorkCheckboxChange(cluster, item, cb.checked)

    const label = document.createElement('span')
    const subtitle = item.accepted ? undefined : t('labels.uncheckedWork')
    populateEntityLabel(label, {
      title: item.title || item.id || item.ark || t('labels.workFallback'),
      subtitle,
      badges: item.id ? [{ type: 'work', text: item.id, tooltip: item.ark }] : undefined,
    })
    appendCountBadges(label, {
      expressions: itemCounts.expressions,
      manifestations: itemCounts.manifestations,
    })
    label.onclick = () => {
      activeWorkAnchorId = cluster.anchorId
      highlightedWorkArk = item.ark
      activeExpressionAnchorId = null
      highlightedExpressionArk = null
      if (item.id) {
        showRecordDetails(item.id, false, {
          entityType: 'work',
          clusterAnchorId: cluster.anchorId,
          isAnchor: false,
          workArk: item.ark,
        })
      } else {
        renderCurrentView()
      }
      highlightedWorkArk = item.ark
      renderCurrentView()
    }

    bindSingleAndDouble(
      row,
      event => {
        const target = event.target as HTMLElement | null
        if (target?.closest('input, button, .entity-label, .agent-badge')) return
        activeWorkAnchorId = cluster.anchorId
        highlightedWorkArk = item.ark
        activeExpressionAnchorId = null
        highlightedExpressionArk = null
        if (item.id) {
          showRecordDetails(item.id, false, {
            entityType: 'work',
            clusterAnchorId: cluster.anchorId,
            isAnchor: false,
            workArk: item.ark,
          })
        } else {
          renderCurrentView()
        }
      },
      event => {
        if ((event.target as HTMLElement | null)?.closest('input, button, .agent-badge')) return
        activeWorkAnchorId = cluster.anchorId
        highlightedWorkArk = item.ark
        activeExpressionAnchorId = null
        highlightedExpressionArk = null
        viewMode = 'expressions'
        renderCurrentView()
      },
    )

    row.appendChild(cb)
    row.appendChild(label)
    prependAgentBadge(row, item.id)
    list.appendChild(row)
  }

  const addRow = document.createElement('div')
  addRow.className = 'cluster-add'
  const inp = document.createElement('input')
  inp.placeholder = t('cluster.addPlaceholder')
  const addBtn = document.createElement('button')
  addBtn.textContent = t('buttons.add')
  addBtn.onclick = () => {
    const ark = inp.value.trim()
    if (!ark) return
    const curatedIdx = buildArkIndex(curatedRecords)
    const originalIdx = buildArkIndex(originalRecords)
    const target = curatedIdx.get(ark) || originalIdx.get(ark)
    if (!target || target.typeNorm !== 'oeuvre') {
      notify(t('notifications.invalidClusterWork'))
      return
    }
    cluster.items.push({
      ark,
      id: target?.id,
      title: target ? titleOf(target) || target.id : undefined,
      accepted: true,
      date: new Date().toISOString().slice(0, 10),
    })
    const usedExprArks = new Set<string>()
    for (const group of cluster.expressionGroups) {
      for (const expr of group.clustered) usedExprArks.add(expr.ark)
    }
    for (const expr of cluster.independentExpressions) usedExprArks.add(expr.ark)
    for (const rec of curatedRecords) {
      if (rec.typeNorm !== 'expression') continue
      if (!rec.ark) continue
      if (usedExprArks.has(rec.ark)) continue
      if (!expressionWorkArks(rec).includes(ark)) continue
      cluster.independentExpressions.push({
        id: rec.id,
        ark: rec.ark,
        title: titleOf(rec) || rec.id,
        workArk: ark,
        workId: target?.id,
        manifestations: collectManifestationsForExpression(rec.ark),
      })
      usedExprArks.add(rec.ark)
    }
    syncWorkClusterIntermarc(cluster)
    renderCurrentView()
    notify(t('notifications.workAdded'))
    renderDetailsPanel()
  }
  addRow.appendChild(inp)
  addRow.appendChild(addBtn)

  container.appendChild(list)
  container.appendChild(addRow)

  return container
}

function buildUnclusteredWorkElement(work: RecordRow): HTMLDivElement {
  const container = document.createElement('div')
  container.className = 'cluster cluster--unclustered'
  container.dataset.unclustered = 'true'
  container.dataset.workId = work.id
  if (work.ark) container.dataset.workArk = work.ark

  const headerRow = document.createElement('div')
  headerRow.className = 'cluster-header-row entity-row entity-row--work'
  const header = document.createElement('div')
  header.className = 'cluster-header'
  populateEntityLabel(header, {
    title: inventoryWorkTitle(work),
    subtitle: t('labels.unclusteredWork'),
    badges: [{ type: 'work', text: work.id, tooltip: work.ark }],
  })
  const counts = computeUnclusteredWorkCounts(work)
  appendCountBadges(header, counts)
  prependAgentBadge(header, work.id)

  const highlightMatches =
    (work.ark && highlightedWorkArk === work.ark) || (!work.ark && selectedEntity?.id === work.id)
  if (highlightMatches) headerRow.classList.add('highlight')

  const openDetails = () => {
    listScope = 'clusters'
    activeWorkAnchorId = null
    highlightedWorkArk = work.ark || null
    activeExpressionAnchorId = null
    highlightedExpressionArk = null
    showRecordDetails(work.id, false, {
      entityType: 'work',
      workArk: work.ark,
    })
  }

  bindSingleAndDouble(
    header,
    () => openDetails(),
    event => {
      if ((event.target as HTMLElement | null)?.closest('.agent-badge')) return
      openUnclusteredWorkExpressions(work)
    },
  )

  headerRow.appendChild(header)
  container.appendChild(headerRow)
  return container
}

function resolveWorkRecord(id?: string | null, ark?: string | null): RecordRow | null {
  if (id) {
    const curated = curatedRecords.find(r => r.id === id)
    if (curated) return curated
    const original = originalRecords.find(r => r.id === id)
    if (original) return original
    const combined = combinedRecordsById.get(id)
    if (combined) return combined
  }
  if (ark) {
    const record = lookupWorkRecordByArk(ark)
    if (record) return record
  }
  return null
}

function openUnclusteredWorkExpressions(work: RecordRow) {
  const workRecord = resolveWorkRecord(work.id, work.ark) || work

  inventoryFocusWork = workRecord
  inventoryFocusExpression = null
  inventoryExpressionFilterArk = null
  listScope = 'inventory'
  viewMode = 'expressions'
  renderCurrentView()

  const expressions = originalExpressionsByWorkArk.get(workRecord.ark || '') ?? []
  if (!expressions.length) {
    listScope = 'clusters'
    viewMode = 'works'
    renderCurrentView()
    notify(t('notifications.noExpressions'))
    return
  }
  const firstExpression = expressions[0]
  inventoryFocusExpression = firstExpression
  const curatedExpression = curatedRecords.find(r => r.id === firstExpression.id)
  const expressionRecord = curatedExpression ?? firstExpression
  showRecordDetails(expressionRecord.id, !!curatedExpression, {
    entityType: 'expression',
    workArk: workRecord.ark,
    expressionId: expressionRecord.id,
    expressionArk: expressionRecord.ark,
  })
}


function buildClusterBreadcrumb(): HTMLDivElement | null {
  if (!clusters.length) return null
  let cluster = clusters.find(c => c.anchorId === activeWorkAnchorId) || null
  if (!cluster) {
    cluster = clusters[0]
    activeWorkAnchorId = cluster.anchorId
  }
  if (!cluster) return null

  const items: Array<{ label: string; action?: () => void }> = []
  items.push({
    label: t('inventory.breadcrumb.works'),
    action:
      viewMode !== 'works'
        ? () => {
            viewMode = 'works'
            renderCurrentView()
          }
        : undefined,
  })

  const selectedWorkArk =
    selectedEntity?.workArk ?? (highlightedWorkArk !== undefined ? highlightedWorkArk : null) ?? cluster.anchorArk
  if (selectedWorkArk) {
    const workItem =
      selectedWorkArk === cluster.anchorArk
        ? { title: cluster.anchorTitle, id: cluster.anchorId }
        : cluster.items.find(item => item.ark === selectedWorkArk) || null
    const workLabel =
      workItem?.title || (workItem && 'id' in workItem ? workItem.id : undefined) || selectedWorkArk
    items.push({
      label: workLabel,
      action:
        viewMode !== 'works'
          ? () => {
              activeWorkAnchorId = cluster!.anchorId
              highlightedWorkArk = selectedWorkArk
              viewMode = 'expressions'
              renderCurrentView()
            }
          : undefined,
    })
  }

  if (viewMode === 'manifestations') {
    const expressionId =
      selectedEntity?.entityType === 'expression'
        ? selectedEntity.id
        : selectedEntity?.entityType === 'manifestation'
          ? selectedEntity.expressionId
          : activeExpressionAnchorId
    const expressionArk =
      selectedEntity?.entityType === 'manifestation' ? selectedEntity.expressionArk : highlightedExpressionArk
    const expressionData = cluster ? findExpressionInCluster(cluster, expressionId, expressionArk) : undefined
    if (expressionData) {
      items.push({
        label: expressionData.title || expressionData.id,
        action: () => {
          pendingScrollEntity = {
            id: expressionData.id,
            source: 'curated',
            entityType: 'expression',
            clusterAnchorId: cluster!.anchorId,
            expressionId: expressionData.id,
            expressionArk: expressionData.ark,
            workArk: expressionData.workArk ?? selectedWorkArk ?? cluster!.anchorArk,
          }
          viewMode = 'expressions'
          renderCurrentView()
        },
      })
    }
  }

  const breadcrumb = buildInventoryBreadcrumb(items)
  breadcrumb.classList.add('cluster-breadcrumb')
  return breadcrumb
}

function renderInventoryView() {
  rebuildClusterCoverage()
  rebuildInventoryRows()
  if (viewMode === 'expressions' && !inventoryFocusWork) {
    viewMode = 'works'
  } else if (viewMode === 'manifestations' && !inventoryFocusExpression) {
    viewMode = inventoryFocusWork ? 'expressions' : 'works'
  }

  if (viewMode === 'works') {
    renderInventoryWorkList()
  } else if (viewMode === 'expressions' && inventoryFocusWork) {
    renderInventoryExpressionList(inventoryFocusWork)
  } else if (viewMode === 'manifestations' && inventoryFocusExpression) {
    renderInventoryManifestationList(inventoryFocusExpression)
  } else {
    viewMode = 'works'
    inventoryFocusWork = null
    inventoryFocusExpression = null
    renderInventoryWorkList()
  }
}

function createInventoryRowElement(
  row: InventoryRow,
  handlers: { onSingle?: () => void; onDouble?: () => void } = {},
): HTMLElement {
  if (row.kind === 'header') {
    const header = document.createElement('div')
    header.className = 'inventory-section-header'
    header.textContent = row.label
    return header
  }

  const element = document.createElement('div')
  element.className = 'inventory-row entity-row'
  element.classList.add(`entity-row--${row.entityType}`)
  element.dataset.inventorySource = row.source
  populateEntityLabel(element, {
    title: row.title,
    subtitle: row.subtitle,
    badges: row.badges,
  })
  if (row.counts) {
    appendCountBadges(element, row.counts)
  }
  prependAgentBadge(element, row.record.id)
  if (row.context?.expressionId) element.dataset.expressionId = row.context.expressionId
  if (row.context?.expressionArk) element.dataset.expressionArk = row.context.expressionArk
  if (row.context?.workArk) element.dataset.workArk = row.context.workArk
  const isSameEntity = selectedEntity?.id === row.record.id
  const matchesExpressionId =
    !row.context?.expressionId || selectedEntity?.expressionId === row.context.expressionId
  const matchesExpressionArk =
    !row.context?.expressionArk || selectedEntity?.expressionArk === row.context.expressionArk
  const matchesWork = !row.context?.workArk || selectedEntity?.workArk === row.context.workArk
  if (isSameEntity && matchesExpressionId && matchesExpressionArk && matchesWork) {
    element.classList.add('selected')
  }
  element.dataset.inventoryId = row.record.id
  element.dataset.inventoryType = row.entityType

  const onSingle = handlers.onSingle ?? (() => handleInventoryEntityClick(row))
  const onDouble = handlers.onDouble ?? (() => handleInventoryEntityDoubleClick(row))
  bindSingleAndDouble(
    element,
    () => onSingle(),
    () => onDouble(),
  )
  return element
}

function handleInventoryEntityClick(row: InventoryRow) {
  if (row.kind !== 'entity') return
  selectInventoryRecord(row)
}

function handleInventoryEntityDoubleClick(row: InventoryRow) {
  if (row.kind !== 'entity') return
  if (row.entityType === 'work') {
    inventoryFocusWork = row.record
    inventoryFocusExpression = null
    viewMode = 'expressions'
    renderCurrentView()
  } else if (row.entityType === 'expression') {
    inventoryFocusExpression = row.record
    const workArks = expressionWorkArks(row.record)
    const primaryArk = workArks[0]
    inventoryFocusWork = primaryArk ? originalWorksByArk.get(primaryArk) ?? null : null
    viewMode = 'manifestations'
    renderCurrentView()
  }
}

function selectInventoryRecord(row: InventoryRow) {
  if (row.kind !== 'entity') return
  const rec = row.record
  const isCurated = row.source === 'curated'
  const context: Partial<SelectedEntity> = {
    entityType: row.entityType as SelectedEntity['entityType'],
  }
  const rowContext = row.context ?? {}
  if (row.entityType === 'work') {
    context.workArk = rowContext.workArk ?? rec.ark
  } else if (row.entityType === 'expression') {
    context.expressionId = rowContext.expressionId ?? rec.id
    context.expressionArk = rowContext.expressionArk ?? rec.ark
    const workArk = rowContext.workArk ?? expressionWorkArks(rec)[0]
    if (workArk) context.workArk = workArk
  } else if (row.entityType === 'manifestation') {
    const exprArk = rowContext.expressionArk ?? manifestationExpressionArks(rec)[0]
    if (exprArk) context.expressionArk = exprArk
    const exprRecord =
      (rowContext.expressionId && combinedRecordsById.get(rowContext.expressionId)) ||
      (exprArk ? originalExpressionsByArk.get(exprArk) ?? null : null)
    const expressionId = rowContext.expressionId ?? exprRecord?.id
    if (expressionId) context.expressionId = expressionId
    const workArk = rowContext.workArk ?? (exprRecord ? expressionWorkArks(exprRecord)[0] : undefined)
    if (workArk) context.workArk = workArk
  }
  showRecordDetails(rec.id, isCurated, context)
}

function renderInventoryWorkList() {
  inventoryExpressionIndexById.clear()
  inventoryManifestationIndexById.clear()
  inventoryExpressionFilterArk = null
  if (!inventoryRows.length) {
    const empty = document.createElement('div')
    empty.className = 'inventory-empty'
    empty.textContent = t('inventory.empty')
    clustersEl.appendChild(empty)
    return
  }
  const container = document.createElement('div')
  container.className = 'inventory-list'
  clustersEl.appendChild(container)
  const fragment = document.createDocumentFragment()
  inventoryRows.forEach(row => {
    const element = createInventoryRowElement(row)
    fragment.appendChild(element)
  })
  container.appendChild(fragment)
}

function buildInventoryBreadcrumb(items: Array<{ label: string; action?: () => void }>): HTMLDivElement {
  const nav = document.createElement('div')
  nav.className = 'inventory-breadcrumb'
  items.forEach((item, index) => {
    if (index > 0) {
      const separator = document.createElement('span')
      separator.className = 'inventory-breadcrumb-separator'
      separator.textContent = '›'
      nav.appendChild(separator)
    }
    if (item.action) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'inventory-breadcrumb-link'
      btn.textContent = item.label
      btn.onclick = item.action
      nav.appendChild(btn)
    } else {
      const span = document.createElement('span')
      span.className = 'inventory-breadcrumb-current'
      span.textContent = item.label
      nav.appendChild(span)
    }
  })
  return nav
}

function createInventoryEmptyState(messageKey: string): HTMLElement {
  const empty = document.createElement('div')
  empty.className = 'inventory-empty'
  empty.textContent = t(messageKey)
  return empty
}

function renderInventoryExpressionList(work: RecordRow) {
  inventoryExpressionIndexById.clear()
  inventoryManifestationIndexById.clear()
  inventoryExpressionFilterArk = null
  const container = document.createElement('div')
  container.className = 'inventory-detail'
  const breadcrumb = buildInventoryBreadcrumb([
    {
      label: t('inventory.breadcrumb.works'),
      action: () => {
        listScope = 'clusters'
        viewMode = 'works'
        highlightedWorkArk = work.ark || null
        inventoryFocusWork = null
        inventoryFocusExpression = null
        inventoryExpressionFilterArk = null
        renderCurrentView()
      },
    },
    { label: inventoryWorkTitle(work) },
  ])
  container.appendChild(breadcrumb)
  const expressions = originalExpressionsByWorkArk.get(work.ark || '') ?? []
  const header = document.createElement('h3')
  header.className = 'inventory-detail-title'
  header.textContent = t('inventory.headers.expressions', { count: expressions.length })
  container.appendChild(header)
  const list = document.createElement('div')
  list.className = 'inventory-detail-list'
  container.appendChild(list)
  if (!expressions.length) {
    list.appendChild(createInventoryEmptyState('inventory.emptyExpressions'))
    clustersEl.appendChild(container)
    return
  }
  expressions.forEach((expr, index) => {
    const row = buildInventoryRowForExpression(expr)
    const element = createInventoryRowElement(row, {
      onSingle: () => selectInventoryRecord(row),
      onDouble: () => handleInventoryExpressionDoubleClick(expr),
    })
    element.classList.add('inventory-row--detail')
    element.dataset.expressionId = expr.id
    element.dataset.expressionArk = expr.ark || ''
    inventoryExpressionIndexById.set(expr.id, index)
    list.appendChild(element)
  })
  clustersEl.appendChild(container)
}

function expressionFilterKey(rec: RecordRow): string {
  return rec.ark || rec.id
}

function lookupWorkRecordByArk(ark?: string | null): RecordRow | null {
  if (!ark) return null
  const normalized = ark.toLowerCase()
  return originalWorksByArk.get(ark) ?? combinedRecordsByArk.get(normalized) ?? null
}

function buildInventoryManifestationFilterBanner(
  workRecord: RecordRow | null,
  expressions: RecordRow[],
  activeExpression: RecordRow,
): HTMLDivElement {
  const banner = document.createElement('div')
  banner.className = 'cluster-banner work-banner expression-filter-banner'

  const bannerLabel = document.createElement('div')
  bannerLabel.className = 'banner-label'
  const selectedExpression = inventoryExpressionFilterArk
    ? expressions.find(expr => expressionFilterKey(expr) === inventoryExpressionFilterArk) ?? null
    : null
  const badges: EntityBadgeSpec[] = []
  if (selectedExpression) {
    badges.push({ type: 'expression', text: selectedExpression.id, tooltip: selectedExpression.ark })
  }
  populateEntityLabel(bannerLabel, {
    title: selectedExpression ? inventoryExpressionTitle(selectedExpression) : t('manifestationFilter.titleDefault'),
    subtitle: selectedExpression ? t('manifestationFilter.subtitleActive') : t('manifestationFilter.subtitleDefault'),
    badges: badges.length ? badges : undefined,
  })
  banner.appendChild(bannerLabel)

  const controls = document.createElement('div')
  controls.className = 'banner-control expression-filter-control'
  const labelEl = document.createElement('label')
  labelEl.textContent = t('banners.showManifestations')
  controls.appendChild(labelEl)

  const select = document.createElement('select')
  select.classList.add('work-selector', 'expression-filter-select')
  const allOption = document.createElement('option')
  allOption.value = '__all__'
  allOption.textContent = t('banners.allExpressions')
  select.appendChild(allOption)

  expressions.forEach(expr => {
    const option = document.createElement('option')
    option.value = expressionFilterKey(expr)
    option.textContent = inventoryExpressionTitle(expr)
    select.appendChild(option)
  })

  select.value = inventoryExpressionFilterArk ?? '__all__'
  select.onchange = () => {
    inventoryExpressionFilterArk = select.value === '__all__' ? null : select.value
    renderCurrentView()
  }

  controls.appendChild(select)

  const viewExpressionsBtn = document.createElement('button')
  viewExpressionsBtn.type = 'button'
  viewExpressionsBtn.className = 'banner-mode-btn'
  viewExpressionsBtn.textContent = t('buttons.viewExpressions')
  viewExpressionsBtn.onclick = event => {
    event.stopPropagation()
    viewMode = 'expressions'
    inventoryFocusWork = workRecord ?? inventoryFocusWork
    const target = inventoryExpressionFilterArk
      ? expressions.find(expr => expressionFilterKey(expr) === inventoryExpressionFilterArk)
      : activeExpression
    if (target) {
      inventoryFocusExpression = target
      pendingScrollEntity = {
        id: target.id,
        source: 'original',
        entityType: 'expression',
        expressionId: target.id,
        expressionArk: target.ark,
        workArk: expressionWorkArks(target)[0] || workRecord?.ark,
      }
    }
    renderCurrentView()
  }

  controls.appendChild(viewExpressionsBtn)
  banner.appendChild(controls)
  return banner
}

function handleInventoryExpressionDoubleClick(expression: RecordRow) {
  inventoryFocusExpression = expression
  const workArks = expressionWorkArks(expression)
  const primaryArk = workArks[0]
  if (primaryArk) {
    const workRecord = originalWorksByArk.get(primaryArk)
    if (workRecord) inventoryFocusWork = workRecord
  }
  viewMode = 'manifestations'
  renderCurrentView()
}

function renderInventoryManifestationList(expression: RecordRow) {
  inventoryManifestationIndexById.clear()
  const container = document.createElement('div')
  container.className = 'inventory-detail'
  const workArks = expressionWorkArks(expression)
  const workRecord = workArks.length ? originalWorksByArk.get(workArks[0]) ?? inventoryFocusWork : inventoryFocusWork
  const breadcrumbItems: Array<{ label: string; action?: () => void }> = [
    {
      label: t('inventory.breadcrumb.works'),
      action: () => {
        listScope = 'clusters'
        viewMode = 'works'
        const targetWorkArk = workRecord?.ark ?? workArks[0] ?? null
        highlightedWorkArk = targetWorkArk
        inventoryFocusWork = null
        inventoryFocusExpression = null
        inventoryExpressionFilterArk = null
        renderCurrentView()
      },
    },
  ]
  if (workRecord) {
    breadcrumbItems.push({
      label: inventoryWorkTitle(workRecord),
      action: () => {
        inventoryFocusWork = workRecord
        inventoryFocusExpression = null
        inventoryExpressionFilterArk = null
        viewMode = 'expressions'
        renderCurrentView()
      },
    })
  }
  breadcrumbItems.push({
    label: inventoryExpressionTitle(expression),
    action: () => {
      inventoryFocusExpression = expression
      inventoryFocusWork = workRecord ?? inventoryFocusWork
      inventoryExpressionFilterArk = null
      viewMode = 'expressions'
      renderCurrentView()
    },
  })
  container.appendChild(buildInventoryBreadcrumb(breadcrumbItems))

  const baseWorkArk = workRecord?.ark || workArks[0] || ''
  const expressionList = baseWorkArk
    ? [...(originalExpressionsByWorkArk.get(baseWorkArk) ?? [])]
    : []
  if (!expressionList.some(expr => expr.id === expression.id)) {
    expressionList.push(expression)
  }
  const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
  expressionList.sort((a, b) => collator.compare(inventoryExpressionTitle(a), inventoryExpressionTitle(b)))

  if (inventoryExpressionFilterArk) {
    const hasMatch = expressionList.some(expr => expressionFilterKey(expr) === inventoryExpressionFilterArk)
    if (!hasMatch) inventoryExpressionFilterArk = null
  }

  const filteredExpressions = inventoryExpressionFilterArk
    ? expressionList.filter(expr => expressionFilterKey(expr) === inventoryExpressionFilterArk)
    : expressionList

  const manifestCount = filteredExpressions.reduce((total, expr) => {
    const items = originalManifestationsByExpressionArk.get(expr.ark || '') ?? []
    return total + items.length
  }, 0)

  const header = document.createElement('h3')
  header.className = 'inventory-detail-title'
  header.textContent = t('inventory.headers.manifestations', { count: manifestCount })
  container.appendChild(header)

  if (expressionList.length > 1) {
    container.appendChild(buildInventoryManifestationFilterBanner(workRecord ?? null, expressionList, expression))
  }

  const list = document.createElement('div')
  list.className = 'inventory-detail-list manifestation-groups'
  container.appendChild(list)

  if (!filteredExpressions.length) {
    list.appendChild(createInventoryEmptyState('inventory.emptyManifestations'))
    clustersEl.appendChild(container)
    return
  }

  let manifestIndex = 0
  for (const expr of filteredExpressions) {
    const manifestations = originalManifestationsByExpressionArk.get(expr.ark || '') ?? []
    const section = document.createElement('div')
    section.className = 'manifestation-section'
    section.dataset.expressionId = expr.id
    if (expr.ark) section.dataset.expressionArk = expr.ark
    if (expr.id === expression.id) section.classList.add('active')
    const isExpressionSelected = selectedEntity?.entityType === 'expression' && selectedEntity.id === expr.id
    const isManifestationSelected =
      selectedEntity?.entityType === 'manifestation' && selectedEntity.expressionId === expr.id
    if (isExpressionSelected || isManifestationSelected) {
      section.classList.add('highlight')
    }
    if (inventoryExpressionFilterArk && expressionFilterKey(expr) === inventoryExpressionFilterArk) {
      section.classList.add('filter-match')
    }

    const exprWorkArk = expressionWorkArks(expr)[0] || baseWorkArk
    const label = document.createElement('div')
    label.className = 'entity-label manifestation-label'
    const badges: EntityBadgeSpec[] = [{ type: 'expression', text: expr.id, tooltip: expr.ark }]
    if (exprWorkArk && workRecord?.id) {
      badges.push({ type: 'work', text: workRecord.id, tooltip: exprWorkArk })
    } else if (exprWorkArk) {
      badges.push({ type: 'work', text: exprWorkArk })
    }
    populateEntityLabel(label, {
      title: inventoryExpressionTitle(expr),
      subtitle: expr.ark || undefined,
      badges,
    })
    appendCountBadges(label, { manifestations: manifestations.length })
    prependAgentBadge(label, expr.id)
    if (isExpressionSelected) {
      label.classList.add('selected')
    } else if (isManifestationSelected) {
      label.classList.add('highlight')
    }
    label.addEventListener('click', () => {
      const row = buildInventoryRowForExpression(expr)
      inventoryFocusExpression = expr
      inventoryFocusWork = workRecord ?? inventoryFocusWork
      selectInventoryRecord(row)
    })
    section.appendChild(label)

    const groupList = document.createElement('div')
    groupList.className = 'manifestation-list'
    if (!manifestations.length) {
      groupList.appendChild(createInventoryEmptyState('inventory.emptyManifestations'))
    } else {
      manifestations.forEach(man => {
        const row = buildInventoryRowForManifestation(man, {
          expressionId: expr.id,
          expressionArk: expr.ark,
          workArk: exprWorkArk,
        })
        const element = createInventoryRowElement(row, {
          onSingle: () => selectInventoryRecord(row),
        })
        element.classList.add('manifestation-item')
        element.classList.add('inventory-row--detail')
        element.dataset.manifestationId = man.id
        const contextKey = manifestationIndexKey(expr.id, expr.ark)
        let indexMap = inventoryManifestationIndexById.get(man.id)
        if (!indexMap) {
          indexMap = new Map()
          inventoryManifestationIndexById.set(man.id, indexMap)
        }
        indexMap.set(contextKey, manifestIndex)
        manifestIndex += 1
        groupList.appendChild(element)
      })
    }
    section.appendChild(groupList)
    list.appendChild(section)
  }

  clustersEl.appendChild(container)
}

function buildWorkBanner(cluster: Cluster): HTMLDivElement {
  const banner = document.createElement('div')
  banner.className = 'cluster-banner work-banner'
  banner.dataset.clusterAnchorId = cluster.anchorId
  banner.dataset.workArk = cluster.anchorArk

  const bannerLabel = document.createElement('div')
  bannerLabel.className = 'banner-label'
  populateEntityLabel(bannerLabel, {
    title: cluster.anchorTitle || cluster.anchorId,
    subtitle: t('banners.anchorSubtitle'),
    badges: [{ type: 'work', text: cluster.anchorId, tooltip: cluster.anchorArk }],
  })
  banner.appendChild(bannerLabel)

  const selectWrap = document.createElement('div')
  selectWrap.className = 'banner-control'
  const selectLabel = document.createElement('label')
  selectLabel.textContent = t('banners.pickWork')
  const select = document.createElement('select')
  select.classList.add('work-selector')

  const allOption = document.createElement('option')
  allOption.value = '__all__'
  allOption.textContent = t('banners.allWorks')
  select.appendChild(allOption)

  const anchorGroup = document.createElement('optgroup')
  anchorGroup.label = t('banners.anchorGroup')
  const anchorOption = document.createElement('option')
  anchorOption.value = cluster.anchorArk
  anchorOption.textContent = `${cluster.anchorTitle || cluster.anchorId} • ${t('entity.work', { id: cluster.anchorId })}`
  anchorGroup.appendChild(anchorOption)
  select.appendChild(anchorGroup)

  if (cluster.items.length) {
    const clusteredGroup = document.createElement('optgroup')
    clusteredGroup.label = t('banners.clusteredGroup')
    for (const item of cluster.items) {
      if (!item.ark) continue
      const opt = document.createElement('option')
      opt.value = item.ark
      const hints: string[] = []
      if (!item.accepted) hints.push(t('labels.uncheckedTag'))
      const suffix = hints.length ? ` [${hints.join(', ')}]` : ''
      const labelParts: string[] = []
      labelParts.push(item.title || item.id || item.ark)
      if (item.id) labelParts.push(t('entity.work', { id: item.id }))
      opt.textContent = `${labelParts.join(' • ')}${suffix}`
      clusteredGroup.appendChild(opt)
    }
    if (clusteredGroup.children.length) select.appendChild(clusteredGroup)
  }

  select.value = highlightedWorkArk === null ? '__all__' : highlightedWorkArk || '__all__'
  select.onchange = () => handleWorkSelectionChange(cluster, select.value)

  selectWrap.appendChild(selectLabel)
  selectWrap.appendChild(select)

  if (viewMode !== 'works') {
    const modeBtn = document.createElement('button')
    modeBtn.type = 'button'
    modeBtn.className = 'banner-mode-btn'
    modeBtn.textContent = t('buttons.viewWorks')
    modeBtn.onclick = event => {
      event.stopPropagation()
      viewMode = 'works'
      activeWorkAnchorId = cluster.anchorId
      highlightedWorkArk = cluster.anchorArk
      pendingScrollEntity = {
        id: cluster.anchorId,
        source: 'curated',
        entityType: 'work',
        clusterAnchorId: cluster.anchorId,
        isAnchor: true,
        workArk: cluster.anchorArk,
      }
      renderCurrentView()
    }
    selectWrap.appendChild(modeBtn)
  }

  banner.appendChild(selectWrap)
  banner.addEventListener('dblclick', event => {
    event.stopPropagation()
    if (viewMode !== 'works') {
      viewMode = 'works'
      activeWorkAnchorId = cluster.anchorId
      highlightedWorkArk = cluster.anchorArk
      pendingScrollEntity = {
        id: cluster.anchorId,
        source: 'curated',
        entityType: 'work',
        clusterAnchorId: cluster.anchorId,
        isAnchor: true,
        workArk: cluster.anchorArk,
      }
      renderCurrentView()
    }
  })
  return banner
}

type ExpressionFilterInfo = {
  expressionId: string
  expressionArk: string
  expressionTitle?: string
  workArk: string
  workId?: string
  workLabel: string
  anchorExpressionId: string | null
  isAnchor: boolean
}

function buildManifestationExpressionFilterBanner(cluster: Cluster): HTMLDivElement {
  const banner = document.createElement('div')
  banner.className = 'cluster-banner work-banner expression-filter-banner'

  const bannerLabel = document.createElement('div')
  bannerLabel.className = 'banner-label'

  const workMeta = new Map<string, { title?: string; id?: string }>()
  workMeta.set(cluster.anchorArk, { title: cluster.anchorTitle, id: cluster.anchorId })
  for (const item of cluster.items) {
    if (!item.ark) continue
    workMeta.set(item.ark, { title: item.title, id: item.id })
  }

  const expressionLookup = new Map<string, ExpressionFilterInfo>()
  const grouped = new Map<string, { label: string; expressions: ExpressionFilterInfo[] }>()

  const registerExpression = (
    expr: ExpressionItem | ExpressionClusterItem,
    anchorExpressionId: string | null,
    isAnchor: boolean,
  ) => {
    if (!expr.ark) return
    const workArk = expr.workArk || cluster.anchorArk
    const meta = workMeta.get(workArk)
    const parts: string[] = []
    if (meta?.title) parts.push(meta.title)
    if (meta?.id) parts.push(t('entity.work', { id: meta.id }))
    if (!parts.length) {
      if (expr.workId) {
        parts.push(t('entity.work', { id: expr.workId }))
      } else if (workArk) {
        parts.push(workArk)
      } else {
        parts.push(t('labels.workFallback'))
      }
    }
    const workLabel = parts.join(' • ')
    const info: ExpressionFilterInfo = {
      expressionId: expr.id,
      expressionArk: expr.ark,
      expressionTitle: expr.title,
      workArk,
      workId: meta?.id || expr.workId,
      workLabel,
      anchorExpressionId,
      isAnchor,
    }
    expressionLookup.set(expr.ark, info)
    const key = workArk || `work:${info.workId || expr.id}`
    const group = grouped.get(key) || { label: workLabel, expressions: [] }
    group.label = workLabel
    group.expressions.push(info)
    grouped.set(key, group)
  }

  for (const group of cluster.expressionGroups) {
    registerExpression(group.anchor, group.anchor.id, true)
    for (const expr of group.clustered) {
      registerExpression(expr, group.anchor.id, false)
    }
  }
  for (const expr of cluster.independentExpressions) {
    registerExpression(expr, null, false)
  }

  if (expressionFilterArk && !expressionLookup.has(expressionFilterArk)) {
    expressionFilterArk = null
  }

  const selectedInfo = expressionFilterArk ? expressionLookup.get(expressionFilterArk) : null
  const badges: EntityBadgeSpec[] = []
  if (selectedInfo) {
    badges.push({ type: 'expression', text: selectedInfo.expressionId, tooltip: selectedInfo.expressionArk })
    if (selectedInfo.workId) {
      badges.push({ type: 'work', text: selectedInfo.workId, tooltip: selectedInfo.workArk })
    }
  }
  const titleText =
    selectedInfo?.expressionTitle || selectedInfo?.expressionId || t('manifestationFilter.titleDefault')
  const subtitleText = selectedInfo
    ? t('manifestationFilter.subtitleActive')
    : t('manifestationFilter.subtitleDefault')
  populateEntityLabel(bannerLabel, {
    title: titleText,
    subtitle: subtitleText,
    badges: badges.length ? badges : undefined,
  })
  banner.appendChild(bannerLabel)

  const controls = document.createElement('div')
  controls.className = 'banner-control expression-filter-control'
  const labelEl = document.createElement('label')
  labelEl.textContent = t('banners.showManifestations')
  controls.appendChild(labelEl)

  const select = document.createElement('select')
  select.classList.add('work-selector', 'expression-filter-select')
  const allOption = document.createElement('option')
  allOption.value = '__all__'
  allOption.textContent = t('banners.allExpressions')
  select.appendChild(allOption)

  for (const [, group] of grouped) {
    const optGroup = document.createElement('optgroup')
    optGroup.label = group.label
    for (const info of group.expressions) {
      const option = document.createElement('option')
      option.value = info.expressionArk
      option.textContent = info.expressionTitle || info.expressionId
      optGroup.appendChild(option)
    }
    select.appendChild(optGroup)
  }

  select.value = expressionFilterArk && expressionLookup.has(expressionFilterArk) ? expressionFilterArk : '__all__'
  controls.appendChild(select)

  const viewExpressionsBtn = document.createElement('button')
  viewExpressionsBtn.type = 'button'
  viewExpressionsBtn.className = 'banner-mode-btn'
  viewExpressionsBtn.textContent = t('buttons.viewExpressions')

  const applyExpressionFilter = (value: string) => {
    if (value === '__all__') {
      expressionFilterArk = null
      highlightedExpressionArk = null
      return
    }
    expressionFilterArk = value
    highlightedExpressionArk = value
    const info = expressionLookup.get(value)
    if (info) {
      highlightedWorkArk = info.workArk
      activeExpressionAnchorId = info.anchorExpressionId
    }
  }

  select.onchange = () => {
    applyExpressionFilter(select.value)
    renderCurrentView()
  }

  viewExpressionsBtn.onclick = event => {
    event.stopPropagation()
    viewMode = 'expressions'
    activeWorkAnchorId = cluster.anchorId
    if (expressionFilterArk && expressionLookup.has(expressionFilterArk)) {
      const info = expressionLookup.get(expressionFilterArk)!
      activeExpressionAnchorId = info.anchorExpressionId ?? info.expressionId
      highlightedExpressionArk = info.expressionArk
      highlightedWorkArk = info.workArk
      pendingScrollEntity = {
        id: info.expressionId,
        source: 'curated',
        entityType: 'expression',
        clusterAnchorId: cluster.anchorId,
        isAnchor: info.isAnchor,
        workArk: info.workArk,
        expressionId: info.expressionId,
        expressionArk: info.expressionArk,
      }
    }
    renderCurrentView()
  }

  controls.appendChild(viewExpressionsBtn)
  banner.appendChild(controls)
  return banner
}

function findWorkRecord(
  cluster: Cluster,
  workArk: string | null | undefined,
): { record: RecordRow | undefined; source: 'curated' | 'original' } {
  if (!workArk) return { record: undefined, source: 'curated' }
  if (workArk === cluster.anchorArk) {
    const anchorRecord = curatedRecords.find(r => r.id === cluster.anchorId)
    if (anchorRecord) return { record: anchorRecord, source: 'curated' }
  }
  let record = curatedRecords.find(r => r.ark === workArk)
  if (record) return { record, source: 'curated' }
  record = originalRecords.find(r => r.ark === workArk)
  if (record) return { record, source: 'original' }
  const item = cluster.items.find(entry => entry.ark === workArk)
  if (item?.id) {
    record = curatedRecords.find(r => r.id === item.id)
    if (record) return { record, source: 'curated' }
    record = originalRecords.find(r => r.id === item.id)
    if (record) return { record, source: 'original' }
  }
  return { record: undefined, source: 'curated' }
}

function handleWorkSelectionChange(cluster: Cluster, value: string) {
  activeWorkAnchorId = cluster.anchorId
  highlightedWorkArk = value === '__all__' ? null : value

  // Clear expression filter if it conflicts with the selected work filter
  if (highlightedWorkArk && expressionFilterArk) {
    const exprInfo = findExpressionInCluster(cluster, undefined, expressionFilterArk)
    if (!exprInfo || exprInfo.workArk !== highlightedWorkArk) {
      expressionFilterArk = null
    }
  }

  renderCurrentView()
}

function scrollEntityIntoView(entity: SelectedEntity) {
  if (listScope === 'inventory') {
    if (viewMode === 'works') {
      if (entity.id) {
        const rows = Array.from(
          clustersEl.querySelectorAll<HTMLElement>('.inventory-list .inventory-row[data-inventory-id]'),
        )
        const target = rows.find(row => row.dataset.inventoryId === entity.id)
        target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }
    if (viewMode === 'expressions') {
      const expressionId = entity.expressionId ?? entity.id
      if (expressionId) {
        const index = inventoryExpressionIndexById.get(expressionId)
        if (index !== undefined) {
          const row = clustersEl.querySelector(
            `.inventory-detail-list .inventory-row[data-expression-id="${expressionId}"]`,
          ) as HTMLElement | null
          row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
      return
    }
    if (viewMode === 'manifestations') {
      const manifestationId = entity.entityType === 'manifestation' ? entity.id : undefined
      if (manifestationId) {
        const contextMap = inventoryManifestationIndexById.get(manifestationId)
        const key = manifestationIndexKey(entity.expressionId ?? null, entity.expressionArk ?? null)
        let selectorSuffix = ''
        if (contextMap?.has(key)) {
          if (entity.expressionId) selectorSuffix = `[data-expression-id="${entity.expressionId}"]`
          else if (entity.expressionArk) selectorSuffix = `[data-expression-ark="${entity.expressionArk}"]`
        } else if (contextMap && contextMap.size) {
          const fallbackKey = contextMap.keys().next().value as string | undefined
          if (fallbackKey?.startsWith('id:')) {
            selectorSuffix = `[data-expression-id="${fallbackKey.slice(3)}"]`
          } else if (fallbackKey?.startsWith('ark:')) {
            selectorSuffix = `[data-expression-ark="${fallbackKey.slice(4)}"]`
          }
        }
        let row = clustersEl.querySelector(
          `.inventory-detail-list .inventory-row[data-manifestation-id="${manifestationId}"]${selectorSuffix}`,
        ) as HTMLElement | null
        if (!row) {
          row = clustersEl.querySelector(
            `.inventory-detail-list .inventory-row[data-manifestation-id="${manifestationId}"]`,
          ) as HTMLElement | null
        }
        row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
      return
    }
  }

  let target: HTMLElement | null = null
  const clusterContext = entity.clusterAnchorId ? clusters.find(c => c.anchorId === entity.clusterAnchorId) : undefined
  const anchorArk = clusterContext?.anchorArk
  if (entity.entityType === 'work') {
    if (viewMode === 'works') {
      const targetArk = entity.workArk || anchorArk
      if (targetArk) {
        target = clustersEl.querySelector(`.cluster[data-work-ark="${targetArk}"]`) as HTMLElement | null
      }
      if (!target && entity.workArk) {
        target = clustersEl.querySelector(`.cluster-item[data-work-ark="${entity.workArk}"]`) as HTMLElement | null
      }
      if (!target && entity.id) {
        target = clustersEl.querySelector(`.cluster-header-row[data-work-id="${entity.id}"]`) as HTMLElement | null
      }
      if (!target && entity.id) {
        target = clustersEl.querySelector(`.cluster.cluster--unclustered[data-work-id="${entity.id}"]`) as HTMLElement | null
      }
    } else {
      target = clustersEl.querySelector('.cluster-banner.work-banner') as HTMLElement | null
    }
  } else if (entity.entityType === 'expression') {
    if (viewMode === 'expressions') {
      if (entity.isAnchor && entity.expressionId) {
        target = clustersEl.querySelector(`.expression-anchor[data-expression-id="${entity.expressionId}"]`) as HTMLElement | null
      }
      if (!target && entity.expressionId) {
        target = clustersEl.querySelector(`.expression-item[data-expression-id="${entity.expressionId}"]`) as HTMLElement | null
      }
    } else if (viewMode === 'manifestations' && entity.expressionArk) {
      target = clustersEl.querySelector(`.manifestation-section[data-expression-ark="${entity.expressionArk}"]`) as HTMLElement | null
    }
  } else if (entity.entityType === 'manifestation') {
    if (viewMode === 'manifestations') {
      target = clustersEl.querySelector(`.manifestation-item[data-manifestation-id="${entity.id}"]`) as HTMLElement | null
    }
  }
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

function renderExpressionClusters() {
  if (!clusters.length) return
  let cluster = clusters.find(c => c.anchorId === activeWorkAnchorId)
  if (!cluster) {
    cluster = clusters[0]
    activeWorkAnchorId = cluster.anchorId
  }
  if (!cluster) return
  const validWorkArks = new Set<string>([cluster.anchorArk, ...cluster.items.map(i => i.ark)])
  if (highlightedWorkArk === undefined) {
    highlightedWorkArk = null
  } else if (highlightedWorkArk !== null && !validWorkArks.has(highlightedWorkArk)) {
    highlightedWorkArk = null
  }

  clustersEl.appendChild(buildWorkBanner(cluster))

  const groupsWrap = document.createElement('div')
  groupsWrap.className = 'expression-groups'

  for (const group of cluster.expressionGroups) {
    const groupEl = document.createElement('div')
    groupEl.className = 'expression-group'
    if (group.anchor.id === activeExpressionAnchorId) groupEl.classList.add('active')
    groupEl.dataset.anchorExpressionId = group.anchor.id
    groupEl.dataset.expressionArk = group.anchor.ark
    const workFilterArk = highlightedWorkArk || null

    const anchorRow = document.createElement('div')
    anchorRow.className = 'expression-anchor entity-row entity-row--expression'
    const anchorSelection = selectedEntity
    const isAnchorExpressionSelected = anchorSelection?.entityType === 'expression' && anchorSelection.expressionId === group.anchor.id
    const isAnchorFromManifestation = anchorSelection?.entityType === 'manifestation' && anchorSelection.expressionId === group.anchor.id
    const isAnchorWorkContext = (!anchorSelection || anchorSelection.entityType === 'work') && (!highlightedWorkArk || highlightedWorkArk === cluster.anchorArk)
    if (isAnchorExpressionSelected) anchorRow.classList.add('selected')
    if (!isAnchorExpressionSelected && (isAnchorFromManifestation || isAnchorWorkContext)) {
      anchorRow.classList.add('highlight')
    }
    anchorRow.dataset.expressionId = group.anchor.id
    anchorRow.dataset.expressionArk = group.anchor.ark
    const anchorLabel = buildExpressionGroupLabel(group.anchor, {
      isAnchor: true,
      manifestationCount: group.anchor.manifestations.length,
    })
    setTooltip(anchorLabel, group.anchor.title || group.anchor.id)
    anchorRow.appendChild(anchorLabel)
    attachWorkPillNavigation(anchorLabel, cluster, group.anchor.workArk, group.anchor.workId)
    prependAgentBadge(anchorRow, group.anchor.id)
    const anchorMatchesWorkFilter = !workFilterArk || group.anchor.workArk === workFilterArk
    if (workFilterArk && anchorMatchesWorkFilter) {
      anchorRow.classList.add('filter-match')
    } else if (workFilterArk && !anchorMatchesWorkFilter) {
      anchorRow.classList.add('dimmed')
    }
    bindSingleAndDouble(
      anchorRow,
      () => {
        activeExpressionAnchorId = group.anchor.id
        highlightedExpressionArk = group.anchor.ark
        showRecordDetails(group.anchor.id, true, {
          entityType: 'expression',
          clusterAnchorId: cluster.anchorId,
          isAnchor: true,
          workArk: cluster.anchorArk,
          expressionId: group.anchor.id,
          expressionArk: group.anchor.ark,
        })
      },
      () => {
        activeWorkAnchorId = cluster.anchorId
        activeExpressionAnchorId = group.anchor.id
        highlightedExpressionArk = group.anchor.ark
        viewMode = 'manifestations'
        renderCurrentView()
      },
    )
    anchorRow.ondragover = e => {
      e.preventDefault()
      anchorRow.classList.add('drop-target')
    }
    anchorRow.ondragleave = () => anchorRow.classList.remove('drop-target')
    anchorRow.ondrop = e => {
      e.preventDefault()
      anchorRow.classList.remove('drop-target')
      const data = e.dataTransfer?.getData(EXPRESSION_DRAG_MIME)
      if (!data) return
      try {
        const payload = JSON.parse(data) as { sourceAnchorId: string; expressionArk: string }
        handleExpressionDrop(cluster!, payload.sourceAnchorId, payload.expressionArk, group.anchor.id)
      } catch {}
    }
    groupEl.appendChild(anchorRow)

    const anchorAgents = getAgentInfoForRecord(group.anchor.id).normalized
    const sortedClustered = [...group.clustered].sort((a, b) => {
      const simA = agentSimilarity(anchorAgents, getAgentInfoForRecord(a.id).normalized)
      const simB = agentSimilarity(anchorAgents, getAgentInfoForRecord(b.id).normalized)
      if (simB !== simA) return simB - simA
      const labelA = a.title || a.id
      const labelB = b.title || b.id
      return labelA.localeCompare(labelB)
    })

    const itemsWrap = document.createElement('div')
    itemsWrap.className = 'expression-items'

    if (!sortedClustered.length) {
      const none = document.createElement('div')
      none.className = 'expression-empty'
      none.textContent = t('labels.noClusteredExpressions')
      itemsWrap.appendChild(none)
    }

    for (const expr of sortedClustered) {
      const row = document.createElement('div')
      row.className = 'expression-item entity-row entity-row--expression'
      if (!expr.accepted) row.classList.add('unchecked')
      const selection = selectedEntity
      const isSelectedExpression = selection?.entityType === 'expression' && selection.expressionId === expr.id
      const isManifestSelection = selection?.entityType === 'manifestation' && selection.expressionId === expr.id
      const isWorkSelection = selection?.entityType === 'work' && selection.workArk === expr.workArk
      const isFilteredWork = !selection && highlightedWorkArk !== null && expr.workArk === highlightedWorkArk
      if (isSelectedExpression) row.classList.add('selected')
      if (!isSelectedExpression && (isManifestSelection || isWorkSelection || isFilteredWork)) {
        row.classList.add('highlight')
      }
      row.dataset.expressionId = expr.id
      row.dataset.expressionArk = expr.ark
      row.draggable = true
      row.ondragstart = e => {
        e.dataTransfer?.setData(
          EXPRESSION_DRAG_MIME,
          JSON.stringify({ sourceAnchorId: group.anchor.id, expressionArk: expr.ark })
        )
        e.dataTransfer?.setDragImage(row, 10, 10)
        row.classList.add('dragging')
      }
      row.ondragend = () => row.classList.remove('dragging')

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = expr.accepted
      cb.onchange = () => handleExpressionCheckboxChange(cluster!, group.anchor.id, expr, cb.checked)

      const label = buildExpressionGroupLabel(expr, {
        isAnchor: false,
        manifestationCount: expr.manifestations.length,
      })
      setTooltip(label, expr.title || expr.id)
      attachWorkPillNavigation(label, cluster, expr.workArk, expr.workId)
      bindSingleAndDouble(
        label,
        () => {
          highlightedExpressionArk = expr.ark
          activeExpressionAnchorId = group.anchor.id
          showRecordDetails(expr.id, true, {
            entityType: 'expression',
            clusterAnchorId: cluster.anchorId,
            isAnchor: false,
            workArk: expr.workArk,
            expressionId: expr.id,
            expressionArk: expr.ark,
          })
        },
        event => {
          event.stopPropagation()
          activeWorkAnchorId = cluster.anchorId
          activeExpressionAnchorId = group.anchor.id
          highlightedExpressionArk = expr.ark
          viewMode = 'manifestations'
          renderCurrentView()
        },
      )

      row.appendChild(cb)
      row.appendChild(label)
      prependAgentBadge(row, expr.id)
      const matchesWorkFilter = !workFilterArk || expr.workArk === workFilterArk
      if (!matchesWorkFilter) {
        row.classList.add('filtered-out')
      } else if (workFilterArk) {
        row.classList.add('filter-match')
      }
      itemsWrap.appendChild(row)
    }

    groupEl.appendChild(itemsWrap)
    groupsWrap.appendChild(groupEl)
  }

  if (cluster.independentExpressions.length) {
    const independentBlock = document.createElement('div')
    independentBlock.className = 'expression-independent'
    const head = document.createElement('div')
    head.className = 'expression-independent-header'
    head.textContent = t('labels.independentExpressions')
    independentBlock.appendChild(head)
    let independentHasVisible = false
    for (const expr of cluster.independentExpressions) {
      const row = document.createElement('div')
      row.className = 'expression-item entity-row entity-row--expression independent'
      const selection = selectedEntity
      const isSelectedExpression = selection?.entityType === 'expression' && selection.expressionId === expr.id
      const isManifestSelection = selection?.entityType === 'manifestation' && selection.expressionId === expr.id
      const isWorkSelection = selection?.entityType === 'work' && selection.workArk === expr.workArk
      const isFilteredWork = !selection && highlightedWorkArk !== null && expr.workArk === highlightedWorkArk
      if (isSelectedExpression) row.classList.add('selected')
      if (!isSelectedExpression && (isManifestSelection || isWorkSelection || isFilteredWork)) {
        row.classList.add('highlight')
      }
      row.dataset.expressionId = expr.id
      row.dataset.expressionArk = expr.ark
      const exprBadges: EntityBadgeSpec[] = [{ type: 'expression', text: expr.id, tooltip: expr.ark }]
      if (expr.workId) exprBadges.push({ type: 'work', text: expr.workId, tooltip: expr.workArk })
      populateEntityLabel(row, {
        title: expr.title || expr.id,
        subtitle: t('entity.independentExpression'),
        badges: exprBadges,
      })
      appendCountBadges(row, { manifestations: expr.manifestations.length })
      attachWorkPillNavigation(row, cluster, expr.workArk, expr.workId)
      row.onclick = () => {
        highlightedExpressionArk = expr.ark
        showRecordDetails(expr.id, true, {
          entityType: 'expression',
          clusterAnchorId: cluster.anchorId,
          isAnchor: false,
          workArk: expr.workArk,
          expressionId: expr.id,
          expressionArk: expr.ark,
        })
      }
      prependAgentBadge(row, expr.id)
      const matchesWorkFilter = !highlightedWorkArk || expr.workArk === highlightedWorkArk
      if (!matchesWorkFilter) {
        row.classList.add('filtered-out')
      } else {
        if (highlightedWorkArk) row.classList.add('filter-match')
        independentHasVisible = true
      }
      independentBlock.appendChild(row)
    }
    if (!independentHasVisible && highlightedWorkArk) independentBlock.classList.add('filtered-out')
    groupsWrap.appendChild(independentBlock)
  }

  clustersEl.appendChild(groupsWrap)
}

type ManifestationSectionOptions = {
  parentAccepted?: boolean
  statusLabel?: string
  origin?: 'anchor' | 'clustered' | 'independent' | 'detached'
}

function createManifestationSection(
  expression: ExpressionItem,
  cluster: Cluster,
  anchorExpressionId: string | null,
  options: ManifestationSectionOptions = {},
  anchorAgents: Set<string> = getAgentInfoForRecord(anchorExpressionId || expression.id).normalized,
): HTMLElement {
  const section = document.createElement('div')
  section.className = 'manifestation-section'
  section.dataset.expressionArk = expression.ark
  section.dataset.expressionId = expression.id
  const selection = selectedEntity
  const isExpressionSelected = selection?.entityType === 'expression' && selection.expressionId === expression.id
  const isManifestationSelected = selection?.entityType === 'manifestation' && selection.expressionId === expression.id
  const isWorkContext = selection?.entityType === 'work' && selection.workArk === expression.workArk
  const isFilterExpression = !selection && highlightedExpressionArk !== null && highlightedExpressionArk === expression.ark
  if (isExpressionSelected || isManifestationSelected || isWorkContext || isFilterExpression) {
    section.classList.add('highlight')
  }

  const parentAccepted = options.parentAccepted !== false
  if (!parentAccepted) section.classList.add('inactive')

  const workFilterArk = highlightedWorkArk || null
  const matchesWorkFilter = !workFilterArk || expression.workArk === workFilterArk
  const matchesExpressionFilter = !expressionFilterArk || expression.ark === expressionFilterArk
  if (!matchesWorkFilter || !matchesExpressionFilter) {
    section.classList.add('filtered-out')
  } else if (expressionFilterArk || workFilterArk) {
    section.classList.add('filter-match')
  }

  const labelWrap = document.createElement('div')
  labelWrap.className = 'entity-label manifestation-label'
  const isAnchorOrigin = options.origin === 'anchor'
  if (!isAnchorOrigin) {
    const markerSpan = document.createElement('span')
    markerSpan.className = 'entity-marker'
    markerSpan.textContent = options.origin === 'clustered' ? '🍇' : '•'
    labelWrap.appendChild(markerSpan)

    const titleSpan = document.createElement('span')
    titleSpan.className = 'entity-title'
    titleSpan.textContent = expression.title || expression.id
    labelWrap.appendChild(titleSpan)
  } else {
    setTooltip(labelWrap, expression.title || expression.id)
    const anchorMarker = document.createElement('span')
    anchorMarker.className = 'manifestation-anchor-marker'
    anchorMarker.textContent = '⚓︎'
    labelWrap.appendChild(anchorMarker)
  }

  labelWrap.appendChild(createEntityPill('expression', expression.id, expression.ark))

  const descriptorParts: string[] = []
  if (options.origin === 'clustered') descriptorParts.push(t('entity.clusteredExpression'))
  else if (options.origin === 'independent') descriptorParts.push(t('entity.independentExpression'))
  else if (options.origin === 'detached') descriptorParts.push(t('labels.detachedExpression'))
  if (!parentAccepted && options.origin === 'clustered') descriptorParts.push(t('labels.uncheckedLabel'))
  if (options.statusLabel) descriptorParts.push(options.statusLabel)
  if (descriptorParts.length) {
    const subtitle = document.createElement('span')
    subtitle.className = 'entity-subtitle manifestation-meta'
    subtitle.textContent = descriptorParts.join(' · ')
    labelWrap.appendChild(subtitle)
  }

  labelWrap.addEventListener('click', () => {
    highlightedExpressionArk = expression.ark
    activeExpressionAnchorId = anchorExpressionId
    activeWorkAnchorId = cluster.anchorId
    showRecordDetails(expression.id, true, {
      entityType: 'expression',
      clusterAnchorId: cluster.anchorId,
      isAnchor: anchorExpressionId === expression.id,
      workArk: expression.workArk,
      expressionId: expression.id,
      expressionArk: expression.ark,
    })
  })

  section.appendChild(labelWrap)

  const list = createManifestationList(expression, cluster, anchorExpressionId, parentAccepted, anchorAgents)
  section.appendChild(list)
  return section
}

function attachWorkPillNavigation(container: HTMLElement, cluster: Cluster, workArk?: string, workId?: string) {
  if (!workArk) return
  const pill = container.querySelector('.entity-pill-work') as HTMLElement | null
  if (!pill) return
  const openWork = () => {
    handleWorkSelectionChange(cluster, workArk)
  }
  pill.classList.add('clickable-pill')
  pill.setAttribute('role', 'button')
  pill.setAttribute('tabindex', '0')
  pill.setAttribute('aria-label', t('aria.openWork', { id: workId || workArk }))
  pill.addEventListener('click', event => {
    event.stopPropagation()
    openWork()
  })
  pill.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      openWork()
    }
  })
}

function focusInventoryTreeUp() {
  if (!selectedEntity) return
  const entity = selectedEntity
  if (entity.entityType === 'manifestation') {
    const expressionRecord =
      (entity.expressionId && combinedRecordsById.get(entity.expressionId)) ||
      (entity.expressionArk && originalExpressionsByArk.get(entity.expressionArk)) ||
      null
    if (!expressionRecord) return
    const workArk = expressionWorkArks(expressionRecord)[0]
    const workRecord = workArk ? lookupWorkRecordByArk(workArk) : null
    if (workRecord) {
      inventoryFocusWork = workRecord
    }
    inventoryFocusExpression = null
    inventoryExpressionFilterArk = null
    viewMode = 'expressions'
    const row = buildInventoryRowForExpression(expressionRecord)
    pendingScrollEntity = {
      id: expressionRecord.id,
      source: 'original',
      entityType: 'expression',
      expressionId: expressionRecord.id,
      expressionArk: expressionRecord.ark,
      workArk: workRecord?.ark || workArk,
    }
    renderCurrentView()
    selectInventoryRecord(row)
    return
  }
  if (entity.entityType === 'expression') {
    const expressionRecord =
      combinedRecordsById.get(entity.id) ||
      (entity.expressionArk && originalExpressionsByArk.get(entity.expressionArk)) ||
      null
    const workArk = entity.workArk || (expressionRecord ? expressionWorkArks(expressionRecord)[0] : undefined)
    const workRecord = lookupWorkRecordByArk(workArk)
    if (!workRecord) return
    listScope = 'clusters'
    viewMode = 'works'
    highlightedWorkArk = workRecord.ark || null
    inventoryFocusWork = null
    inventoryFocusExpression = null
    inventoryExpressionFilterArk = null
    const isCurated = curatedRecords.some(r => r.id === workRecord.id)
    showRecordDetails(workRecord.id, isCurated, {
      entityType: 'work',
      workArk: workRecord.ark,
    })
    return
  }
  if (entity.entityType === 'work') {
    const workRecord = resolveWorkRecord(entity.id, entity.workArk)
    listScope = 'clusters'
    viewMode = 'works'
    inventoryFocusWork = null
    inventoryFocusExpression = null
    inventoryExpressionFilterArk = null
    highlightedWorkArk = workRecord?.ark || entity.workArk || null
    renderCurrentView()
    if (workRecord) {
      showRecordDetails(workRecord.id, curatedRecords.some(r => r.id === workRecord.id), {
        entityType: 'work',
        workArk: workRecord.ark,
      })
    }
    return
  }
}

function focusInventoryTreeDown() {
  if (!selectedEntity) return
  const entity = selectedEntity
  if (entity.entityType === 'work') {
    const workRecord = combinedRecordsById.get(entity.id) || lookupWorkRecordByArk(entity.workArk)
    if (!workRecord) return
    const workArk = workRecord.ark || entity.workArk
    const expressions = workArk ? [...(originalExpressionsByWorkArk.get(workArk) ?? [])] : []
    if (!expressions.length) {
      viewMode = 'expressions'
      inventoryFocusWork = workRecord
      inventoryFocusExpression = null
      renderCurrentView()
      notify(t('notifications.noExpressions'))
      return
    }
    const collator = new Intl.Collator(getCurrentLanguage(), { sensitivity: 'accent' })
    expressions.sort((a, b) => collator.compare(inventoryExpressionTitle(a), inventoryExpressionTitle(b)))
    const firstExpression = expressions[0]
    inventoryFocusWork = workRecord
    inventoryFocusExpression = null
    inventoryExpressionFilterArk = null
    viewMode = 'expressions'
    const row = buildInventoryRowForExpression(firstExpression)
    selectInventoryRecord(row)
    return
  }

  if (entity.entityType === 'expression') {
    const expressionRecord =
      combinedRecordsById.get(entity.id) ||
      (entity.expressionArk && originalExpressionsByArk.get(entity.expressionArk)) ||
      null
    if (!expressionRecord) return
    inventoryFocusExpression = expressionRecord
    const workArk = expressionWorkArks(expressionRecord)[0]
    if (workArk) {
      const workRecord = lookupWorkRecordByArk(workArk)
      if (workRecord) inventoryFocusWork = workRecord
    }
    viewMode = 'manifestations'
    inventoryExpressionFilterArk = null
    const manifestations = originalManifestationsByExpressionArk.get(expressionRecord.ark || '') ?? []
    if (!manifestations.length) {
      renderCurrentView()
      notify(t('notifications.noManifestations'))
      return
    }
    const row = buildInventoryRowForManifestation(manifestations[0], {
      expressionId: expressionRecord.id,
      expressionArk: expressionRecord.ark,
      workArk,
    })
    selectInventoryRecord(row)
  }
}

function focusTreeUp() {
  if (listScope === 'inventory') {
    focusInventoryTreeUp()
    return
  }
  if (!selectedEntity) return
  const entity = selectedEntity
  if (entity.entityType === 'manifestation') {
    if (!entity.clusterAnchorId || !entity.expressionId) return
    const cluster = clusters.find(c => c.anchorId === entity.clusterAnchorId)
    if (!cluster) return
    const expressionData = findExpressionInCluster(cluster, entity.expressionId, entity.expressionArk)
    const anchorId =
      expressionData && 'anchorExpressionId' in expressionData
        ? expressionData.anchorExpressionId
        : expressionData?.id || entity.expressionId
    activeWorkAnchorId = cluster.anchorId
    activeExpressionAnchorId = anchorId || null
    highlightedExpressionArk = expressionData?.ark || entity.expressionArk || null
    if (expressionData?.workArk) highlightedWorkArk = expressionData.workArk
    showRecordDetails(entity.expressionId, true, {
      entityType: 'expression',
      clusterAnchorId: cluster.anchorId,
      isAnchor: anchorId === entity.expressionId,
      workArk: expressionData?.workArk || cluster.anchorArk,
      expressionId: expressionData?.id || entity.expressionId,
      expressionArk: expressionData?.ark || entity.expressionArk,
    })
    return
  }
  if (entity.entityType === 'expression') {
    if (!entity.clusterAnchorId) return
    const cluster = clusters.find(c => c.anchorId === entity.clusterAnchorId)
    if (!cluster) return
    const targetWorkArk = entity.workArk || cluster.anchorArk
    const { record, source } = findWorkRecord(cluster, targetWorkArk)
    if (!record) return
    viewMode = 'works'
    highlightedWorkArk = targetWorkArk
    showRecordDetails(record.id, source === 'curated', {
      entityType: 'work',
      clusterAnchorId: cluster.anchorId,
      isAnchor: targetWorkArk === cluster.anchorArk,
      workArk: targetWorkArk,
    })
    return
  }
}

function focusTreeDown() {
  if (listScope === 'inventory') {
    focusInventoryTreeDown()
    return
  }
  if (!selectedEntity) return
  const entity = selectedEntity
  if (entity.entityType === 'work' && !entity.clusterAnchorId) {
    const workRecord = resolveWorkRecord(entity.id, entity.workArk)
    if (workRecord) openUnclusteredWorkExpressions(workRecord)
    return
  }
  if (entity.entityType === 'work') {
    const clusterId = entity.clusterAnchorId || entity.id
    const cluster = clusters.find(c => c.anchorId === clusterId)
    if (!cluster) return
    const targetWorkArk = entity.workArk || cluster.anchorArk
    const expression = findPrimaryExpressionForWork(cluster, targetWorkArk)
    activeWorkAnchorId = cluster.anchorId
    highlightedWorkArk = targetWorkArk
    if (!expression) {
      viewMode = 'expressions'
      renderCurrentView()
      notify(t('notifications.noExpressions'))
      return
    }
    let anchorId: string | null = null
    let isAnchor = false
    if ('anchorExpressionId' in expression) {
      anchorId = expression.anchorExpressionId
    } else if (cluster.expressionGroups.some(group => group.anchor.id === expression.id)) {
      anchorId = expression.id
      isAnchor = true
    }
    activeExpressionAnchorId = anchorId
    highlightedExpressionArk = expression.ark
    showRecordDetails(expression.id, true, {
      entityType: 'expression',
      clusterAnchorId: cluster.anchorId,
      isAnchor,
      workArk: expression.workArk,
      expressionId: expression.id,
      expressionArk: expression.ark,
    })
    return
  }

  if (entity.entityType === 'expression') {
    if (!entity.clusterAnchorId) return
    const cluster = clusters.find(c => c.anchorId === entity.clusterAnchorId)
    if (!cluster) return
    const expressionData = findExpressionInCluster(cluster, entity.expressionId, entity.expressionArk)
    if (!expressionData) return
    let anchorId: string | null = null
    let isAnchor = false
    if ('anchorExpressionId' in expressionData) {
      anchorId = expressionData.anchorExpressionId
    } else if (cluster.expressionGroups.some(group => group.anchor.id === expressionData.id)) {
      anchorId = expressionData.id
      isAnchor = true
    }
    activeWorkAnchorId = cluster.anchorId
    activeExpressionAnchorId = anchorId
    highlightedExpressionArk = expressionData.ark
    if (expressionData.workArk) highlightedWorkArk = expressionData.workArk
    viewMode = 'manifestations'
    const nextManifest = expressionData.manifestations[0]
    if (nextManifest) {
      showRecordDetails(nextManifest.id, true, {
        entityType: 'manifestation',
        clusterAnchorId: cluster.anchorId,
        isAnchor,
        workArk: expressionData.workArk,
        expressionId: expressionData.id,
        expressionArk: expressionData.ark,
      })
    } else {
      renderCurrentView()
      notify(t('notifications.noManifestations'))
    }
  }
}

function navigateList(direction: 'up' | 'down') {
  if (listScope === 'inventory') {
    navigateInventoryList(direction)
    return
  }
  if (viewMode === 'works') {
    navigateWorkList(direction)
  } else if (viewMode === 'expressions') {
    navigateExpressionList(direction)
  } else if (viewMode === 'manifestations') {
    navigateManifestationList(direction)
  }
}

function navigateInventoryList(direction: 'up' | 'down') {
  if (viewMode === 'works') {
    navigateInventoryWorkList(direction)
  } else if (viewMode === 'expressions') {
    navigateInventoryExpressionList(direction)
  } else if (viewMode === 'manifestations') {
    navigateInventoryManifestationList(direction)
  }
}

function navigateInventoryWorkList(direction: 'up' | 'down') {
  const rows = Array.from(
    clustersEl.querySelectorAll<HTMLElement>('.inventory-list .inventory-row[data-inventory-id]'),
  )
  if (!rows.length) return
  const entries = rows
    .map(row => ({ row, id: row.dataset.inventoryId }))
    .filter((entry): entry is { row: HTMLElement; id: string } => !!entry.id)
  if (!entries.length) return
  const currentId = selectedEntity?.id || null
  let currentIndex = currentId ? entries.findIndex(entry => entry.id === currentId) : -1
  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : entries.length
  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= entries.length) nextIndex = entries.length - 1
  if (nextIndex === currentIndex) return
  const target = entries[nextIndex]
  const rowData = inventoryRows.find(
    (row): row is InventoryEntityRow => row.kind === 'entity' && row.record.id === target.id,
  )
  if (!rowData) return
  target.row.scrollIntoView({ block: 'center', behavior: 'smooth' })
  selectInventoryRecord(rowData)
}

function navigateInventoryExpressionList(direction: 'up' | 'down') {
  const rows = Array.from(
    clustersEl.querySelectorAll<HTMLElement>('.inventory-detail-list .inventory-row[data-expression-id]'),
  )
  if (!rows.length) return
  const currentId = selectedEntity?.entityType === 'expression' ? selectedEntity.id : null
  let currentIndex = currentId ? rows.findIndex(row => row.dataset.expressionId === currentId) : -1
  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : rows.length
  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= rows.length) nextIndex = rows.length - 1
  if (nextIndex === currentIndex) return
  const target = rows[nextIndex]
  const expressionId = target.dataset.expressionId
  if (!expressionId) return
  const record = combinedRecordsById.get(expressionId)
  if (!record) return
  const row = buildInventoryRowForExpression(record)
  selectInventoryRecord(row)
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function navigateInventoryManifestationList(direction: 'up' | 'down') {
  const rows = Array.from(
    clustersEl.querySelectorAll<HTMLElement>('.inventory-detail-list .manifestation-item[data-manifestation-id]'),
  )
  if (!rows.length) return
  const currentId = selectedEntity?.entityType === 'manifestation' ? selectedEntity.id : null
  let currentIndex = currentId ? rows.findIndex(row => row.dataset.manifestationId === currentId) : -1
  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : rows.length
  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= rows.length) nextIndex = rows.length - 1
  if (nextIndex === currentIndex) return
  const target = rows[nextIndex]
  const manifestationId = target.dataset.manifestationId
  if (!manifestationId) return
  const record = combinedRecordsById.get(manifestationId)
  if (!record) return
  const expressionId = target.dataset.expressionId || undefined
  const expressionArk = target.dataset.expressionArk || undefined
  const workArk = target.dataset.workArk || undefined
  const row = buildInventoryRowForManifestation(record, {
    expressionId,
    expressionArk,
    workArk,
  })
  selectInventoryRecord(row)
  target.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function navigateWorkList(direction: 'up' | 'down') {
  const rows = Array.from(
    clustersEl.querySelectorAll<HTMLElement>(
      '.cluster-header-row.entity-row--work, .cluster-item.entity-row--work',
    ),
  ).filter(row => !row.classList.contains('filtered-out'))
  if (!rows.length) return

  const currentId = selectedEntity?.id
  const currentArk =
    selectedEntity?.workArk ?? (typeof highlightedWorkArk === 'string' ? highlightedWorkArk : null) ?? null

  const findRowMatch = (row: HTMLElement): boolean => {
    const rowWorkId = row.dataset.workId || row.closest<HTMLElement>('.cluster')?.dataset.workId || null
    const rowWorkArk = row.dataset.workArk || row.closest<HTMLElement>('.cluster')?.dataset.workArk || null
    if (currentId && rowWorkId === currentId) return true
    if (currentArk && rowWorkArk === currentArk) return true
    return false
  }

  let currentIndex = rows.findIndex(findRowMatch)
  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : rows.length

  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= rows.length) nextIndex = rows.length - 1
  if (nextIndex === currentIndex) return

  activateWorkRow(rows[nextIndex])
}

function activateWorkRow(row: HTMLElement) {
  const clusterEl = row.closest<HTMLElement>('.cluster')
  const isUnclustered = clusterEl?.dataset.unclustered === 'true'
  const workArk = row.dataset.workArk || clusterEl?.dataset.workArk || null
  const workId = row.dataset.workId || clusterEl?.dataset.workId || null

  if (isUnclustered) {
    const workRecord =
      (workId && curatedRecords.find(r => r.id === workId)) ||
      (workId && originalRecords.find(r => r.id === workId)) ||
      (workArk ? lookupWorkRecordByArk(workArk) : null)
    if (!workRecord) return
    listScope = 'clusters'
    activeWorkAnchorId = null
    highlightedWorkArk = workRecord.ark || null
    activeExpressionAnchorId = null
    highlightedExpressionArk = null
    showRecordDetails(workRecord.id, false, {
      entityType: 'work',
      workArk: workRecord.ark,
    })
    row.scrollIntoView({ block: 'center', behavior: 'smooth' })
    return
  }

  const clusterAnchorId = clusterEl?.dataset.clusterAnchorId
  if (!clusterAnchorId) return
  const cluster = clusters.find(c => c.anchorId === clusterAnchorId)
  if (!cluster) return

  listScope = 'clusters'
  activeWorkAnchorId = cluster.anchorId
  activeExpressionAnchorId = null
  highlightedExpressionArk = null

  if (row.classList.contains('cluster-header-row')) {
    highlightedWorkArk = cluster.anchorArk
    showRecordDetails(cluster.anchorId, true, {
      entityType: 'work',
      clusterAnchorId: cluster.anchorId,
      isAnchor: true,
      workArk: cluster.anchorArk,
    })
  } else {
    const item = cluster.items.find(entry => entry.ark === workArk)
    highlightedWorkArk = workArk
    if (item?.id) {
      showRecordDetails(item.id, false, {
        entityType: 'work',
        clusterAnchorId: cluster.anchorId,
        isAnchor: false,
        workArk: workArk ?? undefined,
      })
    } else {
      renderCurrentView()
    }
  }
  row.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function visibleExpressionItems(): HTMLElement[] {
  return Array.from(
    clustersEl.querySelectorAll<HTMLElement>(
      '.expression-group .expression-anchor, .expression-group .expression-item',
    ),
  ).filter(el => !el.classList.contains('filtered-out') && el.offsetParent !== null)
}

function navigateExpressionList(direction: 'up' | 'down') {
  const cluster = clusters.find(c => c.anchorId === activeWorkAnchorId) ?? clusters[0]
  if (!cluster) return
  const items = visibleExpressionItems()
  if (!items.length) return

  const currentExpressionId =
    selectedEntity?.entityType === 'expression'
      ? selectedEntity.expressionId
      : selectedEntity?.entityType === 'manifestation'
        ? selectedEntity.expressionId
        : null
  const currentExpressionArk =
    selectedEntity?.entityType === 'expression'
      ? selectedEntity.expressionArk
      : selectedEntity?.entityType === 'manifestation'
        ? selectedEntity.expressionArk
        : highlightedExpressionArk

  let currentIndex = items.findIndex((item: HTMLElement) => {
    const itemId = item.dataset.expressionId
    const itemArk = item.dataset.expressionArk
    if (currentExpressionId && itemId === currentExpressionId) return true
    if (currentExpressionArk && itemArk === currentExpressionArk) return true
    return false
  })

  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : items.length

  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= items.length) nextIndex = items.length - 1
  if (nextIndex === currentIndex && currentIndex !== -1) return

  const target = items[nextIndex]
  const expressionId = target.dataset.expressionId || undefined
  const expressionArk = target.dataset.expressionArk || undefined
  if (!expressionId && !expressionArk) return
  const groupEl = target.closest('.expression-group') as HTMLElement | null
  const anchorExpressionId = groupEl?.dataset.anchorExpressionId || null
  const expressionData = findExpressionInCluster(cluster, expressionId, expressionArk)
  const isAnchor = target.classList.contains('expression-anchor')

  activeWorkAnchorId = cluster.anchorId
  activeExpressionAnchorId = isAnchor ? expressionId ?? null : anchorExpressionId
  highlightedExpressionArk = expressionArk || null

  const recordId = expressionData?.id || expressionId || expressionArk
  if (!recordId) return
  showRecordDetails(recordId, true, {
    entityType: 'expression',
    clusterAnchorId: cluster.anchorId,
    isAnchor,
    workArk: expressionData?.workArk || (isAnchor ? cluster.anchorArk : undefined),
    expressionId: expressionData?.id || expressionId,
    expressionArk: expressionData?.ark || expressionArk,
  })

  if (target.scrollIntoView) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function visibleManifestationItems(): HTMLElement[] {
  return Array.from(clustersEl.querySelectorAll<HTMLElement>('.manifestation-item')).filter(
    el => !el.classList.contains('filtered-out') && el.offsetParent !== null,
  )
}

function navigateManifestationList(direction: 'up' | 'down') {
  const cluster = clusters.find(c => c.anchorId === activeWorkAnchorId) ?? clusters[0]
  if (!cluster) return
  const items = visibleManifestationItems()
  if (!items.length) return

  const currentManifestationId =
    selectedEntity?.entityType === 'manifestation' ? selectedEntity.id : undefined

  let currentIndex = items.findIndex(item => item.dataset.manifestationId === currentManifestationId)
  if (currentIndex === -1) currentIndex = direction === 'down' ? -1 : items.length

  const delta = direction === 'down' ? 1 : -1
  let nextIndex = currentIndex + delta
  if (nextIndex < 0) nextIndex = 0
  if (nextIndex >= items.length) nextIndex = items.length - 1
  if (nextIndex === currentIndex && currentIndex !== -1) return

  const target = items[nextIndex]
  const manifestationId = target.dataset.manifestationId
  if (!manifestationId) return
  const expressionId = target.dataset.expressionId
  const expressionArk = target.dataset.expressionArk
  const groupEl = target.closest('.manifestation-group') as HTMLElement | null
  const anchorExpressionId = groupEl?.dataset.anchorExpressionId || null
  const expressionData = findExpressionInCluster(cluster, expressionId, expressionArk)
  const isAnchor = anchorExpressionId === expressionId

  activeWorkAnchorId = cluster.anchorId
  activeExpressionAnchorId = anchorExpressionId
  highlightedExpressionArk = expressionArk || null

  showRecordDetails(manifestationId, true, {
    entityType: 'manifestation',
    clusterAnchorId: cluster.anchorId,
    isAnchor,
    workArk: expressionData?.workArk,
    expressionId: expressionData?.id || expressionId,
    expressionArk: expressionData?.ark || expressionArk,
  })

  if (target.scrollIntoView) {
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }
}

function focusSelectElement(select: HTMLSelectElement | null) {
  if (!select || select.disabled) return
  select.focus()
  try {
    if (typeof (select as any).showPicker === 'function') {
      ;(select as any).showPicker()
    }
  } catch {}
}

function openExpressionFilterSelect() {
  const select = document.querySelector<HTMLSelectElement>('select.expression-filter-select')
  focusSelectElement(select)
}

function openWorkFilterSelect() {
  const select = document.querySelector<HTMLSelectElement>(
    '.cluster-banner.work-banner select.work-selector',
  )
  focusSelectElement(select)
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (shortcutsModalOpen) return
  if (event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (target) {
    const tagName = target.tagName
    if (tagName === 'INPUT' || tagName === 'SELECT' || tagName === 'TEXTAREA') return
    if (target.isContentEditable) return
  }
  const action = (Object.keys(shortcutBindings) as ShortcutAction[]).find(act =>
    shortcutMatchesEvent(shortcutBindings[act], event),
  )
  if (!action) return
  event.preventDefault()
  if (action === 'focusUp') {
    focusTreeUp()
  } else if (action === 'focusDown') {
    focusTreeDown()
  } else if (action === 'listUp') {
    navigateList('up')
  } else if (action === 'listDown') {
    navigateList('down')
  } else if (action === 'openExpressionFilter') {
    openExpressionFilterSelect()
  } else if (action === 'openWorkFilter') {
    openWorkFilterSelect()
  }
}

function createManifestationList(
  expression: ExpressionItem,
  cluster: Cluster,
  anchorExpressionId: string | null,
  parentAccepted: boolean,
  anchorAgents: Set<string>,
): HTMLDivElement {
  const list = document.createElement('div')
  list.className = 'manifestation-list'
  if (!parentAccepted) list.classList.add('inactive')
  setupManifestationDrop(list, cluster, anchorExpressionId, expression.ark, expression.id)

  if (!expression.manifestations.length) {
    const empty = document.createElement('div')
    empty.className = 'manifestation-empty'
    empty.textContent = t('labels.noManifestations')
    list.appendChild(empty)
    return list
  }

  const sorted = [...expression.manifestations].sort((a, b) => {
    const infoA = getAgentInfoForRecord(a.id)
    const infoB = getAgentInfoForRecord(b.id)
    const simA = agentSimilarity(anchorAgents, infoA.normalized)
    const simB = agentSimilarity(anchorAgents, infoB.normalized)
    if (simB !== simA) return simB - simA
    const labelA = a.title || a.id
    const labelB = b.title || b.id
    return labelA.localeCompare(labelB)
  })

  for (const man of sorted) {
    const row = createManifestationRow(man, expression, cluster, anchorExpressionId)
    if (!parentAccepted) row.classList.add('inactive')
    list.appendChild(row)
  }
  return list
}

function createManifestationRow(
  manifestation: ManifestationItem,
  owner: ExpressionItem,
  cluster: Cluster,
  anchorExpressionId: string | null,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = 'manifestation-item entity-row entity-row--manifestation'
  row.dataset.manifestationId = manifestation.id
  row.dataset.expressionArk = manifestation.expressionArk
  row.dataset.expressionId = owner.id
  const selection = selectedEntity
  const isSelectedManifestation = selection?.entityType === 'manifestation' && selection.id === manifestation.id
  const isExpressionSelection = selection?.entityType === 'expression' && selection.expressionId === owner.id
  const isWorkContext = selection?.entityType === 'work' && selection.workArk === owner.workArk
  const isFilterExpression = !selection && highlightedExpressionArk !== null && manifestation.expressionArk === highlightedExpressionArk
  if (isSelectedManifestation) row.classList.add('selected')
  if (!isSelectedManifestation && (isExpressionSelection || isWorkContext || isFilterExpression)) {
    row.classList.add('highlight')
  }
  if (manifestation.expressionArk !== manifestation.originalExpressionArk) {
    row.classList.add('changed')
  }

  row.draggable = true
  row.ondragstart = e => {
    const payload: ManifestationDragPayload = {
      clusterAnchorId: cluster.anchorId,
      sourceAnchorExpressionId: anchorExpressionId,
      sourceExpressionArk: manifestation.expressionArk,
      manifestationId: manifestation.id,
    }
    e.dataTransfer?.setData(MANIFESTATION_DRAG_MIME, JSON.stringify(payload))
    e.dataTransfer?.setDragImage(row, 12, 12)
    row.classList.add('dragging')
  }
  row.ondragend = () => row.classList.remove('dragging')

  const openManifestation = () => {
    highlightedExpressionArk = manifestation.expressionArk
    activeExpressionAnchorId = anchorExpressionId
    activeWorkAnchorId = cluster.anchorId
    showRecordDetails(manifestation.id, true, {
      entityType: 'manifestation',
      clusterAnchorId: cluster.anchorId,
      isAnchor: anchorExpressionId === owner.id,
      workArk: owner.workArk,
      expressionId: owner.id,
      expressionArk: owner.ark,
    })
  }
  bindSingleAndDouble(
    row,
    openManifestation,
    event => {
      event.stopPropagation()
      openManifestation()
    },
  )

  const badges: EntityBadgeSpec[] = [{ type: 'manifestation', text: manifestation.id, tooltip: manifestation.ark }]
  if (owner.id) badges.push({ type: 'expression', text: owner.id, tooltip: owner.ark })
  populateEntityLabel(row, {
    title: manifestation.title || manifestation.id,
    badges,
  })
  prependAgentBadge(row, manifestation.id)
  const workFilterArk = highlightedWorkArk || null
  const matchesWorkFilter = !workFilterArk || owner.workArk === workFilterArk
  const matchesExpressionFilter = !expressionFilterArk || owner.ark === expressionFilterArk
  if (!matchesWorkFilter || !matchesExpressionFilter) {
    row.classList.add('filtered-out')
  } else if (expressionFilterArk || workFilterArk) {
    row.classList.add('filter-match')
  }
  return row
}

function setupManifestationDrop(
  element: HTMLElement,
  cluster: Cluster,
  anchorExpressionId: string | null,
  expressionArk: string,
  expressionId?: string,
) {
  element.ondragover = e => {
    e.preventDefault()
    element.classList.add('drop-target')
  }
  element.ondragleave = () => element.classList.remove('drop-target')
  element.ondrop = e => {
    e.preventDefault()
    element.classList.remove('drop-target')
    const raw = e.dataTransfer?.getData(MANIFESTATION_DRAG_MIME)
    if (!raw) return
    try {
      const payload = JSON.parse(raw) as ManifestationDragPayload
      handleManifestationDrop(cluster, payload, anchorExpressionId, expressionArk, expressionId)
    } catch {}
  }
}

function handleManifestationDrop(
  cluster: Cluster,
  payload: ManifestationDragPayload,
  anchorExpressionId: string | null,
  targetExpressionArk: string,
  targetExpressionId?: string,
) {
  if (payload.clusterAnchorId !== cluster.anchorId) return
  if (payload.sourceExpressionArk === targetExpressionArk) return

  const item = detachManifestationItem(cluster, payload)
  if (!item) return

  attachManifestationItem(cluster, anchorExpressionId, targetExpressionArk, targetExpressionId, item)
  updateManifestationParent(item, payload.sourceExpressionArk, targetExpressionArk, targetExpressionId)
  highlightedExpressionArk = targetExpressionArk
  if (anchorExpressionId) activeExpressionAnchorId = anchorExpressionId
  notify(t('notifications.manifestationMoved'))
  renderCurrentView()
  renderDetailsPanel()
}

function detachManifestationItem(cluster: Cluster, payload: ManifestationDragPayload): ManifestationItem | null {
  if (payload.sourceAnchorExpressionId) {
    const group = cluster.expressionGroups.find(g => g.anchor.id === payload.sourceAnchorExpressionId)
    if (!group) return null
    const idxAnchor = group.anchor.manifestations.findIndex(m => m.id === payload.manifestationId)
    if (idxAnchor !== -1) {
      return group.anchor.manifestations.splice(idxAnchor, 1)[0]
    }
    for (const expr of group.clustered) {
      const idx = expr.manifestations.findIndex(m => m.id === payload.manifestationId)
      if (idx !== -1) {
        return expr.manifestations.splice(idx, 1)[0]
      }
    }
  } else {
    for (const expr of cluster.independentExpressions) {
      const idx = expr.manifestations.findIndex(m => m.id === payload.manifestationId)
      if (idx !== -1) {
        return expr.manifestations.splice(idx, 1)[0]
      }
    }
  }
  return null
}

function attachManifestationItem(
  cluster: Cluster,
  anchorExpressionId: string | null,
  expressionArk: string,
  expressionId: string | undefined,
  item: ManifestationItem,
) {
  if (anchorExpressionId) {
    const group = cluster.expressionGroups.find(g => g.anchor.id === anchorExpressionId)
    if (!group) return
    if (expressionArk === group.anchor.ark) {
      group.anchor.manifestations.push(item)
    } else {
      const target = group.clustered.find(expr => expr.ark === expressionArk)
      if (target) {
        target.manifestations.push(item)
      } else {
        group.anchor.manifestations.push(item)
      }
    }
  } else {
    let target = cluster.independentExpressions.find(expr => expr.ark === expressionArk)
    if (!target) {
      const rec = curatedRecords.find(r => r.ark === expressionArk)
      if (!rec) return
      target = {
        id: rec.id,
        ark: expressionArk,
        title: titleOf(rec) || rec.id,
        workArk: expressionWorkArks(rec)[0] || '',
        workId: rec.id,
        manifestations: [],
      }
      cluster.independentExpressions.push(target)
    }
    target.manifestations.push(item)
  }
  item.expressionId = expressionId
}

function renderManifestationClusters() {
  if (!clusters.length) return
  let cluster = clusters.find(c => c.anchorId === activeWorkAnchorId)
  if (!cluster) {
    cluster = clusters[0]
    activeWorkAnchorId = cluster.anchorId
  }
  if (!cluster) return

  const validWorkArks = new Set<string>([cluster.anchorArk, ...cluster.items.map(i => i.ark)])
  if (highlightedWorkArk === undefined) {
    highlightedWorkArk = null
  } else if (highlightedWorkArk !== null && !validWorkArks.has(highlightedWorkArk)) {
    highlightedWorkArk = null
  }

  clustersEl.appendChild(buildWorkBanner(cluster))
  clustersEl.appendChild(buildManifestationExpressionFilterBanner(cluster))

  const groupsWrap = document.createElement('div')
  groupsWrap.className = 'manifestation-groups'

  const detachedExpressions: { expression: ExpressionClusterItem; anchorId: string; anchorTitle: string }[] = []

  for (const group of cluster.expressionGroups) {
    const groupEl = document.createElement('div')
    groupEl.className = 'manifestation-group'
    if (group.anchor.id === activeExpressionAnchorId) groupEl.classList.add('active')
    groupEl.dataset.anchorExpressionId = group.anchor.id
    groupEl.dataset.expressionArk = group.anchor.ark
    let groupHasVisibleSections = false
    const anchorAgents = getAgentInfoForRecord(group.anchor.id).normalized

    const anchorSection = createManifestationSection(
      group.anchor,
      cluster,
      group.anchor.id,
      {
        origin: 'anchor',
        parentAccepted: true,
      },
      anchorAgents,
    )
    groupEl.appendChild(anchorSection)
    if (!anchorSection.classList.contains('filtered-out')) groupHasVisibleSections = true

    const sortedClustered = [...group.clustered].sort((a, b) => {
      const simA = agentSimilarity(anchorAgents, getAgentInfoForRecord(a.id).normalized)
      const simB = agentSimilarity(anchorAgents, getAgentInfoForRecord(b.id).normalized)
      if (simB !== simA) return simB - simA
      const labelA = a.title || a.id
      const labelB = b.title || b.id
      return labelA.localeCompare(labelB)
    })

    for (const expr of sortedClustered) {
      const workAccepted = isClusterWorkAccepted(cluster, expr.workArk)
      if (!expr.accepted && workAccepted) {
        detachedExpressions.push({ expression: expr, anchorId: group.anchor.id, anchorTitle: group.anchor.title || group.anchor.id })
        continue
      }
      const parentAccepted = expr.accepted && workAccepted
      const statusLabel = parentAccepted
        ? undefined
        : workAccepted
          ? t('labels.expressionUnchecked')
          : t('labels.workUnchecked')
      const sectionEl = createManifestationSection(
        expr,
        cluster,
        group.anchor.id,
        {
          parentAccepted,
          statusLabel,
          origin: 'clustered',
        },
        anchorAgents,
      )
      groupEl.appendChild(sectionEl)
      if (!sectionEl.classList.contains('filtered-out')) groupHasVisibleSections = true
    }

    if (!groupHasVisibleSections) {
      groupEl.classList.add('filtered-out')
    }
    groupsWrap.appendChild(groupEl)
  }

  const independentEntries: Array<{
    expression: ExpressionItem
    anchorExpressionId: string | null
    parentAccepted: boolean
    statusLabel?: string
    origin: 'independent' | 'detached'
    anchorTitle?: string
  }> = []

  for (const expr of cluster.independentExpressions) {
    independentEntries.push({
      expression: expr,
      anchorExpressionId: null,
      parentAccepted: true,
      origin: 'independent',
    })
  }

  for (const entry of detachedExpressions) {
    independentEntries.push({
      expression: entry.expression,
      anchorExpressionId: entry.anchorId,
      parentAccepted: false,
      statusLabel: t('labels.expressionUnchecked'),
      origin: 'detached',
      anchorTitle: entry.anchorTitle,
    })
  }

  if (independentEntries.length) {
    const independentGroup = document.createElement('div')
    independentGroup.className = 'manifestation-group independent'

    let independentHasVisible = false
    for (const entry of independentEntries) {
      const baselineAgents = entry.anchorExpressionId
        ? getAgentInfoForRecord(entry.anchorExpressionId).normalized
        : getAgentInfoForRecord(entry.expression.id).normalized
      const sectionEl = createManifestationSection(
        entry.expression,
        cluster,
        entry.anchorExpressionId,
        {
          parentAccepted: entry.parentAccepted,
          statusLabel: entry.statusLabel,
          origin: entry.origin,
        },
        baselineAgents,
      )
      independentGroup.appendChild(sectionEl)
      if (!sectionEl.classList.contains('filtered-out')) independentHasVisible = true
    }

    if (!independentHasVisible) independentGroup.classList.add('filtered-out')
    groupsWrap.appendChild(independentGroup)
  }

  clustersEl.appendChild(groupsWrap)
}

function showRecordDetails(id: string, anchor: boolean, context: Partial<SelectedEntity> = {}) {
  selectedEntity = { id, source: anchor ? 'curated' : 'original', ...context }
  if (context.entityType && listScope === 'clusters') {
    const targetMode =
      context.entityType === 'work'
        ? 'works'
        : context.entityType === 'expression'
          ? 'expressions'
          : 'manifestations'
    if (viewMode !== targetMode) viewMode = targetMode
  }
  pendingScrollEntity = selectedEntity
  renderDetailsPanel()
  renderCurrentView()
}

function renderDetailsPanel() {
  cleanupEditor()
  detailsEl.innerHTML = ''

  if (!selectedEntity) {
    detailsEl.innerHTML = `<em>${t('layout.selectPrompt')}</em>`
    return
  }

  const context = selectedEntity
  const records = context.source === 'curated' ? curatedRecords : originalRecords
  const rec = records.find(r => r.id === context.id)
  if (!rec) {
    detailsEl.innerHTML = `<em>${t('messages.recordNotFound')}</em>`
    return
  }

  const wrapper = document.createElement('div')
  wrapper.className = 'details-wrapper'

  const pre = document.createElement('pre')
  pre.className = 'intermarc-view'
  pre.textContent = t('messages.loadingIntermarc')
  pre.dataset.recordId = rec.id
  wrapper.appendChild(pre)

  detailsEl.appendChild(wrapper)

  const originalRecord = originalRecords.find(r => r.id === rec.id)
  const originalDiffKeys = computeDiffKeys(rec.intermarc, originalRecord?.intermarc)
  const sessionDiffKeys: Set<DiffKey> =
    context.source === 'curated' ? computeDiffKeys(rec.intermarc, baselineIntermarc.get(rec.id)) : new Set<DiffKey>()

  prettyPrintIntermarc(rec.intermarc)
    .then(result => {
      if (pre.dataset.recordId === rec.id) {
        renderIntermarcWithDiff(pre, result, originalDiffKeys, sessionDiffKeys)
      }
    })
    .catch(err => {
      console.error('Failed to render intermarc', err)
      if (pre.dataset.recordId === rec.id) pre.textContent = t('messages.failedIntermarc')
    })

  if (context.source === 'curated' && context.entityType === 'work' && context.isAnchor) {
    const actions = document.createElement('div')
    actions.className = 'editor-actions'
    const editBtn = document.createElement('button')
    editBtn.textContent = t('buttons.modifyRecord')
    editBtn.onclick = () => openEditorForRecord(rec)
    actions.appendChild(editBtn)
    wrapper.appendChild(actions)
  }

}

async function handleFilesChanged() {
  if (origInput.files?.length) {
    const text = await readFile(origInput)
    originalCsv = parseCsv(text)
    originalRecords = indexRecords(originalCsv)
    rebuildOriginalIndexes()
  }
  if (curInput.files?.length) {
    const text = await readFile(curInput)
    curatedCsv = parseCsv(text)
    curatedRecords = indexRecords(curatedCsv)
    refreshCuratedColumnIndexes()
    captureBaseline()
  }
  refreshCombinedRecordIndexes()
  if (originalCsv && curatedCsv) {
    closeUploadModal()
    const arkIdx = buildArkIndex(originalRecords)
    clusters = detectClusters(curatedRecords, arkIdx)
    rebuildClusterCoverage()
    rebuildInventoryRows()
    agentInfoCache.clear()
    viewMode = 'works'
    listScope = 'clusters'
    inventoryFocusWork = null
    inventoryFocusExpression = null
    activeWorkAnchorId = null
    highlightedWorkArk = undefined
    activeExpressionAnchorId = null
    highlightedExpressionArk = null
    expressionFilterArk = null
    selectedEntity = null
    pendingScrollEntity = null
    detailsEl.innerHTML = `<em>${t('layout.selectPrompt')}</em>`
    renderCurrentView()
    notify(t('notifications.csvLoaded'))
  } else {
    clusters = []
    rebuildClusterCoverage()
    rebuildInventoryRows()
    inventoryFocusWork = null
    inventoryFocusExpression = null
    renderCurrentView()
  }
  maybeCloseUploadModal()
}

async function loadDefaultData() {
  try {
    const curResp = await fetch(`/data/${DEFAULT_CURATED_NAME}`)
    if (curResp.ok) {
      const text = await curResp.text()
      curatedCsv = parseCsv(text)
      curatedRecords = indexRecords(curatedCsv)
      refreshCuratedColumnIndexes()
      captureBaseline()
    }
  } catch {}
  try {
    for (const name of DEFAULT_ORIGINAL_CANDIDATES) {
      try {
        const resp = await fetch(`/data/${name}`)
        if (resp.ok) {
          const text = await resp.text()
          originalCsv = parseCsv(text)
          originalRecords = indexRecords(originalCsv)
          rebuildOriginalIndexes()
          break
        }
      } catch {}
    }
  } catch {}
  refreshCombinedRecordIndexes()
  if (originalCsv && curatedCsv) {
    const arkIdx = buildArkIndex(originalRecords)
    clusters = detectClusters(curatedRecords, arkIdx)
    rebuildClusterCoverage()
    rebuildInventoryRows()
    agentInfoCache.clear()
    viewMode = 'works'
    listScope = 'clusters'
    inventoryFocusWork = null
    inventoryFocusExpression = null
    activeWorkAnchorId = null
    highlightedWorkArk = undefined
    activeExpressionAnchorId = null
    highlightedExpressionArk = null
    expressionFilterArk = null
    renderCurrentView()
    detailsEl.innerHTML = `<em>${t('layout.defaultDataLoaded')}</em>`
  } else {
    clusters = []
    rebuildClusterCoverage()
    rebuildInventoryRows()
    inventoryFocusWork = null
    inventoryFocusExpression = null
    renderCurrentView()
    detailsEl.innerHTML = `<em>${t('layout.provideFiles')}</em>`
    openUploadModal()
  }
}

function processDroppedFiles(files: FileList | File[]) {
  const list = Array.from(files)
  const curatedFile = list.find(f => f.name.toLowerCase() === DEFAULT_CURATED_NAME)
  const originalFile = list.find(
    f => f.name.toLowerCase() !== DEFAULT_CURATED_NAME && f.name.toLowerCase().endsWith('.csv'),
  )
  const read = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsText(f, 'utf-8')
    })
  Promise.resolve()
    .then(async () => {
      if (originalFile) {
        const text = await read(originalFile)
        originalCsv = parseCsv(text)
        originalRecords = indexRecords(originalCsv)
        rebuildOriginalIndexes()
      }
      if (curatedFile) {
        const text = await read(curatedFile)
        curatedCsv = parseCsv(text)
        curatedRecords = indexRecords(curatedCsv)
        refreshCuratedColumnIndexes()
        captureBaseline()
      }
    })
    .then(() => {
      refreshCombinedRecordIndexes()
      if (originalCsv && curatedCsv) {
        const arkIdx = buildArkIndex(originalRecords)
        clusters = detectClusters(curatedRecords, arkIdx)
        rebuildClusterCoverage()
        rebuildInventoryRows()
        agentInfoCache.clear()
        viewMode = 'works'
        listScope = 'clusters'
        inventoryFocusWork = null
        inventoryFocusExpression = null
        activeWorkAnchorId = null
        highlightedWorkArk = undefined
        activeExpressionAnchorId = null
        highlightedExpressionArk = null
        expressionFilterArk = null
        selectedEntity = null
        pendingScrollEntity = null
        renderCurrentView()
        detailsEl.innerHTML = `<em>${t('messages.filesLoadedFromDrop')}</em>`
        notify(t('notifications.csvLoaded'))
      } else {
        clusters = []
        rebuildClusterCoverage()
        rebuildInventoryRows()
        inventoryFocusWork = null
        inventoryFocusExpression = null
        renderCurrentView()
        notify(t('notifications.needCuratedAndOriginal'))
      }
    })
    .finally(() => {
      dropHint.classList.remove('visible')
      maybeCloseUploadModal()
    })
}

function cleanupEditor() {
  if (editorView) {
    editorView.destroy()
    editorView = null
  }
}

function openEditorForRecord(rec: RecordRow) {
  cleanupEditor()
  detailsEl.innerHTML = ''
  const editorWrap = document.createElement('div')
  editorWrap.className = 'editor'
  const startDoc = JSON.stringify(rec.intermarc, null, 2)
  const state = EditorState.create({
    doc: startDoc,
    extensions: [keymap.of(defaultKeymap), json(), EditorView.lineWrapping],
  })
  editorView = new EditorView({ state, parent: editorWrap })
  const actions = document.createElement('div')
  actions.className = 'editor-actions'
  const saveBtn = document.createElement('button')
  saveBtn.textContent = t('buttons.save')
  saveBtn.onclick = () => {
    try {
      const parsed = JSON.parse(editorView!.state.doc.toString())
      if (!parsed || !Array.isArray(parsed.zones)) throw new Error('Invalid Intermarc: missing zones[]')
      rec.intermarc = parsed
      rec.intermarcStr = JSON.stringify(parsed)
      if (curatedCsv) {
        const headers = curatedCsv.headers
        const idIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'id_entitelrm')
        const intIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'intermarc')
        const row = curatedCsv.rows.find(r => r[idIdx] === rec.id)
        if (row) row[intIdx] = rec.intermarcStr
      }
      renderDetailsPanel()
      const arkIdx = buildArkIndex(originalRecords)
      clusters = detectClusters(curatedRecords, arkIdx)
      rebuildClusterCoverage()
      rebuildInventoryRows()
      renderCurrentView()
    } catch (e: unknown) {
      const errorText = typeof e === 'string' ? e : (e as { message?: string })?.message || String(e)
      alert(t('messages.saveFailed', { error: errorText }))
    }
  }
  actions.appendChild(saveBtn)
  detailsEl.appendChild(editorWrap)
  detailsEl.appendChild(actions)
}

function zoneText(zone: { sousZones: Array<{ valeur?: unknown }> }): string {
  const parts = zone.sousZones
    .map(sz => (sz.valeur ? String(sz.valeur).trim() : ''))
    .filter(part => part.length > 0)
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

function titleOf(rec: RecordRow): string | undefined {
  const zone = findZones(rec.intermarc, '150')[0]
  const text = zone ? zoneText(zone) : undefined
  return text && text.length ? text : undefined
}

const AGENT_ZONE_CODES = new Set(['700', '701', '702', '710', '711', '712'])
const AGENT_NAME_SUBCODES = new Set(['a', 'b', 'c', 'd', 'f', 'g', 'h', 'm', 'n', 'p', 'q'])
const AGENT_REFERENCE_SUBCODES = new Set(['0', '3'])

type AgentInfo = { names: string[]; normalized: Set<string> }

const agentInfoCache = new Map<string, AgentInfo>()

function normalizeAgentName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function labelForAgentRecord(rec: RecordRow): string {
  if (rec.typeNorm === 'identite publique de personne') {
    const zone = findZones(rec.intermarc, '100')[0]
    if (zone) {
      const parts = zone.sousZones
        .map(sz => {
          const sub = sz.code.split('$')[1]
          if (!sub) return null
          if (['a', 'b', 'c', 'd', 'm', 'n', 'p', 'q'].includes(sub)) return sz.valeur?.trim()
          return null
        })
        .filter((part): part is string => !!part)
      if (parts.length) return parts.join(' ')
    }
  }
  if (rec.typeNorm === 'collectivite') {
    const zone = findZones(rec.intermarc, '110')[0]
    const val = zone?.sousZones.find(sz => sz.code === '110$a')?.valeur
    if (val) return val
  }
  return titleOf(rec) || rec.id
}

function extractAgentsFromRecord(rec: RecordRow): string[] {
  const names = new Set<string>()
  for (const zone of rec.intermarc.zones) {
    if (!AGENT_ZONE_CODES.has(zone.code)) continue
    const nameParts = zone.sousZones
      .map(sub => {
        const subCode = sub.code.split('$')[1]?.toLowerCase()
        if (!subCode) return null
        if (AGENT_NAME_SUBCODES.has(subCode)) {
          const value = sub.valeur?.trim()
          if (value) return value
        }
        return null
      })
      .filter((part): part is string => !!part)
    let label = nameParts.join(' ')
    if (!label) {
      const reference = zone.sousZones.find(sub => {
        const subCode = sub.code.split('$')[1]?.toLowerCase()
        return subCode ? AGENT_REFERENCE_SUBCODES.has(subCode) : false
      })?.valeur
      if (reference) {
        const normArk = normalizeArkForLookup(reference)
        if (normArk) {
          const record = combinedRecordsByArk.get(normArk)
          if (record) {
            label = labelForAgentRecord(record)
          }
        }
      }
    }
    if (label) names.add(label)
  }
  return [...names]
}

function getAgentInfoForRecord(recordId?: string | null): AgentInfo {
  if (!recordId) return { names: [], normalized: new Set<string>() }
  if (agentInfoCache.has(recordId)) return agentInfoCache.get(recordId)!
  const record =
    curatedRecords.find(r => r.id === recordId) ||
    originalRecords.find(r => r.id === recordId) ||
    combinedRecordsById.get(recordId)
  if (!record) {
    const empty = { names: [], normalized: new Set<string>() }
    agentInfoCache.set(recordId, empty)
    return empty
  }
  const names = extractAgentsFromRecord(record)
  const normalized = new Set(names.map(normalizeAgentName))
  const info = { names, normalized }
  agentInfoCache.set(recordId, info)
  return info
}

function agentSimilarity(target: Set<string>, candidate: Set<string>): number {
  if (!target.size && !candidate.size) return 0
  let intersection = 0
  candidate.forEach(value => {
    if (target.has(value)) intersection += 1
  })
  const union = target.size + candidate.size - intersection
  if (union === 0) return 0
  return intersection / union
}

function expressionWorkArks(rec: RecordRow): string[] {
  const from140 = findZones(rec.intermarc, '140')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '140$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
  if (from140.length) return from140
  return findZones(rec.intermarc, '750')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '750$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
}

function expressionClusterTargets(rec: RecordRow): { ark: string; date: string | undefined }[] {
  return findZones(rec.intermarc, '90F')
    .filter(z => z.sousZones.some(sz => sz.code === '90F$q' && sz.valeur === CLUSTER_NOTE))
    .map(z => {
      const ark = z.sousZones.find(sz => sz.code === '90F$a')?.valeur
      const date = z.sousZones.find(sz => sz.code === '90F$d')?.valeur
      return ark ? { ark, date } : null
    })
    .filter((v): v is { ark: string; date: string | undefined } => !!v)
}

function manifestationExpressionArks(rec: RecordRow): string[] {
  return findZones(rec.intermarc, '740')
    .flatMap(z => z.sousZones)
    .filter(sz => sz.code === '740$3')
    .map(sz => sz.valeur)
    .filter((v): v is string => !!v)
}

function manifestationTitle(rec: RecordRow): string | undefined {
  const zone = findZones(rec.intermarc, '245')[0]
  const text = zone ? zoneText(zone) : undefined
  return text && text.length ? text : undefined
}

function normalizeArkForLookup(ark?: string | null): string | undefined {
  if (!ark) return undefined
  return ark.toLowerCase()
}

function manifestationsForExpression(
  expressionArk: string,
  manifestMap: Map<string, RecordRow[]>,
  expressionsByArk: Map<string, RecordRow>,
): ManifestationItem[] {
  const recs = manifestMap.get(expressionArk) || []
  const expressionId = expressionsByArk.get(expressionArk)?.id
  return recs.map(rec => ({
    id: rec.id,
    ark: rec.ark || rec.id,
    title: manifestationTitle(rec) || rec.id,
    expressionArk,
    expressionId,
    originalExpressionArk: expressionArk,
  }))
}

function collectManifestationsForExpression(expressionArk: string): ManifestationItem[] {
  const expressionRecord = curatedRecords.find(r => r.ark === expressionArk)
  const expressionId = expressionRecord?.id
  const items: ManifestationItem[] = []
  for (const rec of curatedRecords) {
    if (rec.typeNorm !== 'manifestation') continue
    if (!manifestationExpressionArks(rec).includes(expressionArk)) continue
    items.push({
      id: rec.id,
      ark: rec.ark || rec.id,
      title: manifestationTitle(rec) || rec.id,
      expressionArk,
      expressionId,
      originalExpressionArk: expressionArk,
    })
  }
  return items
}

function findExpressionInCluster(
  cluster: Cluster,
  expressionId?: string | null,
  expressionArk?: string | null,
): ExpressionItem | ExpressionClusterItem | undefined {
  if (!expressionId && !expressionArk) return undefined
  for (const group of cluster.expressionGroups) {
    if (expressionId && group.anchor.id === expressionId) return group.anchor
    if (expressionArk && group.anchor.ark === expressionArk) return group.anchor
    for (const expr of group.clustered) {
      if (expressionId && expr.id === expressionId) return expr
      if (expressionArk && expr.ark === expressionArk) return expr
    }
  }
  for (const expr of cluster.independentExpressions) {
    if (expressionId && expr.id === expressionId) return expr
    if (expressionArk && expr.ark === expressionArk) return expr
  }
  return undefined
}

function findPrimaryExpressionForWork(
  cluster: Cluster,
  workArk: string | undefined,
): ExpressionItem | ExpressionClusterItem | undefined {
  if (!workArk) return undefined
  const groups = cluster.expressionGroups
  if (workArk === cluster.anchorArk) {
    if (groups.length) return groups[0].anchor
  }
  for (const group of groups) {
    if (group.anchor.workArk === workArk) return group.anchor
    const clusteredMatch = group.clustered.find(expr => expr.workArk === workArk)
    if (clusteredMatch) return clusteredMatch
  }
  return cluster.independentExpressions.find(expr => expr.workArk === workArk)
}

type DiffKey = `${string}#${number}|${string}`

function collectSubfieldMap(intermarc: Intermarc): Map<DiffKey, string[]> {
  const map = new Map<DiffKey, string[]>()
  intermarc.zones.forEach((zone, index) => {
    const zoneKey = `${zone.code}#${index}` as const
    for (const sub of zone.sousZones) {
      const key = `${zoneKey}|${sub.code}` as DiffKey
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(sub.valeur)
    }
  })
  return map
}

function collectScriptSubfieldMap(intermarc: Intermarc | undefined): Map<DiffKey, string[]> {
  const map = new Map<DiffKey, string[]>()
  if (!intermarc) return map
  intermarc.zones.forEach((zone, index) => {
    if (zone.code !== '90F') return
    const hasScript = zone.sousZones.some(
      sz => sz.code === '90F$q' && (sz.valeur || '').trim().toLowerCase() === 'clusterisation script',
    )
    if (!hasScript) return
    const zoneKey = `${zone.code}#${index}` as const
    for (const sub of zone.sousZones) {
      const key = `${zoneKey}|${sub.code}` as DiffKey
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(sub.valeur || '')
    }
  })
  return map
}

function parseZoneKey(key: DiffKey): string {
  return key.split('|', 1)[0]
}

function computeDiffKeys(current: Intermarc, reference: Intermarc | undefined): Set<DiffKey> {
  const changed = new Set<DiffKey>()
  if (!reference) return changed
  const currentMap = collectSubfieldMap(current)
  const referenceMap = collectSubfieldMap(reference)
  const scriptCurrent = collectScriptSubfieldMap(current)
  const scriptReference = collectScriptSubfieldMap(reference)
  const keys = new Set<DiffKey>([...currentMap.keys(), ...referenceMap.keys()] as DiffKey[])
  for (const key of keys) {
    const currentVals = [...(currentMap.get(key) || [])].sort()
    const referenceVals = [...(referenceMap.get(key) || [])].sort()
    const shouldHighlight = () => {
      if (!key.startsWith('90F#')) return true
      const scriptCurr = [...(scriptCurrent.get(key) || [])].sort()
      const scriptRef = [...(scriptReference.get(key) || [])].sort()
      if (scriptCurr.length !== scriptRef.length) return true
      for (let i = 0; i < scriptCurr.length; i++) {
        if (scriptCurr[i] !== scriptRef[i]) return true
      }
      return false
    }
    if (currentVals.length !== referenceVals.length) {
      if (shouldHighlight()) changed.add(key)
      continue
    }
    for (let i = 0; i < currentVals.length; i++) {
      if (currentVals[i] !== referenceVals[i]) {
        if (shouldHighlight()) changed.add(key)
        break
      }
    }
  }
  return changed
}

function appendIntermarcValue(target: HTMLElement, value: string, tokenMap: Map<number, string>) {
  if (!value) return
  let cursor = 0
  while (cursor < value.length) {
    const start = value.indexOf(ARK_TOKEN_START, cursor)
    if (start === -1) {
      target.appendChild(document.createTextNode(value.slice(cursor)))
      break
    }
    if (start > cursor) {
      target.appendChild(document.createTextNode(value.slice(cursor, start)))
    }
    const end = value.indexOf(ARK_TOKEN_END, start + ARK_TOKEN_START.length)
    if (end === -1) {
      target.appendChild(document.createTextNode(value.slice(start)))
      break
    }
    const tokenContent = value.slice(start + ARK_TOKEN_START.length, end)
    const separatorIdx = tokenContent.indexOf('|')
    if (separatorIdx === -1) {
      target.appendChild(document.createTextNode(tokenContent))
    } else {
      const indexStr = tokenContent.slice(0, separatorIdx)
      const label = tokenContent.slice(separatorIdx + 1)
      const index = Number.parseInt(indexStr, 10)
      const ark = tokenMap.get(index)
      if (ark && label) {
        const link = document.createElement('span')
        link.className = 'ark-link'
        link.textContent = label
        link.dataset.ark = ark
        link.tabIndex = 0
        setTooltip(link, ark)
        target.appendChild(link)
      } else {
        target.appendChild(document.createTextNode(label))
      }
    }
    cursor = end + ARK_TOKEN_END.length
  }
}

function renderIntermarcWithDiff(
  pre: HTMLElement,
  result: PrettyIntermarcResult,
  originalDiffKeys: Set<DiffKey>,
  sessionDiffKeys: Set<DiffKey>,
) {
  pre.innerHTML = ''
  const tokenMap = new Map<number, string>()
  for (const token of result.tokens) {
    tokenMap.set(token.index, token.ark)
  }
  const originalZoneKeys = new Set([...originalDiffKeys].map(parseZoneKey))
  const sessionZoneKeys = new Set([...sessionDiffKeys].map(parseZoneKey))
  const zoneCounters = new Map<string, number>()
  const lines = result.text.split('\n')
  lines.forEach((line, idx) => {
    const lineSpan = document.createElement('span')
    lineSpan.className = 'intermarc-line'
    const trimmed = line.trim()
    if (!trimmed) {
      pre.appendChild(lineSpan)
      if (idx < lines.length - 1) pre.appendChild(document.createTextNode('\n'))
      return
    }

    const match = trimmed.match(/^(\S+)(.*)$/)
    if (!match) {
      appendIntermarcValue(lineSpan, trimmed, tokenMap)
      pre.appendChild(lineSpan)
      if (idx < lines.length - 1) pre.appendChild(document.createTextNode('\n'))
      return
    }

    const zoneCode = match[1]
    const remainder = match[2].trim()
    const occurrence = zoneCounters.get(zoneCode) || 0
    const zoneKey = `${zoneCode}#${occurrence}` as const
    zoneCounters.set(zoneCode, occurrence + 1)

    const zoneSpan = document.createElement('span')
    zoneSpan.className = 'intermarc-zone'
    zoneSpan.textContent = zoneCode
    if (originalZoneKeys.has(zoneKey)) zoneSpan.classList.add('diff-original')
    if (sessionZoneKeys.has(zoneKey)) zoneSpan.classList.add('diff-session')
    lineSpan.appendChild(zoneSpan)

    if (remainder) {
      const tokens = remainder.split(' $')
      tokens.forEach((token, index) => {
        const cleaned = token.trim()
        if (!cleaned) return
        const part = index === 0 ? cleaned : `$${cleaned}`
        const subSpan = document.createElement('span')
        subSpan.className = 'intermarc-subfield'
        const codeMatch = part.match(/^\$([^=\s]+)/)
        if (codeMatch) {
          const fullCode = `${zoneCode}$${codeMatch[1]}`
          const diffKey = `${zoneKey}|${fullCode}` as DiffKey
          if (originalDiffKeys.has(diffKey)) subSpan.classList.add('diff-original')
          if (sessionDiffKeys.has(diffKey)) subSpan.classList.add('diff-session')
        }
        const eqIndex = part.indexOf(' ')
        const codeSegment = (eqIndex >= 0 ? part.slice(0, eqIndex) : part).trim()
        const codeSpan = document.createElement('span')
        codeSpan.className = 'intermarc-subfield-code'
        codeSpan.textContent = ` ${codeSegment}`
        subSpan.appendChild(codeSpan)
        if (eqIndex >= 0) {
          const valueText = part.slice(eqIndex + 1).trim()
          const suffix = valueText ? ` ${valueText}` : ' '
          appendIntermarcValue(subSpan, suffix, tokenMap)
        }
        lineSpan.appendChild(subSpan)
      })
    }

    pre.appendChild(lineSpan)
    if (idx < lines.length - 1) pre.appendChild(document.createTextNode('\n'))
  })
}

function updateManifestationParent(
  manifestation: ManifestationItem,
  previousExpressionArk: string,
  newExpressionArk: string,
  newExpressionId?: string,
) {
  const record = curatedRecords.find(r => r.id === manifestation.id)
  if (!record) return
  const cloned = cloneIntermarc(record.intermarc)
  let updated = false
  for (const zone of cloned.zones) {
    if (zone.code !== '740') continue
    for (const sub of zone.sousZones) {
      if (sub.code === '740$3' && sub.valeur === previousExpressionArk) {
        sub.valeur = newExpressionArk
        updated = true
      }
    }
  }
  if (!updated) {
    const zone = cloned.zones.find(z => z.code === '740')
    const target = zone?.sousZones.find(sz => sz.code === '740$3')
    if (target) {
      target.valeur = newExpressionArk
      updated = true
    }
  }
  if (!updated) return
  updateRecordIntermarc(record, cloned)
  manifestation.expressionArk = newExpressionArk
  if (newExpressionId) manifestation.expressionId = newExpressionId
}

async function exportCurated() {
  if (!originalCsv || !curatedCsv) return
  // Start from original; override any curated rows, but apply user edits to anchors
  const headers = originalCsv.headers
  const idIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'id_entitelrm')
  const intIdx = headers.findIndex(h => h.replace(/\"/g, '').replace(/"/g, '') === 'intermarc')
  const curatedById = new Map<string, RecordRow>(curatedRecords.map(r => [r.id, r]))

  // Prepare edited anchor intermarc strings
  const editedAnchors = new Map<string, string>()
  const today = new Date().toISOString().slice(0, 10)
  for (const c of clusters) {
    const anchorRec = curatedById.get(c.anchorId)
    if (!anchorRec) continue
    // Build 90F entries from accepted items
    const accepted = c.items.filter(i => i.accepted)
    const newInter = add90FEntries(anchorRec.intermarc, accepted.map(i => ({ ark: i.ark, date: today, note: 'Clusterisation script' })))
    editedAnchors.set(c.anchorId, JSON.stringify(newInter))
  }

  const outRows: string[][] = []
  outRows.push(headers)
  for (const row of originalCsv.rows.slice(1)) {
    const id = row[idIdx]
    const curatedRec = curatedById.get(id)
    if (editedAnchors.has(id)) {
      const newRow = row.slice()
      newRow[intIdx] = editedAnchors.get(id)!
      outRows.push(newRow)
    } else if (curatedRec) {
      const newRow = row.slice()
      newRow[intIdx] = curatedRec.intermarcStr
      outRows.push(newRow)
    } else {
      outRows.push(row)
    }
  }

  const csvText = stringifyCsv({ headers, rows: outRows.slice(1) })
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'curated.csv'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

origInput.onchange = handleFilesChanged
curInput.onchange = handleFilesChanged
exportBtn.onclick = exportCurated

// Init default loading and drag/drop
loadDefaultData()

function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(FILE_DRAG_TYPE)
}

let activeFileDragCount = 0

window.addEventListener('dragenter', event => {
  if (!(event instanceof DragEvent)) return
  if (uploadModalOpen) return
  if (!isFileDrag(event)) return
  activeFileDragCount++
  dropHint.classList.add('visible')
})

window.addEventListener('dragover', event => {
  if (!(event instanceof DragEvent)) return
  if (uploadModalOpen) return
  if (!isFileDrag(event)) return
  event.preventDefault()
  dropHint.classList.add('visible')
})

window.addEventListener('dragleave', event => {
  if (!(event instanceof DragEvent)) return
  if (uploadModalOpen) return
  if (!isFileDrag(event)) return
  activeFileDragCount = Math.max(0, activeFileDragCount - 1)
  if (!activeFileDragCount) dropHint.classList.remove('visible')
})

window.addEventListener('drop', event => {
  if (!(event instanceof DragEvent)) return
  if (uploadModalOpen) return
  if (!isFileDrag(event)) return
  event.preventDefault()
  dropHint.classList.remove('visible')
  activeFileDragCount = 0
  if (event.dataTransfer?.files?.length) {
    processDroppedFiles(event.dataTransfer.files)
  }
})

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && uploadModalOpen) {
    closeUploadModal()
  }
})
