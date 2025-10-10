declare module '@tanstack/virtual-core' {
  export type VirtualizerOptions<TScrollElement, TItemElement> = {
    count: number
    estimateSize: (index: number) => number
    getScrollElement: () => TScrollElement | null | undefined
    onChange?: () => void
    overscan?: number
    scrollToFn?: (offset: number) => void
    measureElement?: (element: TItemElement) => number
    observeElementOffset?: (
      instance: Virtualizer<TScrollElement, TItemElement>,
      element: TScrollElement,
      callback: (offset: number) => void,
    ) => () => void
    observeElementRect?: (
      instance: Virtualizer<TScrollElement, TItemElement>,
      element: TScrollElement,
      callback: (rect: DOMRect) => void,
    ) => () => void
  }

  export type VirtualItem = {
    index: number
    start: number
    size: number
  }

  export class Virtualizer<TScrollElement, TItemElement> {
    constructor(options: VirtualizerOptions<TScrollElement, TItemElement>)
    setOptions(options: VirtualizerOptions<TScrollElement, TItemElement>): void
    getVirtualItems(): VirtualItem[]
    getTotalSize(): number
    measureElement(element: TItemElement): void
    scrollToIndex(index: number, options?: { align?: 'start' | 'center' | 'end' }): void
    _willUpdate(): void
    _didMount(): () => void
  }

  export function elementScroll(offset: number): void
  export function measureElement<TElement extends Element>(element: TElement): number
  export function observeElementOffset<TElement extends Element>(
    instance: Virtualizer<TElement, Element>,
    element: TElement,
    callback: (offset: number) => void,
  ): () => void
  export function observeElementRect<TElement extends Element>(
    instance: Virtualizer<TElement, Element>,
    element: TElement,
    callback: (rect: DOMRect) => void,
  ): () => void
}
