import { useMemo } from 'react'
import type { Cluster, ManifestationItem } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'

type ManifestationPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabState
  onSelectManifestation: (payload: {
    manifestationId: string
    expressionId?: string
    expressionArk?: string
  }) => void
  onAssignManifestation: (payload: {
    manifestationId: string
    anchorExpressionId: string | null
    expressionId?: string
    expressionArk: string
  }) => void
}

type ExpressionOption = {
  label: string
  expressionId?: string
  expressionArk: string
  anchorExpressionId: string | null
}

export function ManifestationPanel({
  cluster,
  state,
  onSelectManifestation,
  onAssignManifestation,
}: ManifestationPanelProps) {
  const { t } = useTranslation()
  if (!cluster) return <em>{t('messages.noClusters')}</em>
  const expressionOptions = useMemo<ExpressionOption[]>(() => {
    if (!cluster) return []
    const options: ExpressionOption[] = []
    for (const group of cluster.expressionGroups) {
      if (group.anchor.ark) {
        options.push({
          label: `⚓︎ ${group.anchor.title || group.anchor.id}`,
          expressionId: group.anchor.id,
          expressionArk: group.anchor.ark,
          anchorExpressionId: group.anchor.id,
        })
      }
      for (const expr of group.clustered) {
        if (!expr.ark) continue
        options.push({
          label: expr.title || expr.id,
          expressionId: expr.id,
          expressionArk: expr.ark,
          anchorExpressionId: group.anchor.id,
        })
      }
    }
    for (const expr of cluster.independentExpressions) {
      if (!expr.ark) continue
      options.push({
        label: expr.title || expr.id,
        expressionId: expr.id,
        expressionArk: expr.ark,
        anchorExpressionId: null,
      })
    }
    return options
  }, [cluster])
  if (!expressionOptions.length) {
    return <em>{t('messages.noClusters')}</em>
  }

  const renderManifestation = (manifestation: ManifestationItem) => {
    const isActive = state.selectedEntity?.entityType === 'manifestation' && state.selectedEntity.id === manifestation.id
    const selectedExpression = manifestation.expressionArk
    const selectValue = expressionOptions.some(option => option.expressionArk === selectedExpression)
      ? selectedExpression ?? ''
      : expressionOptions[0]?.expressionArk ?? ''
    return (
      <li key={manifestation.id}>
        <div className={`manifestation-entry${isActive ? ' is-active' : ''}`}>
          <button
            type="button"
            onClick={() =>
              onSelectManifestation({
                manifestationId: manifestation.id,
                expressionId: manifestation.expressionId,
                expressionArk: manifestation.expressionArk,
              })
            }
          >
            <span>{manifestation.title || manifestation.id}</span>
          </button>
          <select
            className="manifestation-expression-select"
            value={selectValue}
            onChange={event => {
              const nextArk = event.target.value
              if (!nextArk || nextArk === manifestation.expressionArk) return
              const next = expressionOptions.find(option => option.expressionArk === nextArk)
              if (!next) return
              onAssignManifestation({
                manifestationId: manifestation.id,
                anchorExpressionId: next.anchorExpressionId,
                expressionId: next.expressionId,
                expressionArk: next.expressionArk,
              })
            }}
          >
            {expressionOptions.map(option => (
              <option key={`${option.anchorExpressionId ?? 'independent'}:${option.expressionArk}`} value={option.expressionArk}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </li>
    )
  }

  const renderManifestationList = (manifestations: ManifestationItem[]) => {
    if (!manifestations.length) return <p>{t('labels.noManifestations')}</p>
    return <ul className="manifestation-list">{manifestations.map(renderManifestation)}</ul>
  }

  return (
    <div className="manifestation-panel">
      {cluster.expressionGroups.map(group => (
        <section key={group.anchor.id} className="manifestation-group">
          <header className="manifestation-group__header">⚓︎ {group.anchor.title || group.anchor.id}</header>
          {renderManifestationList(group.anchor.manifestations)}
          {group.clustered.map(expr => (
            <div key={expr.id} className="manifestation-subgroup">
              <header>{expr.title || expr.id}</header>
              {renderManifestationList(expr.manifestations)}
            </div>
          ))}
        </section>
      ))}
      {cluster.independentExpressions.length > 0 && (
        <section className="manifestation-group manifestation-group--independent">
          <header>{t('labels.independentExpressions')}</header>
          {cluster.independentExpressions.map(expr => (
            <div key={expr.id} className="manifestation-subgroup">
              <header>{expr.title || expr.id}</header>
              {renderManifestationList(expr.manifestations)}
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
