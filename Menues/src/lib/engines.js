// DineFlow engines — pure functions, no browser APIs, no React.
// 1. Waiting-time prediction (rule based, replaceable by an ML model)
// 2. Fair seating policy (best fit with bounded skipping)
// 3. Kitchen plan: station lanes, dish estimates, whole-order estimates
// 4. Pre-order scheduler (schedule backwards from the expected seating time)

import { MIN } from './util.js'

// ───────────────────────── Waiting-time prediction ─────────────────────────

export function diningMinutes(settings, partySize, at) {
  const d = settings.dining
  const base = partySize <= 2 ? d.small : partySize <= 4 ? d.medium : d.large
  const hour = new Date(at).getHours()
  const isPeak = settings.peakHours.some(([from, to]) => hour >= from && hour < to)
  return Math.round(base * (isPeak ? settings.peakMultiplier : 1))
}

export function sortedWaiting(state) {
  return state.queue
    .filter((q) => q.status === 'waiting')
    .sort((a, b) => (b.priority || 0) - (a.priority || 0) || a.joinedAt - b.joinedAt)
}

// When will this table be free for the next party? (ms timestamp, Infinity if blocked)
export function tableFreeAt(state, table, now) {
  const { settings } = state
  const clean = settings.cleaningMinutes * MIN
  if (table.status === 'blocked') return Infinity
  if (table.status === 'available') return now
  if (table.status === 'cleaning') return Math.max(now, table.cleanDoneAt || now + clean)
  if (table.status === 'reserved') {
    const entry = state.queue.find((q) => q.id === table.heldFor)
    const seatAt = Math.max(now, (entry?.calledAt || now) + settings.walkInMinutes * MIN)
    const party = entry?.partySize || 2
    return seatAt + diningMinutes(settings, party, seatAt) * MIN + clean
  }
  // occupied
  const session = state.sessions.find((s) => s.id === table.sessionId)
  let departAt = session?.expectedDepartAt || now + 30 * MIN
  if (departAt < now) departAt = now + 5 * MIN // guests have overstayed: assume leaving soon
  return departAt + clean
}

function preferenceMismatch(entry, table) {
  if (!entry.preference || entry.preference === 'Any') return 0
  return table.zone === entry.preference ? 0 : 1
}

// Walk through the queue in order and give every waiting group the table that frees up first.
// Spare seats are penalised (90 s per spare seat) so a party of 2 does not grab the 8-seater
// unless it is clearly the only sensible choice.
export function simulateQueue(state, now, extraEntry) {
  const settings = state.settings
  const pool = state.tables
    .filter((t) => t.status !== 'blocked')
    .map((t) => ({ table: t, at: tableFreeAt(state, t, now) }))
  const list = extraEntry ? [...sortedWaiting(state), extraEntry] : sortedWaiting(state)
  const out = {}
  for (const e of list) {
    const fits = pool.filter((p) => p.table.capacity >= e.partySize)
    if (!fits.length) {
      out[e.id] = { seatAt: null, tableId: null }
      continue
    }
    const score = (p) => p.at + (p.table.capacity - e.partySize) * 90000 + preferenceMismatch(e, p.table) * 120000
    fits.sort((a, b) => score(a) - score(b))
    const pick = fits[0]
    let seatAt = Math.max(pick.at, now)
    if (e.manualSeatAt) seatAt = Math.max(seatAt, e.manualSeatAt)
    out[e.id] = { seatAt, tableId: pick.table.id, tableFree: pick.table.status === 'available' }
    pick.at = seatAt + (diningMinutes(settings, e.partySize, seatAt) + settings.cleaningMinutes) * MIN
  }
  return out
}

// The rule-based model. An ML model can replace it later: it only needs to return the same shape.
export const ruleBasedWaitModel = {
  name: 'rule-based-v1',
  predict(state, { partySize, preference }, now) {
    const virtual = { id: '__new', partySize, preference, joinedAt: now }
    const sim = simulateQueue(state, now, virtual)
    const me = sim.__new
    const groupsAhead = sortedWaiting(state).length
    if (!me.seatAt) return { possible: false, groupsAhead, waitMin: null, model: this.name }
    const waitMin = Math.max(0, Math.ceil((me.seatAt - now) / MIN))
    // Confidence falls with every group ahead and when the table is not yet free.
    let score = 0.95 - groupsAhead * 0.12 - (me.tableFree ? 0 : 0.1)
    score = Math.max(0.1, score)
    const confidence = score >= 0.7 ? 'high' : score >= 0.4 ? 'medium' : 'low'
    return { possible: true, waitMin, groupsAhead, seatAt: me.seatAt, tableId: me.tableId, confidence, model: this.name }
  },
}

let activeWaitModel = ruleBasedWaitModel
export function setWaitModel(model) {
  activeWaitModel = model
}
export function predictWait(state, input, now) {
  return activeWaitModel.predict(state, input, now)
}

