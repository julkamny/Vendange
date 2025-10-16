import { EditorView } from '@codemirror/view'

export const INTERMARC_THEME = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
      fontFamily: 'Menlo, Consolas, "Roboto Mono", "SFMono-Regular", monospace',
      color: 'var(--color-text)',
    },
    '.cm-editor': {
      backgroundColor: 'transparent',
    },
    '.cm-cursor': {
      display: 'none',
    },
    '.cm-activeLine': {
      backgroundColor: 'transparent',
    },
    '.cm-content': {
      fontSize: '0.88rem',
      lineHeight: '1.45',
    },
    '.cm-line': {
      padding: '0',
    },
    '.cm-scroller': {
      fontFamily: 'inherit',
    },
    '.cm-selectionBackground': {
      background: 'color-mix(in srgb, var(--color-link) 25%, transparent)',
    },
  },
  { dark: true },
)
