// Back-office actions for managers: ingredients and stock, menu categories, floor plan, the prep-time
// model and the loyalty programme. They follow the same (state, args, now) shape as the rest of actions.js.

import { cleanText } from './util.js'
import { ingredientById, logStock, refreshPortions } from './inventory.js'
import { trainPrepModel } from './ml.js'
import { setPrepModel } from './engines.js'
import { DEFAULT_LOYALTY, account, addPoints } from './loyalty.js'

const UNITS = ['kg', 'L', 'pcs']
const SHAPES = ['round', 'square', 'rect']
const ITEM_KINDS = ['entrance', 'kitchen', 'bar', 'washroom', 'wall', 'label']

const num = (v, name, { min = 0, max = 1e9 } = {}) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number between ${min} and ${max}`)
  return n
}

// ───────── inventory ─────────

function upsertIngredient(state, { ingredient }, now) {
  const name = cleanText(ingredient.name, 50)
  if (!name) throw new Error('Ingredient name is required')
  if (!UNITS.includes(ingredient.unit)) throw new Error('Choose a unit: kg, L or pcs')
  const clean = {
    name,
    unit: ingredient.unit,
    reorderLevel: num(ingredient.reorderLevel, 'Reorder level', { max: 100000 }),
    costPerUnit: num(ingredient.costPerUnit, 'Cost per unit', { max: 100000 }),
    supplier: cleanText(ingredient.supplier, 50),
  }
  const existing = ingredient.id && ingredientById(state, ingredient.id)
  if (existing) {
    Object.assign(existing, clean) // stock is changed only through receive / adjust so every movement is logged
  } else {
    const id = 'I' + String(++state.counters.ingredient).padStart(3, '0')
    const stock = num(ingredient.stock ?? 0, 'Opening stock', { max: 100000 })
    state.ingredients.push({ id, ...clean, stock })
    if (stock) logStock(state, { ingredientId: id, change: stock, reason: 'opening', balance: stock }, now)
  }
  refreshPortions(state)
  return {}
}

function deleteIngredient(state, { id }, now) {
  const used = state.menu.filter((m) => (m.recipe || []).some((r) => r.ingredientId === id))
  if (used.length) throw new Error(`Used in the recipe of ${used.map((m) => m.name).slice(0, 3).join(', ')}${used.length > 3 ? '…' : ''}. Remove it from those recipes first.`)
  state.ingredients = state.ingredients.filter((i) => i.id !== id)
  return {}
}

// Goods delivered by a supplier.
function receiveStock(state, { ingredientId, qty, costPerUnit, supplier, note }, now) {
  const ing = ingredientById(state, ingredientId)
  if (!ing) throw new Error('Ingredient not found')
  const amount = num(qty, 'Quantity', { min: 0.001, max: 100000 })
  ing.stock = Math.round((ing.stock + amount) * 1000) / 1000
  if (costPerUnit !== '' && costPerUnit != null) ing.costPerUnit = num(costPerUnit, 'Cost per unit', { max: 100000 })
  if (supplier) ing.supplier = cleanText(supplier, 50)
  logStock(state, { ingredientId: ing.id, change: amount, reason: 'purchase', note: cleanText(note, 80), balance: ing.stock }, now)
  refreshPortions(state)
  return {}
}

// Waste, spillage, expiry, or a corrected count.
function adjustStock(state, { ingredientId, delta, reason, note }, now) {
  const ing = ingredientById(state, ingredientId)
  if (!ing) throw new Error('Ingredient not found')
  if (!['waste', 'expired', 'correction'].includes(reason)) throw new Error('Choose a reason')
  const change = num(delta, 'Change', { min: -100000, max: 100000 })
  if (!change) throw new Error('Enter a quantity')
  if (ing.stock + change < 0) throw new Error(`Only ${ing.stock} ${ing.unit} in stock`)
  ing.stock = Math.round((ing.stock + change) * 1000) / 1000
  logStock(state, { ingredientId: ing.id, change, reason, note: cleanText(note, 80), balance: ing.stock }, now)
  refreshPortions(state)
  return {}
}

// A physical stock count: the difference to the system figure is the "variance".
function setStockCount(state, { ingredientId, counted }, now) {
  const ing = ingredientById(state, ingredientId)
  if (!ing) throw new Error('Ingredient not found')
  const target = num(counted, 'Counted quantity', { max: 100000 })
  const change = Math.round((target - ing.stock) * 1000) / 1000
  ing.stock = target
  if (change) logStock(state, { ingredientId: ing.id, change, reason: 'count', note: 'Stock count', balance: ing.stock }, now)
  refreshPortions(state)
  return { variance: change }
}

// ───────── menu categories ─────────

function upsertCategory(state, { id, name }, now) {
  const clean = cleanText(name, 40)
  if (!clean) throw new Error('Category name is required')
  if (state.categories.some((c) => c.name.toLowerCase() === clean.toLowerCase() && c.id !== id)) throw new Error('A category with this name exists')
  const existing = id && state.categories.find((c) => c.id === id)
  if (existing) existing.name = clean
  else state.categories.push({ id: 'C' + (++state.counters.category), name: clean, sort: state.categories.length })
  return {}
}

function deleteCategory(state, { id }, now) {
  if (state.menu.some((m) => m.categoryId === id)) throw new Error('Move or delete the dishes in this category first')
  state.categories = state.categories.filter((c) => c.id !== id)
  return {}
}

// ───────── floor plan ─────────

// The whole layout is saved in one step so a half-edited plan never reaches the floor.
function saveFloorPlan(state, { tables, items = [], zones }, now) {
  if (!Array.isArray(tables) || !tables.length) throw new Error('A floor plan needs at least one table')
  const layout = state.layout
  const zoneList = (zones || layout.zones).map((z) => ({ name: cleanText(z.name, 20), color: /^#[0-9a-f]{6}$/i.test(z.color) ? z.color : '#94a3b8' })).filter((z) => z.name)
  if (!zoneList.length) throw new Error('Add at least one zone')
  const seen = new Set()
  const next = tables.map((t) => {
    const id = cleanText(t.id, 6).toUpperCase()
    if (!/^T\d{2,3}$/.test(id)) throw new Error(`Table id "${t.id}" must look like T11`)
    if (seen.has(id)) throw new Error(`Table ${id} appears twice`)
    seen.add(id)
    const capacity = Number(t.capacity)
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) throw new Error(`Table ${id}: capacity must be 1–20`)
    if (!zoneList.some((z) => z.name === t.zone)) throw new Error(`Table ${id}: choose a zone`)
    const shape = SHAPES.includes(t.shape) ? t.shape : 'square'
    const w = num(t.w, `Table ${id} width`, { min: 30, max: 220 })
    const h = num(t.h, `Table ${id} height`, { min: 30, max: 220 })
    const x = num(t.x, `Table ${id} position`, { min: 0, max: layout.width - w })
    const y = num(t.y, `Table ${id} position`, { min: 0, max: layout.height - h })
    const old = state.tables.find((o) => o.id === id)
    return old
      ? { ...old, capacity, zone: t.zone, shape, x, y, w, h }
      : { id, capacity, zone: t.zone, shape, x, y, w, h, status: 'available', sessionId: null, heldFor: null }
  })
  // A table that guests are sitting at (or are called to) cannot disappear from under them.
  for (const old of state.tables) {
    if (!seen.has(old.id) && !['available', 'blocked'].includes(old.status)) throw new Error(`Table ${old.id} is in use and cannot be removed now`)
  }
  const cleanItems = items.map((it, i) => ({
    id: it.id || 'L' + (i + 1),
    kind: ITEM_KINDS.includes(it.kind) ? it.kind : 'label',
    label: cleanText(it.label, 24),
    x: num(it.x, 'Item position', { min: 0, max: layout.width - 20 }),
    y: num(it.y, 'Item position', { min: 0, max: layout.height - 20 }),
    w: num(it.w, 'Item width', { min: 20, max: layout.width }),
    h: num(it.h, 'Item height', { min: 20, max: layout.height }),
  }))
  state.tables = next
  state.layout = { ...layout, zones: zoneList, items: cleanItems }
  return {}
}

// ───────── prep-time model ─────────

function retrainPrepModel(state, args, now) {
  const model = trainPrepModel(state, now)
  if (!model) throw new Error('Not enough finished dishes yet (at least 40 are needed)')
  state.ml = model
  setPrepModel(state.settings.useAiTimings === false ? null : model)
  return { metrics: model.metrics }
}

function setPrepModelEnabled(state, { enabled }, now) {
  state.settings.useAiTimings = !!enabled
  setPrepModel(enabled ? state.ml || null : null)
  return {}
}

// ───────── loyalty ─────────

function adjustPoints(state, { customerId, points, note }, now) {
  const customer = state.customers.find((c) => c.id === customerId)
  if (!customer) throw new Error('Customer not found')
  const n = num(points, 'Points', { min: -100000, max: 100000 })
  if (!Number.isInteger(n) || !n) throw new Error('Enter a whole number of points')
  if (account(customer).points + n < 0) throw new Error('That would make the balance negative')
  addPoints(state, customer, n, 'adjust', now, { note: cleanText(note, 80) || 'Manager adjustment' })
  return {}
}

function saveLoyaltyConfig(state, { config }, now) {
  const c = config || {}
  const tiers = (c.tiers || []).map((t) => ({ name: cleanText(t.name, 20), minPoints: num(t.minPoints, 'Tier threshold', { max: 1e6 }), multiplier: num(t.multiplier, 'Multiplier', { min: 1, max: 5 }) }))
  if (!tiers.length || tiers.some((t) => !t.name)) throw new Error('Every tier needs a name')
  if (!tiers.some((t) => t.minPoints === 0)) throw new Error('The lowest tier must start at 0 points')
  const rewards = (c.rewards || []).map((r, i) => ({ id: r.id || 'R' + (i + 1) + '-' + Math.random().toString(36).slice(2, 5), name: cleanText(r.name, 40), points: num(r.points, 'Reward points', { min: 1, max: 1e6 }), value: num(r.value, 'Reward value', { min: 1, max: 100000 }) }))
  if (rewards.some((r) => !r.name)) throw new Error('Every reward needs a name')
  state.settings.loyalty = {
    ...DEFAULT_LOYALTY,
    enabled: !!c.enabled,
    earnPerRupee: num(c.earnPerRupee, 'Points per rupee', { min: 0, max: 5 }),
    welcomeBonus: num(c.welcomeBonus, 'Welcome bonus', { max: 100000 }),
    tiers,
    rewards,
  }
  return {}
}

export const ADMIN_ACTIONS_IMPL = {
  upsertIngredient,
  deleteIngredient,
  receiveStock,
  adjustStock,
  setStockCount,
  upsertCategory,
  deleteCategory,
  saveFloorPlan,
  retrainPrepModel,
  setPrepModelEnabled,
  adjustPoints,
  saveLoyaltyConfig,
}