// Prediction for a group that is already in the queue.
export function predictEntry(state, entry, now) {
  if (entry.status === 'called') {
    const seatAt = Math.max(now, (entry.calledAt || now) + state.settings.walkInMinutes * MIN)
    return { seatAt, waitMin: 0, groupsAhead: 0, tableId: entry.tableId }
  }
  if (entry.status !== 'waiting') return null
  const sim = simulateQueue(state, now)
  const mine = sim[entry.id]
  const order = sortedWaiting(state)
  const groupsAhead = order.findIndex((q) => q.id === entry.id)
  if (!mine || !mine.seatAt) return { seatAt: null, waitMin: null, groupsAhead }
  return {
    seatAt: mine.seatAt,
    waitMin: Math.max(0, Math.ceil((mine.seatAt - now) / MIN)),
    groupsAhead,
    tableId: mine.tableId,
  }
}

// ───────────────────────── Fair seating policy ─────────────────────────
// 1. Walk the queue in order (staff priority first, then join time).
// 2. A group that has already been passed over `maxSkips` times is protected: if the free
//    table fits it, it gets the table.
// 3. Otherwise the first group that fits gets it, unless that would waste 3 or more seats and a
//    later group fits within 2 spare seats (best fit).
// 4. Groups that do not fit are never blocked by this rule; they wait for a larger table.

export function suggestEntryForTable(state, table) {
  const waiting = sortedWaiting(state)
  const maxSkips = state.settings.maxSkips
  const eligible = waiting.filter((e) => e.partySize <= table.capacity)
  if (!eligible.length) return null
  const protectedEntry = eligible.find((e) => (e.skipCount || 0) >= maxSkips)
  if (protectedEntry) {
    return { entry: protectedEntry, reason: `Skipped ${protectedEntry.skipCount} times already – protected by the fairness rule.` }
  }
  const first = eligible[0]
  const waste = (e) => table.capacity - e.partySize
  if (waste(first) <= 2) return { entry: first, reason: 'First group in the queue that fits this table.' }
  const better = eligible.find((e) => waste(e) <= 2)
  if (better) {
    return { entry: better, skipped: first, reason: `Best fit: ${first.id} (party of ${first.partySize}) would leave ${waste(first)} seats empty.` }
  }
  return { entry: first, reason: 'First group that fits (no closer fit is waiting).' }
}

// ───────────────────────── Kitchen plan ─────────────────────────

// Time one order line occupies a chef. More portions take longer, harder dishes scale worse.
export function itemDuration(menuItem, qty = 1) {
  const batch = 1 + (qty - 1) * 0.1 * (menuItem.complexity || 2)
  return Math.max(1, Math.ceil(menuItem.prepMin * batch))
}

export function findSlot(lanes, earliest, durMs) {
  let best = null
  lanes.forEach((lane, index) => {
    let start = earliest
    let moved = true
    while (moved) {
      moved = false
      for (const [a, b] of lane) {
        if (start < b && start + durMs > a) {
          start = b
          moved = true
        }
      }
    }
    if (!best || start < best.start) best = { start, lane: index }
  })
  return best
}

// Latest start that is ≤ latestStart and ≥ notBefore, searching backwards in 30 second steps.
export function findLatestSlot(lanes, latestStart, durMs, notBefore) {
  for (let s = latestStart; s >= notBefore; s -= 30000) {
    for (let i = 0; i < lanes.length; i++) {
      if (!lanes[i].some(([a, b]) => s < b && s + durMs > a)) return { start: s, lane: i }
    }
  }
  return null
}

export function cloneLanes(lanes) {
  const copy = {}
  for (const id of Object.keys(lanes)) copy[id] = lanes[id].map((lane) => lane.map((iv) => [...iv]))
  return copy
}

const ACTIVE = ['scheduled', 'received', 'preparing']

// Builds one timeline ("lane") per chef per station.
// Order of placement: dishes already cooking → scheduled pre-order dishes (fixed times) →
// received dishes (first come, first served, flowing around the fixed ones).
export function computeKitchenPlan(state, now, ignoreTaskIds = []) {
  const lanes = {}
  for (const st of state.stations) lanes[st.id] = Array.from({ length: Math.max(1, st.chefs) }, () => [])
  const plans = {}
  const tasks = state.tasks.filter((t) => ACTIVE.includes(t.status) && !ignoreTaskIds.includes(t.id))

  const putFixed = (task, start, end) => {
    const stationLanes = lanes[task.station]
    if (!stationLanes) return
    const lane = stationLanes.find((l) => !l.some(([a, b]) => start < b && end > a)) || stationLanes[0]
    lane.push([start, end])
    plans[task.id] = { start, end }
  }

  tasks
    .filter((t) => t.status === 'preparing')
    .sort((a, b) => a.startedAt - b.startedAt)
    .forEach((t) => {
      const end = Math.max(t.startedAt + t.durationMin * MIN, now + MIN)
      putFixed(t, t.startedAt, end)
    })

  tasks
    .filter((t) => t.status === 'scheduled')
    .sort((a, b) => a.scheduledStart - b.scheduledStart)
    .forEach((t) => putFixed(t, t.scheduledStart, t.scheduledStart + t.durationMin * MIN))

  tasks
    .filter((t) => t.status === 'received')
    .sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || a.createdAt - b.createdAt)
    .forEach((t) => {
      const stationLanes = lanes[t.station]
      if (!stationLanes) return
      const dur = t.durationMin * MIN
      const slot = findSlot(stationLanes, now, dur)
      stationLanes[slot.lane].push([slot.start, slot.start + dur])
      plans[t.id] = { start: slot.start, end: slot.start + dur }
    })

  return { lanes, plans }
}

