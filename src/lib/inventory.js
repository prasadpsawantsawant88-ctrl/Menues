// Inventory: raw materials, dish recipes, stock movements.
// A dish's recipe says how much of each ingredient ONE portion uses. Paid orders use stock up, so a dish
// sells out when any of its ingredients runs short, and the menu, kitchen and admin all see it at once.

import { MIN } from './util.js'

const LOG_LIMIT = 400

export function ingredientById(state, id) {
  return state.ingredients.find((i) => i.id === id)
}

export function ingredientStatus(ing) {
  if (ing.stock <= 0) return 'out'
  if (ing.stock <= ing.reorderLevel) return 'low'
  return 'ok'
}

// Cost of one portion from the current ingredient prices.
export function recipeCost(state, recipe = []) {
  return recipe.reduce((s, r) => s + (ingredientById(state, r.ingredientId)?.costPerUnit || 0) * r.qty, 0)
}

// Portions that can still be made from stock. null = no recipe, so stock is not tracked for this dish.
export function portionsFor(state, menuItem, reserved = {}) {
  const recipe = menuItem.recipe || []
  if (!recipe.length) return null
  let min = Infinity
  for (const r of recipe) {
    const ing = ingredientById(state, r.ingredientId)
    if (!ing) return 0
    const left = ing.stock - (reserved[r.ingredientId] || 0)
    min = Math.min(min, Math.floor(left / r.qty + 1e-9))
  }
  return Math.max(0, min)
}

// Stored on each menu item so every screen (including the public menu) can show "sold out" / "only 3 left"
// without ever receiving the ingredient list.
export function refreshPortions(state) {
  for (const m of state.menu) m.portionsLeft = portionsFor(state, m)
}

export function isOrderable(menuItem) {
  return menuItem.available !== false && (menuItem.portionsLeft == null || menuItem.portionsLeft > 0)
}

// Total ingredients needed for a list of { menu, qty } lines.
export function needsFor(lines) {
  const need = {}
  for (const { menu, qty } of lines) for (const r of menu.recipe || []) need[r.ingredientId] = (need[r.ingredientId] || 0) + r.qty * qty
  return need
}

// Throws if the whole cart cannot be cooked from stock (the same ingredient may be shared by several dishes).
export function assertInStock(state, lines) {
  const need = needsFor(lines)
  for (const { menu } of lines) {
    for (const r of menu.recipe || []) {
      const ing = ingredientById(state, r.ingredientId)
      if (!ing || ing.stock + 1e-9 < need[r.ingredientId]) throw new Error(`${menu.name} is sold out right now (not enough ${ing?.name?.toLowerCase() || 'stock'}).`)
    }
  }
}

export function logStock(state, entry, now) {
  state.stockLog.unshift({ id: 'SL' + String(++state.counters.stockLog).padStart(5, '0'), at: now, ...entry })
  if (state.stockLog.length > LOG_LIMIT) state.stockLog.length = LOG_LIMIT
}

// sign = -1 uses stock (paid order), +1 puts it back (cancelled before cooking).
export function applyOrderItems(state, orderItems, sign, now, orderId, reason) {
  for (const item of orderItems) {
    const menu = state.menu.find((m) => m.id === item.menuItemId)
    for (const r of menu?.recipe || []) {
      const ing = ingredientById(state, r.ingredientId)
      if (!ing) continue
      const change = sign * r.qty * item.qty
      ing.stock = Math.round((ing.stock + change) * 1000) / 1000
      logStock(state, { ingredientId: ing.id, change: Math.round(change * 1000) / 1000, reason, orderId, balance: ing.stock }, now)
    }
  }
  refreshPortions(state)
}

// Average daily use of each ingredient over the recorded history (orders × recipes). Used for "days left".
export function dailyUsage(state, now) {
  const menuById = new Map(state.menu.map((m) => [m.id, m]))
  const orderById = new Map(state.orders.map((o) => [o.id, o]))
  const use = {}
  let first = now
  for (const item of state.orderItems) {
    if (item.status === 'cancelled') continue
    const order = orderById.get(item.orderId)
    if (!order || order.paymentStatus === 'pending') continue
    first = Math.min(first, order.createdAt)
    for (const r of menuById.get(item.menuItemId)?.recipe || []) use[r.ingredientId] = (use[r.ingredientId] || 0) + r.qty * item.qty
  }
  const days = Math.max(1, (now - first) / (24 * 60 * MIN))
  return Object.fromEntries(Object.entries(use).map(([id, total]) => [id, total / days]))
}
