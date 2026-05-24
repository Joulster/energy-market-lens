export function computePrevDates(rangeKey) {
  const { startDate, endDate } = computeDates(rangeKey)

  // Full-year ranges: step back exactly one calendar year
  if (rangeKey === '2025') return { startDate: '2024-01-01', endDate: '2024-12-31' }
  if (rangeKey === 'ytd') {
    const y = new Date().getFullYear()
    return { startDate: `${y - 1}-01-01`, endDate: `${y - 1}-${endDate.slice(5)}` }
  }

  // Rolling ranges (7d / 14d / 30d / 90d): shift back by the same span
  const span     = Math.round((new Date(endDate) - new Date(startDate)) / 86_400_000)
  const prevEnd  = new Date(startDate); prevEnd.setDate(prevEnd.getDate() - 1)
  const prevStart = new Date(prevEnd);  prevStart.setDate(prevStart.getDate() - span)
  return {
    startDate: prevStart.toISOString().slice(0, 10),
    endDate:   prevEnd.toISOString().slice(0, 10),
  }
}

export const RANGE_OPTIONS = [
  { key: '7d',   label: '7d'   },
  { key: '14d',  label: '14d'  },
  { key: '30d',  label: '30d'  },
  { key: '90d',  label: '90d'  },
  { key: 'ytd',  label: 'YTD'  },
  { key: '2025', label: '2025' },
]

export function computeDates(rangeKey) {
  const today    = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const offset   = (days) => {
    const d = new Date(today)
    d.setDate(d.getDate() - days)
    return d.toISOString().slice(0, 10)
  }
  switch (rangeKey) {
    case '7d':   return { startDate: offset(7),  endDate: todayStr }
    case '14d':  return { startDate: offset(14), endDate: todayStr }
    case '30d':  return { startDate: offset(30), endDate: todayStr }
    case '90d':  return { startDate: offset(90), endDate: todayStr }
    case 'ytd':  return { startDate: `${today.getFullYear()}-01-01`, endDate: todayStr }
    case '2025': return { startDate: '2025-01-01', endDate: '2025-12-31' }
    default:     return { startDate: offset(7),  endDate: todayStr }
  }
}
