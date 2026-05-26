export const legendStyle = { fontSize: 12, color: '#94a3b8', paddingTop: 4 }

export const COLORS = {
  blue: '#60a5fa',
  green: '#34d399',
  amber: '#fbbf24',
  purple: '#a78bfa',
  cyan: '#22d3ee',
  orange: '#fb923c',
}

export const chartProps = {
  margin: { top: 8, right: 12, left: 0, bottom: 4 },
}

export function fmtDate(d) {
  if (!d) return ''
  return d.slice(5)
}

export function SourceBadge({ source, isMock }) {
  return (
    <span className={`source-badge ${isMock ? 'mock' : 'real'}`}>
      {isMock ? 'N/A' : source}
    </span>
  )
}

// Custom tooltip used across all charts.
// - Rounds every value to 2 dp
// - When compare is on, shows a colour-coded delta (current − prev)
// Convention: if current series has dataKey "foo", its prev series has dataKey "prevFoo"
export function CompareTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null

  const curr = payload.filter(p => !String(p.dataKey).startsWith('prev'))

  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-label">{label}</p>
      {curr.map(item => {
        const prevKey   = 'prev' + String(item.dataKey)[0].toUpperCase() + String(item.dataKey).slice(1)
        const prevEntry = payload.find(p => p.dataKey === prevKey)
        const val   = item.value
        const prev  = prevEntry?.value
        const delta = val != null && prev != null ? val - prev : null

        return (
          <div key={item.dataKey} className="chart-tooltip-row">
            <span className="chart-tooltip-dot" style={{ background: item.color }} />
            <span className="chart-tooltip-name">{item.name}</span>
            <span className="chart-tooltip-val">{val != null ? Number(val).toFixed(2) : '—'}</span>
            {delta != null && (
              <span className={`chart-tooltip-delta${delta >= 0 ? ' pos' : ' neg'}`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(2)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function ChartWrap({ children, title, source, isMock, isLoading, error, controls, zoomed, onReset }) {
  return (
    <div className="chart-wrap">
      <div className="chart-header">
        <div className="chart-header-left">
          <h3 className="chart-title">{title}</h3>
          {!isMock && !isLoading && controls}
          {!isMock && !isLoading && zoomed && <button className="zoom-reset-btn" onClick={onReset}>↺ Reset</button>}
        </div>
        {source && <SourceBadge source={source} isMock={isMock} />}
      </div>
      {isLoading ? (
        <div className="chart-skeleton">
          <div className="chart-skeleton-bar" style={{ height: '55%' }} />
          <div className="chart-skeleton-bar" style={{ height: '80%' }} />
          <div className="chart-skeleton-bar" style={{ height: '40%' }} />
          <div className="chart-skeleton-bar" style={{ height: '70%' }} />
          <div className="chart-skeleton-bar" style={{ height: '60%' }} />
          <div className="chart-skeleton-bar" style={{ height: '90%' }} />
          <div className="chart-skeleton-bar" style={{ height: '45%' }} />
          <div className="chart-skeleton-bar" style={{ height: '75%' }} />
          <div className="chart-skeleton-bar" style={{ height: '35%' }} />
          <div className="chart-skeleton-bar" style={{ height: '65%' }} />
        </div>
      ) : error ? (
        <div className="chart-empty-state">
          <span className="chart-empty-icon">⚠</span>
          <p className="chart-empty-title">Data unavailable</p>
          <p className="chart-empty-sub chart-empty-error">{error}</p>
        </div>
      ) : isMock ? (
        <div className="chart-empty-state">
          <span className="chart-empty-icon">⏳</span>
          <p className="chart-empty-title">Coming soon</p>
          <p className="chart-empty-sub">Pending authorisation from TenneT</p>
        </div>
      ) : children}
    </div>
  )
}
