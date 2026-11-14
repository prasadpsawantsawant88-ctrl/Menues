// Prep-time model: learns how long each dish really takes from past orders.
//
// Method: ridge regression (a linear model with a small penalty), solved exactly in plain JavaScript.
// It runs in the browser and on the server, needs no libraries and trains in a few milliseconds.
//
// What it learns for every completed dish (actualPrepMin, measured from "Start" to "Ready"):
//   • a base time per dish and per station (so a new dish with no history still gets a sensible guess)
//   • extra time per additional portion, larger for complex dishes
//   • extra time in peak hours and at weekends
// The prediction is cooking time only. Waiting for a free chef is handled separately by the kitchen plan.
//
// The history that ships with the demo is synthetic (generated), so the accuracy numbers shown in Admin
// describe the method on demo data. With real orders the same code learns the real kitchen.

import { MIN } from './util.js'

const RIDGE = 0.6
const MIN_SAMPLES = 40
const MIN_PER_DISH = 3

// ───────── samples ─────────

function isPeak(hour, peakHours) {
  return (peakHours || []).some(([a, b]) => hour >= a && hour < b)
}

// One row per finished dish: what was cooked, when, and how long it took.
export function prepSamples(state) {
  const orderById = new Map(state.orders.map((o) => [o.id, o]))
  const menuById = new Map(state.menu.map((m) => [m.id, m]))
  const rows = []
  for (const item of state.orderItems) {
    if (item.actualPrepMin == null || item.status === 'cancelled') continue
    const menu = menuById.get(item.menuItemId)
    if (!menu) continue
    const order = orderById.get(item.orderId)
    const startedAt = item.startedAt || (item.readyAt ? item.readyAt - item.actualPrepMin * MIN : order?.createdAt)
    if (!startedAt) continue
    rows.push({ menuId: menu.id, station: menu.station, complexity: menu.complexity || 2, qty: item.qty, startedAt, minutes: item.actualPrepMin })
  }
  return rows.sort((a, b) => a.startedAt - b.startedAt)
}

// ───────── features ─────────

function context(at) {
  const d = new Date(at)
  return { hour: d.getHours(), weekend: [0, 5, 6].includes(d.getDay()) ? 1 : 0 }
}

function featureVector(spec, { menuId, station, complexity, qty }, at) {
  const { hour, weekend } = context(at)
  const peak = isPeak(hour, spec.peakHours) ? 1 : 0
  const extra = Math.max(0, qty - 1)
  const v = new Array(spec.width).fill(0)
  v[0] = 1 // intercept
  v[1] = extra
  v[2] = extra * complexity
  v[3] = peak
  v[4] = weekend
  v[5] = peak * complexity
  const stationAt = spec.stations.indexOf(station)
  if (stationAt >= 0) v[6 + stationAt] = 1
  const dishAt = spec.dishIds.indexOf(menuId)
  if (dishAt >= 0) v[6 + spec.stations.length + dishAt] = 1
  return v
}

// ───────── solver ─────────

// Solves A x = b for a small dense symmetric matrix (Gaussian elimination with partial pivoting).
function solve(A, b) {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    ;[M[c], M[p]] = [M[p], M[c]]
    const pivot = M[c][c] || 1e-9
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / pivot
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n]
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]
    x[r] = s / (M[r][r] || 1e-9)
  }
  return x
}

function fit(spec, rows) {
  const n = spec.width
  const XtX = Array.from({ length: n }, () => new Array(n).fill(0))
  const Xty = new Array(n).fill(0)
  for (const r of rows) {
    const v = featureVector(spec, r, r.startedAt)
    for (let i = 0; i < n; i++) {
      if (!v[i]) continue
      Xty[i] += v[i] * r.minutes
      for (let j = 0; j < n; j++) if (v[j]) XtX[i][j] += v[i] * v[j]
    }
  }
  for (let i = 1; i < n; i++) XtX[i][i] += RIDGE // the intercept is not penalised
  return solve(XtX, Xty)
}

