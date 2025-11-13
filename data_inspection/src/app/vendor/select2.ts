import type { JQueryStatic } from 'jquery'
import $ from './jquery-global'
import select2Module from 'select2'
import 'select2/dist/css/select2.css'

const select2Factory =
  typeof (select2Module as { default?: unknown }).default === 'function'
    ? ((select2Module as { default: (root?: Window, jquery?: JQueryStatic) => void }).default)
    : (select2Module as unknown as (root?: Window, jquery?: JQueryStatic) => void)

if (typeof select2Factory === 'function') {
  const root = typeof window !== 'undefined' ? window : undefined
  select2Factory(root, $)
}
