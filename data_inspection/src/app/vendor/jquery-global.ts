import $ from 'jquery'

const globalWithJQuery = globalThis as typeof globalThis & { $?: typeof $; jQuery?: typeof $ }
globalWithJQuery.$ = globalWithJQuery.$ ?? $
globalWithJQuery.jQuery = globalWithJQuery.jQuery ?? $

export default $
