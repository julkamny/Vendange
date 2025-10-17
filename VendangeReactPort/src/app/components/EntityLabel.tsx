import { useMemo, type MouseEventHandler } from 'react'
import type { EntityBadgeSpec, CountBadgeKind } from '../types'
import { useTranslation } from '../hooks/useTranslation'
import { useArkDecoratedText } from '../hooks/useArkDecoratedText'

export type EntityPillProps = EntityBadgeSpec

export function EntityPill({ type, text, tooltip }: EntityPillProps) {
  const tooltipText = tooltip?.trim()
  const className = `entity-pill entity-pill-${type}${tooltipText ? ' has-tooltip' : ''}`
  const commonProps = tooltipText
    ? { 'data-tooltip': tooltipText, 'aria-label': tooltipText }
    : undefined
  return (
    <span className={className} {...commonProps}>
      {text}
    </span>
  )
}

export function CountBadge({ kind, count }: { kind: CountBadgeKind; count: number }) {
  const { t } = useTranslation()
  const tooltip = t(kind === 'expressions' ? 'badges.expressions' : 'badges.manifestations', { count })
  return (
    <span
      className={`entity-count-badge entity-count-badge--${kind} has-tooltip`}
      data-tooltip={tooltip}
      aria-label={tooltip}
    >
      {count}
    </span>
  )
}

export function AgentBadge({ names }: { names: string[] }) {
  const { t } = useTranslation()
  const tooltip = names.length ? names.join('\n') : t('messages.noAgents')
  return (
    <span className="entity-pill entity-pill-agent agent-badge has-tooltip" data-tooltip={tooltip} aria-label={tooltip}>
      {names.length}
    </span>
  )
}

export type EntityLabelProps = {
  title: string
  subtitle?: string
  badges?: EntityBadgeSpec[]
  counts?: Partial<Record<CountBadgeKind, number>>
  agentNames?: string[]
  className?: string
  onClick?: MouseEventHandler<HTMLSpanElement>
}

export function EntityLabel({
  title,
  subtitle,
  badges,
  counts,
  agentNames,
  className,
  onClick,
}: EntityLabelProps) {
  const decoratedTitle = useArkDecoratedText(title)
  const hasBadges = useMemo(() => {
    if (badges && badges.length) return true
    if (counts && (typeof counts.expressions === 'number' || typeof counts.manifestations === 'number')) return true
    if (agentNames) return true
    return false
  }, [badges, counts, agentNames])

  const classes = useMemo(() => {
    const values = ['entity-label']
    if (className) values.push(className)
    if (onClick) values.push('entity-label--clickable')
    return values.join(' ')
  }, [className, onClick])

  return (
    <span className={classes} onClick={onClick}>
      <span className="entity-title">{decoratedTitle}</span>
      {subtitle ? <span className="entity-subtitle">{subtitle}</span> : null}
      {hasBadges ? (
        <span className="entity-badges">
          {badges?.map((badge, index) => (
            <EntityPill key={`${badge.type}-${badge.text}-${index}`} {...badge} />
          ))}
          {typeof counts?.expressions === 'number' ? <CountBadge kind="expressions" count={counts.expressions} /> : null}
          {typeof counts?.manifestations === 'number' ? (
            <CountBadge kind="manifestations" count={counts.manifestations} />
          ) : null}
          {agentNames ? <AgentBadge names={agentNames} /> : null}
        </span>
      ) : null}
    </span>
  )
}
