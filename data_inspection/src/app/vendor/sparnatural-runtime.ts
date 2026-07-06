import sparnaturalBundleUrl from 'sparnatural/dist/browser?url'

const SPARNATURAL_ELEMENT_NAME = 'spar-natural'

/** Load Sparnatural's self-contained browser build exactly once. */
function loadSparnaturalRuntime(): Promise<void> {
  if (customElements.get(SPARNATURAL_ELEMENT_NAME)) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = sparnaturalBundleUrl
    script.async = true
    script.addEventListener('load', () => {
      if (customElements.get(SPARNATURAL_ELEMENT_NAME)) resolve()
      else reject(new Error('Sparnatural loaded without registering its custom element'))
    }, { once: true })
    script.addEventListener('error', () => reject(new Error('Unable to load Sparnatural')), { once: true })
    document.head.append(script)
  })
}

export const sparnaturalRuntimeReady = loadSparnaturalRuntime()
