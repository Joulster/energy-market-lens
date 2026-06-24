import { useState, useEffect } from 'react'

let _setLines = null

export function pushStatus(msg) {
  _setLines?.(prev => {
    const next = [...prev, { msg, id: Date.now() + Math.random() }]
    return next.slice(-4)
  })
}

export default function StatusBar() {
  const [lines, setLines] = useState([{ msg: 'System ready', id: 0 }])

  useEffect(() => {
    _setLines = setLines
    return () => { _setLines = null }
  }, [])

  return (
    <div className="status-bar">
      {lines.map((item, i) => (
        <span
          key={item.id}
          className="status-bar-line"
          style={{ opacity: 0.4 + 0.6 * ((i + 1) / lines.length) }}
        >
          &gt; {item.msg}
        </span>
      ))}
    </div>
  )
}
