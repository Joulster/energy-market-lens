import RegulatoryWatch from './RegulatoryWatch.jsx'
import CustomerSignals from './CustomerSignals.jsx'

export default function NarrativePanel({ style }) {
  return (
    <aside className="narrative-panel" style={style}>
      <RegulatoryWatch />
      <div className="narrative-divider" />
      <CustomerSignals />
    </aside>
  )
}
