import RegulatoryWatch from './RegulatoryWatch.jsx'
import CustomerSignals from './CustomerSignals.jsx'

export default function NarrativePanel({ promptSettings, style }) {
  return (
    <aside className="narrative-panel" style={style}>
      <RegulatoryWatch regulatoryPrompt={promptSettings.regulatory} />
      <div className="narrative-divider" />
      <CustomerSignals customerSignalsPrompt={promptSettings.customerSignals} />
    </aside>
  )
}