// Estimate for ONE dish if ordered right now (display on every menu card).
export function estimateDish(plan, item, qty, now) {
  const dur = itemDuration(item, qty) * MIN
  const stationLanes = plan.lanes[item.station]
  if (!stationLanes) return null
  const slot = findSlot(stationLanes, now, dur)
  return {
    prepMin: itemDuration(item, qty),
    backlogMin: Math.max(0, Math.ceil((slot.start - now) / MIN)),
    startAt: slot.start,
    readyAt: slot.start + dur,
    totalMin: Math.ceil((slot.start + dur - now) / MIN),
  }
}

// Estimate for the WHOLE cart. Dishes on different stations cook in parallel, dishes on the same
// station share its chefs, so this is never just the sum of the preparation times.
export function estimateOrder(plan, lines, now) {
  const lanes = cloneLanes(plan.lanes)
  const sorted = [...lines].sort((a, b) => itemDuration(b.item, b.qty) - itemDuration(a.item, a.qty))
  const perLine = {}
  let readyAt = now
  let naiveSum = 0
  for (const { item, qty } of sorted) {
    const durMin = itemDuration(item, qty)
    const dur = durMin * MIN
    naiveSum += durMin
    const stationLanes = lanes[item.station]
    if (!stationLanes) continue
    const slot = findSlot(stationLanes, now, dur)
    stationLanes[slot.lane].push([slot.start, slot.start + dur])
    perLine[item.id] = { startAt: slot.start, readyAt: slot.start + dur, prepMin: durMin }
    readyAt = Math.max(readyAt, slot.start + dur)
  }
  return {
    perLine,
    readyAt,
    totalMin: lines.length ? Math.ceil((readyAt - now) / MIN) : 0,
    naiveSumMin: naiveSum,
  }
}

export function stationLoad(state, now) {
  const plan = computeKitchenPlan(state, now)
  return state.stations.map((st) => {
    const tasks = state.tasks.filter((t) => t.station === st.id && ACTIVE.includes(t.status))
    const end = Math.max(now, ...plan.lanes[st.id].flat().map(([, b]) => b))
    const busyChefs = plan.lanes[st.id].filter((lane) => lane.some(([a, b]) => a <= now && b > now)).length
    return {
      station: st,
      activeTasks: tasks.length,
      busyChefs,
      clearsInMin: Math.max(0, Math.ceil((end - now) / MIN)),
      utilisation: Math.min(1, busyChefs / Math.max(1, st.chefs)),
    }
  })
}

// ───────────────────────── Pre-order scheduler ─────────────────────────
// Goal: every dish is READY when the guests sit down (plus a configurable offset).
// For each dish (longest first) the latest feasible start = seating time − preparation time.
// If the station is busy at that moment the dish moves earlier (never more than maxEarlyMinutes).
// If that is impossible it starts as soon as a chef is free and is flagged as delayed.

export function schedulePreorderTasks(state, orderId, seatAt, now) {
  const { settings } = state
  const tasks = state.tasks.filter((t) => t.orderId === orderId && t.status === 'scheduled' && !t.override)
  if (!tasks.length) return
  const plan = computeKitchenPlan(state, now, tasks.map((t) => t.id))
  const target = seatAt + settings.readyOffsetMinutes * MIN
  const maxEarly = settings.maxEarlyMinutes * MIN
  tasks.sort((a, b) => b.durationMin - a.durationMin)
  for (const t of tasks) {
    const dur = t.durationMin * MIN
    const stationLanes = plan.lanes[t.station]
    if (!stationLanes) continue
    const ideal = target - dur
    let slot = null
    if (ideal >= now) {
      slot = findLatestSlot(stationLanes, ideal, dur, Math.max(now, ideal - maxEarly))
    }
    if (!slot) slot = findSlot(stationLanes, Math.max(now, ideal), dur) // late: first free chef
    stationLanes[slot.lane].push([slot.start, slot.start + dur])
    t.scheduledStart = slot.start
    t.estReady = slot.start + dur
    t.delayMin = Math.max(0, Math.ceil((t.estReady - target) / MIN))
  }
}

// Expected seating time of a pre-order customer right now.
export function expectedSeatAtForEntry(state, entry, now) {
  if (!entry) return now + 45 * MIN
  if (entry.status === 'seated') return now
  if (entry.status === 'called') return Math.max(now, (entry.calledAt || now) + state.settings.walkInMinutes * MIN)
  const p = predictEntry(state, entry, now)
  return p?.seatAt || now + 60 * MIN
}
