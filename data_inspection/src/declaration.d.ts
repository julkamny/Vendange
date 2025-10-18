import type React from 'react'
import type { SparnaturalElement } from 'sparnatural'

declare module 'sparnatural/dist/browser'

declare module '*.wasm?url' {
  const url: string
  export default url
}

declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      'spar-natural': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        ref?: React.Ref<SparnaturalElement>
        src: string
        lang?: string
        defaultLang?: string
        endpoint?: string
        prefix?: string
        distinct?: string
        limit?: string
        debug?: string
        catalog?: string
      }
    }
  }
}

export {}
