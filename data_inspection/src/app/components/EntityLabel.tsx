import { useMemo, type MouseEventHandler } from 'react'
import type { EntityBadgeSpec, CountBadgeKind, EntityTitleSegment } from '../types'
import { useTranslation } from '../hooks/useTranslation'
import { useArkDecoratedText } from '../hooks/useArkDecoratedText'
import type { MediaKind } from '../core/media'

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

const BADGE_LABEL_KEYS: Record<CountBadgeKind, string> = {
  expressions: 'badges.expressions',
  manifestations: 'badges.manifestations',
  works: 'badges.works',
  workLinks: 'badges.workLinks',
  expressionLinks: 'badges.expressionLinks',
}

export function CountBadge({ kind, count }: { kind: CountBadgeKind; count: number }) {
  const { t } = useTranslation()
  const tooltip = t(BADGE_LABEL_KEYS[kind], { count })
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

export function RelationshipBadge({ outgoing, incoming }: { outgoing: number; incoming: number }) {
  const { t } = useTranslation()
  const tooltip = t('badges.relationshipsDetailed', { outgoing, incoming })
  return (
    <span
      className="entity-count-badge entity-count-badge--relationships has-tooltip"
      data-tooltip={tooltip}
      aria-label={tooltip}
    >
      {`${outgoing}|${incoming}`}
    </span>
  )
}

export type EntityLabelProps = {
  title: string
  badges?: EntityBadgeSpec[]
  counts?: Partial<Record<CountBadgeKind, number>>
  agentNames?: string[]
  relationships?: { outgoing: number; incoming: number }
  className?: string
  onClick?: MouseEventHandler<HTMLSpanElement>
  titleSegments?: EntityTitleSegment[]
  mediaKinds?: MediaKind[]
}

export function EntityLabel({
  title,
  badges,
  counts,
  agentNames,
  relationships,
  className,
  onClick,
  titleSegments,
  mediaKinds,
}: EntityLabelProps) {
  const decoratedTitle = useArkDecoratedText(title)
  const visibleCounts = useMemo(() => {
    if (!counts) return []
    const entries: Array<{ kind: CountBadgeKind; value: number }> = []
    ;(['expressions', 'manifestations', 'works', 'workLinks', 'expressionLinks'] as CountBadgeKind[]).forEach(kind => {
      const value = counts[kind]
      if (typeof value !== 'number') return
      const shouldDisplay =
        kind === 'workLinks' || kind === 'expressionLinks' ? value > 1 : value > 0
      if (shouldDisplay) entries.push({ kind, value })
    })
    return entries
  }, [counts])
  const hasBadges = useMemo(() => {
    if (badges && badges.length) return true
    if (visibleCounts.length) return true
    if (agentNames && agentNames.length > 0) return true
    if (relationships && (relationships.outgoing > 0 || relationships.incoming > 0)) return true
    return false
  }, [agentNames, badges, relationships, visibleCounts])

  const classes = useMemo(() => {
    const values = ['entity-label']
    if (className) values.push(className)
    if (onClick) values.push('entity-label--clickable')
    return values.join(' ')
  }, [className, onClick])

  const segments = titleSegments?.filter(segment => segment?.value && segment.value.trim().length > 0)
  const media = useMemo(() => mediaKinds ?? [], [mediaKinds])

  return (
    <span className={classes} onClick={onClick}>
      {segments && segments.length ? (
        <span className="entity-title entity-title--segmented">
          {segments.map((segment, index) => (
            <TitleSegmentChip key={`${segment.code}-${index}`} segment={segment} />
          ))}
        </span>
      ) : (
        <span className="entity-title">{decoratedTitle}</span>
      )}
      {hasBadges ? (
        <span className="entity-badges">
          {badges?.map((badge, index) => (
            <EntityPill key={`${badge.type}-${badge.text}-${index}`} {...badge} />
          ))}
          {visibleCounts.map(entry => (
            <CountBadge key={entry.kind} kind={entry.kind} count={entry.value} />
          ))}
          {relationships && (relationships.outgoing > 0 || relationships.incoming > 0) ? (
            <RelationshipBadge outgoing={relationships.outgoing} incoming={relationships.incoming} />
          ) : null}
          {agentNames && agentNames.length ? <AgentBadge names={agentNames} /> : null}
        </span>
      ) : null}
      {media.length ? (
        <span className="entity-media-emojis">
          {media.map(kind => (
            <span
              key={kind.emoji}
              className="entity-media-emoji"
              role="img"
              aria-label={kind.label}
              title={kind.label}
            >
              {kind.emoji}
            </span>
          ))}
        </span>
      ) : null}
    </span>
  )
}

function TitleSegmentChip({ segment }: { segment: EntityTitleSegment }) {
  const value = useArkDecoratedText(segment.value)
  return (
    <span className="entity-title-segment" data-subfield={segment.code} title={segment.ark ?? undefined}>
      <span className="entity-title-segment-label">{segment.label}</span>
      <span className="entity-title-segment-value">{value}</span>
    </span>
  )
}
