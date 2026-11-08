// KPI calculations. Everything is computed from the same state the app runs on.
// The 10 days of history are SYNTHETIC seed data: figures are illustrations, not business results.
import { MIN } from './util.js'

const dayKey = (ms) => new Date(ms).toLocaleDateString('en-CA')
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const r1 = (n) => Math.round(n * 10) / 10

export function computeAnalytics(state, now) {
  const paid = state.orders.filter((o) => o.paymentStatus === 'paid' || o.paymentStatus === 'refund_initiated')
  const real = paid.filter((o) => o.status !== 'cancelled')
  const entries = state.queue
  const seated = entries.filter((q) => q.status === 'seated' && q.seatedAt)
  const queuedSeated = seated.filter((q) => q.history ? q.queued : true)

  const waits = queuedSeated.map((q) => (q.seatedAt - q.joinedAt) / MIN)
  const abandoned = entries.filter((q) => ['abandoned', 'no_show'].includes(q.status))
  const joinedTotal = entries.filter((q) => (q.history ? q.queued : true) && q.status !== 'waiting' && q.status !== 'called')

  const firstServe = real.filter((o) => o.firstServedAt && o.clockStartAt).map((o) => ({ type: o.type, min: (o.firstServedAt - o.clockStartAt) / MIN }))
  const completion = real.filter((o) => o.readyAt && o.clockStartAt).map((o) => (o.readyAt - o.clockStartAt) / MIN)
  const prepItems = state.orderItems.filter((i) => i.actualPrepMin != null)

  const sessions = state.sessions.filter((s) => s.status === 'ended' && s.endedAt)
  const dwell = sessions.map((s) => (s.endedAt - s.seatedAt) / MIN)
  const days = [...new Set(state.sessions.map((s) => dayKey(s.seatedAt)))]
  const turnover = days.length ? state.sessions.length / days.length / state.tables.length : 0

  const preorderEntries = seated.filter((q) => q.preorderOrderId || state.orders.some((o) => o.queueEntryId === q.id && o.type === 'preorder' && o.paymentStatus === 'paid'))
  const queuedForAdoption = seated.filter((q) => (q.history ? q.queued : true))
  const adoption = queuedForAdoption.length ? (queuedForAdoption.filter((q) => preorderEntries.includes(q)).length / queuedForAdoption.length) * 100 : 0

  const accuracy = real.length ? (real.filter((o) => !o.hadIssue && !(o.refundedAmount > 0)).length / real.length) * 100 : 0

  // Prediction quality: did the promised wait match what happened?
  const predicted = queuedSeated.filter((q) => q.predictedWaitMin != null)
  const predErr = predicted.map((q) => Math.abs((q.seatedAt - q.joinedAt) / MIN - q.predictedWaitMin))

  // Per day
  const dayMap = {}
  const ensure = (k) => (dayMap[k] ||= { day: k, orders: 0, revenue: 0, preorders: 0, qr: 0, waits: [], abandoned: 0, joined: 0 })
  real.forEach((o) => {
    const d = ensure(dayKey(o.createdAt))
    d.orders += 1
    d.revenue += o.total - (o.refundedAmount || 0)
    o.type === 'preorder' ? d.preorders++ : d.qr++
  })
  entries.forEach((q) => {
    const d = ensure(dayKey(q.joinedAt))
    if (q.history ? q.queued : true) d.joined++
    if (['abandoned', 'no_show'].includes(q.status)) d.abandoned++
    if (q.status === 'seated' && (q.history ? q.queued : true)) d.waits.push((q.seatedAt - q.joinedAt) / MIN)
  })
  const daily = Object.values(dayMap)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((d) => ({ ...d, label: new Date(d.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), avgWait: r1(avg(d.waits)), abandonRate: d.joined ? r1((d.abandoned / d.joined) * 100) : 0 }))

  // Popular dishes + prep time per dish
  const dishAgg = {}
  state.orderItems.filter((i) => i.status !== 'cancelled').forEach((i) => {
    const a = (dishAgg[i.name] ||= { name: i.name, qty: 0, revenue: 0, prep: [], station: i.station })
    a.qty += i.qty
    a.revenue += i.qty * i.unitPrice
    if (i.actualPrepMin != null) a.prep.push(i.actualPrepMin)
  })
  const dishes = Object.values(dishAgg)
  const popular = [...dishes].sort((a, b) => b.qty - a.qty).slice(0, 8)
  const prepByDish = dishes.filter((d) => d.prep.length >= 3).map((d) => ({ name: d.name, actual: r1(avg(d.prep)), standard: state.menu.find((m) => m.name === d.name)?.prepMin || 0 })).sort((a, b) => b.actual - a.actual).slice(0, 10)

  // Station workload (dish-minutes by station)
  const stationLoadData = state.stations.map((st) => {
    const items = prepItemsFor(state, st.id)
    return { station: st.name, dishes: items.count, minutes: Math.round(items.minutes) }
  })

  // Peak hours
  const hourly = Array.from({ length: 13 }, (_, i) => ({ hour: i + 11, label: `${((i + 11) % 12) || 12}${i + 11 < 12 ? 'am' : 'pm'}`, arrivals: 0, orders: 0 }))
  entries.forEach((q) => { const h = new Date(q.joinedAt).getHours(); const row = hourly.find((x) => x.hour === h); if (row) row.arrivals++ })
  real.forEach((o) => { const h = new Date(o.createdAt).getHours(); const row = hourly.find((x) => x.hour === h); if (row) row.orders++ })

  // Pre-order vs table order
  const pre = firstServe.filter((x) => x.type === 'preorder').map((x) => x.min)
  const qr = firstServe.filter((x) => x.type === 'qr').map((x) => x.min)
  const preorders = real.filter((o) => o.type === 'preorder')
  const qrOrders = real.filter((o) => o.type === 'qr')
  const comparison = [
    { metric: 'Avg. minutes seating → first dish', preorder: r1(avg(pre)), qr: r1(avg(qr)) },
    { metric: 'Avg. order value (₹)', preorder: Math.round(avg(preorders.map((o) => o.total))), qr: Math.round(avg(qrOrders.map((o) => o.total))) },
  ]

  return {
    kpis: {
      avgWait: r1(avg(waits)),
      seatToFirstServed: r1(avg(firstServe.map((x) => x.min))),
      avgPrep: r1(avg(prepItems.map((i) => i.actualPrepMin))),
      turnover: r1(turnover),
      dwell: Math.round(avg(dwell)),
      abandonRate: joinedTotal.length ? r1((abandoned.length / joinedTotal.length) * 100) : 0,
      adoption: r1(adoption),
      completion: r1(avg(completion)),
      revenue: real.reduce((s, o) => s + o.total - (o.refundedAmount || 0), 0),
      orderCount: real.length,
      accuracy: r1(accuracy),
      predictionError: r1(avg(predErr)),
    },
    daily,
    popular,
    prepByDish,
    stationLoadData,
    hourly,
    comparison,
    counts: { pre: pre.length, qr: qr.length, preorders: preorders.length, qrOrders: qrOrders.length },
  }
}

function prepItemsFor(state, stationId) {
  const items = state.orderItems.filter((i) => i.station === stationId && i.status !== 'cancelled')
  const minutes = items.reduce((s, i) => s + (i.actualPrepMin ?? state.menu.find((m) => m.id === i.menuItemId)?.prepMin ?? 0), 0)
  return { count: items.reduce((s, i) => s + i.qty, 0), minutes }
}
