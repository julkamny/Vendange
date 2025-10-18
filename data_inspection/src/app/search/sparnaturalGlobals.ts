// @ts-expect-error - jQuery ships CommonJS typings that bundler resolution cannot locate
import jquery from 'jquery/dist/jquery'

type JQueryModule = typeof jquery

const globalScope = globalThis as typeof globalThis & {
  $?: JQueryModule
  jQuery?: JQueryModule
}

if (!globalScope.$) {
  globalScope.$ = jquery
}

if (!globalScope.jQuery) {
  globalScope.jQuery = jquery
}

export {}
