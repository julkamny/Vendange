import { Fragment } from 'react'
import { useArkDecoratedText } from '../../hooks/useArkDecoratedText'

function BreadcrumbItem({ value, isLast }: { value: string; isLast: boolean }) {
  const label = useArkDecoratedText(value)
  return (
    <span className={`workspace-breadcrumb${isLast ? ' is-current' : ''}`} aria-current={isLast ? 'page' : undefined}>
      {label}
    </span>
  )
}

export function WorkspaceBreadcrumbs({ items, ariaLabel }: { items: string[]; ariaLabel: string }) {
  if (!items.length) return null
  return (
    <nav className="workspace-breadcrumbs" aria-label={ariaLabel}>
      {items.map((item, index) => (
        <Fragment key={`${item}-${index}`}>
          <BreadcrumbItem value={item} isLast={index === items.length - 1} />
          {index < items.length - 1 ? <span className="workspace-breadcrumb-separator" aria-hidden="true">›</span> : null}
        </Fragment>
      ))}
    </nav>
  )
}
