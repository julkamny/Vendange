// @ts-expect-error - jQuery ships CommonJS typings that bundler resolution cannot locate
import jquery from 'jquery/dist/jquery'
import { Readable } from 'readable-stream'

type JQueryModule = typeof jquery
type ReadableCtor = typeof Readable

const globalScope = globalThis as typeof globalThis & {
  $?: JQueryModule
  jQuery?: JQueryModule
  Readable?: ReadableCtor
}

if (!globalScope.$) {
  globalScope.$ = jquery
}

if (!globalScope.jQuery) {
  globalScope.jQuery = jquery
}

if (typeof globalScope.Readable !== 'function') {
  globalScope.Readable = Readable
}

export {}