const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

// ───────── training ─────────

export function trainPrepModel(state, now = Date.now()) {
  const rows = prepSamples(state)
  if (rows.length < MIN_SAMPLES) return null

  const counts = {}
  rows.forEach((r) => (counts[r.menuId] = (counts[r.menuId] || 0) + 1))
  const spec = {
    peakHours: state.settings.peakHours,
    stations: state.stations.map((s) => s.id),
    dishIds: state.menu.filter((m) => (counts[m.id] || 0) >= MIN_PER_DISH).map((m) => m.id),
  }
  spec.width = 6 + spec.stations.length + spec.dishIds.length

  // Honest accuracy: fit on the oldest 80 %, test on the newest 20 %, then refit on everything for use.
  const cut = Math.floor(rows.length * 0.8)
  const testRows = rows.slice(cut)
  const wTrain = fit(spec, rows.slice(0, cut))
  const menuById = new Map(state.menu.map((m) => [m.id, m]))
  const ruleMinutes = (r) => {
    const m = menuById.get(r.menuId)
    return m.prepMin * (1 + (r.qty - 1) * 0.1 * (m.complexity || 2))
  }
  const mean = testRows.reduce((s, r) => s + r.minutes, 0) / testRows.length
  const score = (predict) => {
    let abs = 0, sq = 0, tot = 0
    for (const r of testRows) {
      const e = predict(r) - r.minutes
      abs += Math.abs(e)
      sq += e * e
      tot += (r.minutes - mean) ** 2
    }
    return { mae: abs / testRows.length, rmse: Math.sqrt(sq / testRows.length), r2: tot ? 1 - sq / tot : 0 }
  }
  const ml = score((r) => dot(wTrain, featureVector(spec, r, r.startedAt)))
  const rule = score(ruleMinutes)

  const w = fit(spec, rows)
  const model = {
    version: 1,
    kind: 'ridge-regression',
    trainedAt: now,
    samples: rows.length,
    testSamples: testRows.length,
    spec,
    w,
    metrics: {
      maeMl: round(ml.mae), maeRule: round(rule.mae),
      rmseMl: round(ml.rmse), rmseRule: round(rule.rmse),
      r2Ml: round(ml.r2, 3), r2Rule: round(rule.r2, 3),
      improvementPct: rule.mae ? Math.round((1 - ml.mae / rule.mae) * 100) : 0,
    },
    effects: {
      peakMin: round(w[3] + w[5] * 2),
      weekendMin: round(w[4]),
      perExtraPortionMin: round(w[1] + w[2] * 2),
    },
  }
  model.perDish = state.menu
    .filter((m) => spec.dishIds.includes(m.id))
    .map((m) => ({ id: m.id, name: m.name, station: m.station, standard: m.prepMin, learned: round(predictPrep(model, m, 1, new Date(2026, 0, 6, 16).getTime()) ?? m.prepMin), samples: counts[m.id] }))
  return model
}

function round(x, d = 1) {
  const f = 10 ** d
  return Math.round(x * f) / f
}

// Predicted cooking minutes, or null when there is no model. Clamped so a odd input can never produce
// an absurd time (between half and three times the dish's standard time).
export function predictPrep(model, menuItem, qty = 1, at = Date.now()) {
  if (!model || !model.w) return null
  const v = featureVector(model.spec, { menuId: menuItem.id, station: menuItem.station, complexity: menuItem.complexity || 2, qty }, at)
  const raw = dot(model.w, v)
  const base = menuItem.prepMin * (1 + (qty - 1) * 0.1 * (menuItem.complexity || 2))
  return Math.min(base * 3, Math.max(base * 0.5, raw))
}

// How many finished dishes exist that the current model has not seen yet.
export function newSamplesSince(state, model) {
  const total = state.orderItems.reduce((n, i) => n + (i.actualPrepMin != null && i.status !== 'cancelled' ? 1 : 0), 0)
  return model ? total - model.samples : total
}
