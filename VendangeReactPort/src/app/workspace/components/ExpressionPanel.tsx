import type { Cluster, ExpressionClusterItem, ExpressionItem } from '../../types'
import type { WorkspaceTabState } from '../types'
import { useTranslation } from '../../hooks/useTranslation'

type ExpressionPanelProps = {
  cluster: Cluster | null
  state: WorkspaceTabState
  onSelectExpression: (payload: {
    expressionId: string
    expressionArk?: string
    workArk?: string
    anchorId?: string
  }) => void
  onToggleExpression: (payload: {
    anchorExpressionId: string
    expressionArk: string
    accepted: boolean
  }) => void
}

export function ExpressionPanel({ cluster, state, onSelectExpression, onToggleExpression }: ExpressionPanelProps) {
  const { t } = useTranslation()
  if (!cluster) return <em>{t('messages.noClusters')}</em>

  const renderExpressionEntry = (expression: ExpressionItem | ExpressionClusterItem, options: { isAnchor?: boolean }) => {
    const isActive = state.highlightedExpressionArk === expression.ark || state.activeExpressionAnchorId === expression.id
    return (
      <button
        key={expression.id}
        type="button"
        className={`expression-entry${isActive ? ' is-active' : ''}`}
        onClick={() =>
          onSelectExpression({
            expressionId: expression.id,
            expressionArk: expression.ark,
            workArk: expression.workArk,
            anchorId: options.isAnchor ? expression.id : undefined,
          })
        }
      >
        <span className="expression-entry__title">{expression.title || expression.id}</span>
        <span className="expression-entry__meta">{expression.manifestations.length} manifest.</span>
      </button>
    )
  }

  return (
    <div className="expression-panel">
      {cluster.expressionGroups.map(group => (
        <section key={group.anchor.id} className="expression-group">
          <header className="expression-group__header">⚓︎ {group.anchor.title || group.anchor.id}</header>
          <div className="expression-group__list">
            {renderExpressionEntry(group.anchor, { isAnchor: true })}
            {group.clustered.map(item => (
              <div key={item.id} className="expression-entry-row">
                {renderExpressionEntry(item, { isAnchor: false })}
                {item.ark && (
                  <label className="expression-entry-toggle">
                    <input
                      type="checkbox"
                      checked={item.accepted}
                      onChange={event =>
                        onToggleExpression({
                          anchorExpressionId: group.anchor.id,
                          expressionArk: item.ark!,
                          accepted: event.target.checked,
                        })
                      }
                    />
                    {item.accepted
                      ? t('labels.checkedLabel', { defaultValue: 'Kept' })
                      : t('labels.uncheckedLabel')}
                  </label>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      {cluster.independentExpressions.length > 0 && (
        <section className="expression-group expression-group--independent">
          <header className="expression-group__header">{t('labels.independentExpressions')}</header>
          <div className="expression-group__list">
            {cluster.independentExpressions.map(expr => renderExpressionEntry(expr, { isAnchor: false }))}
          </div>
        </section>
      )}
    </div>
  )
}
