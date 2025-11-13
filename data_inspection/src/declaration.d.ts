import type React from 'react'
import type { SparnaturalElement } from 'sparnatural'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'spar-natural': React.DetailedHTMLProps<React.HTMLAttributes<SparnaturalElement>, SparnaturalElement>
    }
  }
}
