import { useRef, useState, useCallback } from 'react'

/**
 * Drag-to-zoom for Recharts charts.
 *
 * @param {Array}  data  - the full dataset for this chart
 * @param {string} xKey  - the key used as the x-axis dataKey (default 'ts')
 *
 * Returns:
 *   displayData  — filtered slice to pass as chart `data`
 *   handlers     — { onMouseDown, onMouseMove, onMouseUp } spread onto the chart component
 *   refArea      — { left, right } current drag selection (strings or null) for <ReferenceArea>
 *   isZoomed     — boolean, true when a zoom domain is active
 *   reset        — function to clear zoom
 */
export function useZoom(data, xKey = 'ts') {
  // Refs hold in-progress selection values so onMouseUp always reads the latest
  const selecting  = useRef(false)
  const leftRef    = useRef(null)
  const rightRef   = useRef(null)

  // State only for things that need to trigger a re-render
  const [refArea, setRefArea] = useState({ left: null, right: null })
  const [domain,  setDomain]  = useState(null)   // [leftVal, rightVal] when zoomed

  const displayData = domain
    ? data.filter(d => d[xKey] >= domain[0] && d[xKey] <= domain[1])
    : data

  const handlers = {
    onMouseDown(e) {
      const label = e?.activeLabel
      if (label == null) return
      selecting.current  = true
      leftRef.current    = label
      rightRef.current   = null
      setRefArea({ left: label, right: null })
    },
    onMouseMove(e) {
      if (!selecting.current) return
      const label = e?.activeLabel
      if (label == null) return
      rightRef.current = label
      setRefArea(prev => ({ ...prev, right: label }))
    },
    onMouseUp() {
      if (!selecting.current) return
      selecting.current = false
      const l = leftRef.current
      const r = rightRef.current
      setRefArea({ left: null, right: null })
      leftRef.current  = null
      rightRef.current = null
      if (l != null && r != null && l !== r) {
        const sorted = [l, r].sort()
        setDomain(sorted)
      }
    },
  }

  const reset = useCallback(() => {
    setDomain(null)
    setRefArea({ left: null, right: null })
    selecting.current = false
    leftRef.current   = null
    rightRef.current  = null
  }, [])

  return { displayData, handlers, refArea, isZoomed: domain !== null, reset }
}
