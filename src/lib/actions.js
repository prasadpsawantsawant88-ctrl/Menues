// DineFlow actions — every state change in the app goes through one of these functions.
// Each takes (state, args, now), mutates the state it is given and returns a result.
// They throw Error(message) for invalid input; the store turns that into { ok: false, error }.

import { MIN, normalizePhone, isValidPhone, cleanText, pad, newSessionToken } from './util.js'
import {
  sortedWaiting,
  suggestEntryForTable,
  itemDuration,
  schedulePreorderTasks,
  expectedSeatAtForEntry,
  computeKitchenPlan,
  findSlot,
  diningMinutes,
  predictWait,
} from './engines.js'

const ACTIVE_ENTRY = ['waiting', 'called']

// ───────────────────────── helpers ─────────────────────────

function nextId(state, key, prefix, width = 4) {
  state.counters[key] = (state.counters[key] || 0) + 1
  return prefix + pad(state.counters[key], width)
}

// In-app update shown on the customer's own page (and in the staff "customer updates" log).
// There is no SMS in DineFlow: nothing here ever leaves the app.
export function notify(state, { kind, body, entryId, orderId }, now) {
  state.notifications.unshift({
    id: nextId(state, 'notification', 'N', 5),
    kind,
    body,
    entryId: entryId || null,
    orderId: orderId || null,
    createdAt: now,
  })
  state.notifications.length = Math.min(state.notifications.length, 200)
}

function findEntry(state, id) {
  const e = state.queue.find((q) => q.id === id)
  if (!e) throw new Error('Queue entry not found')
  return e
}
function findTable(state, id) {
  const t = state.tables.find((x) => x.id === id)
  if (!t) throw new Error('Table not found')
  return t
}
function findOrder(state, id) {
  const o = state.orders.find((x) => x.id === id)
  if (!o) throw new Error('Order not found')
  return o
}
function findTask(state, id) {
  const t = state.tasks.find((x) => x.id === id)
  if (!t) throw new Error('Kitchen task not found')
  return t
}

export function maxCapacity(state) {
  return Math.max(...state.tables.filter((t) => t.status !== 'blocked').map((t) => t.capacity))
}

// Order status is derived from its dishes.
export function syncOrderStatus(state, orderId, now) {
  const order = state.orders.find((o) => o.id === orderId)
  if (!order || order.paymentStatus !== 'paid') return
  const tasks = state.tasks.filter((t) => t.orderId === orderId)
  const live = tasks.filter((t) => t.status !== 'cancelled')
  const prev = order.status
  if (!live.length) order.status = 'cancelled'
  else if (live.every((t) => t.status === 'served')) order.status = 'served'
  else if (live.every((t) => ['ready', 'served'].includes(t.status))) order.status = 'ready'
  else if (live.some((t) => ['preparing', 'ready', 'served'].includes(t.status))) order.status = 'preparing'
  else if (live.some((t) => t.status === 'received')) order.status = 'received'
  else order.status = 'scheduled'
  if (order.status === 'ready' && prev !== 'ready' && !order.readyAt) {
    order.readyAt = now
    if (order.queueEntryId) notify(state, { kind: 'order_ready', entryId: order.queueEntryId, body: `Your order ${order.orderNo} is ready!`, orderId: order.id }, now)
  }
  if (order.status === 'served' && !order.servedAt) order.servedAt = now
}

function refundItem(state, order, amountExcludingTax) {
  const amount = Math.round(amountExcludingTax * (1 + state.settings.gstPercent / 100))
  const payment = state.payments.find((p) => p.orderId === order.id && p.status === 'paid')
  if (payment) payment.refundedAmount = (payment.refundedAmount || 0) + amount
  order.refundedAmount = (order.refundedAmount || 0) + amount
  return amount
}

function cancelOrderCompletely(state, order, reason, now) {
  state.tasks.forEach((t) => {
    if (t.orderId === order.id && ['scheduled', 'received', 'preparing'].includes(t.status)) t.status = 'cancelled'
  })
  state.orderItems.forEach((i) => {
    if (i.orderId === order.id && i.status !== 'served') i.status = 'cancelled'
  })
  if (order.paymentStatus === 'paid') {
    const payment = state.payments.find((p) => p.orderId === order.id && p.status === 'paid')
    const unserved = state.orderItems.filter((i) => i.orderId === order.id && i.status === 'cancelled' && !i.refunded)
    const amt = unserved.reduce((s, i) => s + i.unitPrice * i.qty, 0)
    unserved.forEach((i) => (i.refunded = true))
    if (amt > 0) refundItem(state, order, amt)
    if (payment) payment.status = payment.refundedAmount >= order.total ? 'refund_initiated' : payment.status
    order.paymentStatus = order.refundedAmount >= order.total ? 'refund_initiated' : order.paymentStatus
  }
  order.status = 'cancelled'
  order.cancelReason = reason
  order.cancelledAt = now
}

// ───────────────────────── queue ─────────────────────────

export function joinQueue(state, { phone, partySize, name, preference, source = 'self' }, now) {
  if (!isValidPhone(phone)) throw new Error('Enter a valid 10-digit Indian mobile number')
  const party = Number(partySize)
  if (!Number.isInteger(party) || party < 1) throw new Error('Party size must be a whole number of at least 1')
  const cap = maxCapacity(state)
  if (party > cap) throw new Error(`We can seat parties of up to ${cap}. Please speak to the host for larger groups.`)
  const p = normalizePhone(phone)

  // Same phone already in the queue: refuse. (Handing back the existing personal link would let
  // anyone who types a stranger's number take over that person's queue page.)
  const existing = state.queue.find((q) => q.phone === p && ACTIVE_ENTRY.includes(q.status))
  if (existing) throw new Error(`This number is already in the queue as ${existing.id}. Please ask the host if you need your QR code again.`)

  let customer = state.customers.find((c) => c.phone === p)
  if (!customer) {
    customer = { id: nextId(state, 'customer', 'C', 4), phone: p, name: cleanText(name, 40), createdAt: now }
    state.customers.push(customer)
  } else if (name && !customer.name) customer.name = cleanText(name, 40)

  const entry = {
    id: 'Q' + pad(state.counters.queue++, 3),
    customerId: customer.id,
    phone: p,
    name: cleanText(name, 40) || customer.name || '',
    partySize: party,
    preference: ['Any', 'Indoor', 'Outdoor', 'Window'].includes(preference) ? preference : 'Any',
    status: 'waiting',
    source,
    // Personal link secret: long, random, never contains the phone number. Expires.
    sessionToken: newSessionToken(),
    sessionExpiresAt: now + (state.settings.sessionHours || 6) * 60 * MIN,
    joinedAt: now,
    skipCount: 0,
    priority: 0,
    tableId: null,
    preorderOrderId: null,
  }
  // Remember what we promised at join time (used for the progress bar and for prediction accuracy).
  const promise = predictWait(state, { partySize: party, preference: entry.preference }, now)
  entry.predictedWaitMin = promise.waitMin ?? 0
  entry.initialAhead = promise.groupsAhead
  state.queue.push(entry)

  // Is there a free table that fairly belongs to this group? Then seat them straight away.
  const free = state.tables
    .filter((t) => t.status === 'available' && t.capacity >= party)
    .sort((a, b) => a.capacity - b.capacity)
  for (const table of free) {
    const suggestion = suggestEntryForTable(state, table)
    if (suggestion && suggestion.entry.id === entry.id) {
      allocateTable(state, { entryId: entry.id, tableId: table.id }, now)
      return { entry, table, seatedImmediately: true }
    }
  }

  notify(state, { kind: 'queue_joined', entryId: entry.id, body: `You are in the queue as ${entry.id}. This page updates by itself when your table is ready.` }, now)
  return { entry }
}

export function cancelEntry(state, { entryId, by = 'staff', reason = '' }, now) {
  const entry = findEntry(state, entryId)
  if (!ACTIVE_ENTRY.includes(entry.status)) throw new Error('This queue entry is no longer active')
  entry.status = by === 'customer' ? 'abandoned' : by === 'system' ? 'no_show' : 'cancelled'
  entry.endedAt = now
  entry.cancelReason = reason
  if (entry.tableId) {
    const table = state.tables.find((t) => t.id === entry.tableId)
    if (table && table.status === 'reserved' && table.heldFor === entry.id) {
      table.status = 'available'
      table.heldFor = null
    }
  }
  // Pre-order: stop the kitchen and mark a (test) refund.
  const order = entry.preorderOrderId && state.orders.find((o) => o.id === entry.preorderOrderId)
  state.orders
    .filter((o) => o.queueEntryId === entry.id && o.status !== 'cancelled' && o.status !== 'served')
    .forEach((o) => cancelOrderCompletely(state, o, `Queue entry ${entry.status}`, now))
  if (order) order.queueCancelled = true
  notify(
    state,
    { kind: 'queue_cancelled', entryId: entry.id, body: `${entry.id} has been cancelled${state.orders.some((o) => o.queueEntryId === entry.id && o.paymentStatus === 'refund_initiated') ? '. A refund for your pre-order has been initiated (test mode).' : '.'}` },
    now,
  )
  return { entry }
}

export function updateEntry(state, { entryId, partySize, bumpPriority, manualSeatAt, clearManualSeat }, now) {
  const entry = findEntry(state, entryId)
  if (!ACTIVE_ENTRY.includes(entry.status)) throw new Error('This queue entry is no longer active')
  if (partySize != null) {
    const n = Number(partySize)
    if (!Number.isInteger(n) || n < 1) throw new Error('Invalid party size')
    if (n > maxCapacity(state)) throw new Error('No table is large enough for that party size')
    if (entry.status === 'called') {
      const table = findTable(state, entry.tableId)
      if (n > table.capacity) throw new Error(`Table ${table.id} seats ${table.capacity}. Release the table first.`)
    }
    entry.partySize = n
  }
  if (bumpPriority) entry.priority = Math.max(0, ...state.queue.map((q) => q.priority || 0)) + 1
  if (manualSeatAt) entry.manualSeatAt = manualSeatAt
  if (clearManualSeat) entry.manualSeatAt = null
  return { entry }
}

export function allocateTable(state, { entryId, tableId }, now) {
  const entry = findEntry(state, entryId)
  const table = findTable(state, tableId)
  if (entry.status !== 'waiting') throw new Error('Only waiting groups can be given a table')
  if (table.status !== 'available') throw new Error(`Table ${table.id} is not available`)
  if (table.capacity < entry.partySize) throw new Error(`Table ${table.id} seats ${table.capacity}, party is ${entry.partySize}`)

  // Everyone who fits this table and was passed over gets one skip (fairness rule).
  sortedWaiting(state)
    .filter((q) => q.id !== entry.id)
    .filter((q) => (q.priority || 0) > (entry.priority || 0) || (q.priority === entry.priority && q.joinedAt < entry.joinedAt))
    .filter((q) => q.partySize <= table.capacity)
    .forEach((q) => (q.skipCount = (q.skipCount || 0) + 1))

  entry.status = 'called'
  entry.calledAt = now
  entry.tableId = table.id
  entry.ackAt = null
  table.status = 'reserved'
  table.heldFor = entry.id

  notify(
    state,
    { kind: 'table_ready', entryId: entry.id, body: `Your table ${table.id} is ready! Please come to the host stand within ${state.settings.graceMinutes} minutes.` },
    now,
  )
  rescheduleEntryOrders(state, entry, now, true)
  return { entry, table }
}

// The customer's phone opens its personal link. Returns which queue entry the secret belongs to.
export function openSession(state, { session }, now) {
  const entry = state.queue.find((q) => q.sessionToken && session && q.sessionToken === session)
  if (!entry) throw new Error('This link is not valid. Please scan the QR code at the entrance again.')
  if (entry.sessionExpiresAt && entry.sessionExpiresAt < now) throw new Error('This link has expired. Please ask the host for a new QR code.')
  if (!entry.sessionOpenedAt) entry.sessionOpenedAt = now // lets the kiosk show "scanned"
  return { entryId: entry.id }
}

// Staff only: replace a lost or leaked personal link with a fresh one.
export function renewSession(state, { entryId }, now) {
  const entry = findEntry(state, entryId)
  entry.sessionToken = newSessionToken()
  entry.sessionExpiresAt = now + (state.settings.sessionHours || 6) * 60 * MIN
  entry.sessionOpenedAt = null
  return { entry }
}

export function ackCall(state, { entryId }, now) {
  const entry = findEntry(state, entryId)
  if (entry.status !== 'called') throw new Error('Your table is not ready yet')
  entry.ackAt = now
  return { entry }
}

export function releaseTable(state, { entryId }, now) {
  // Staff changed their mind: put the group back into the queue (keeps its place).
  const entry = findEntry(state, entryId)
  if (entry.status !== 'called') throw new Error('Nothing to release')
  const table = state.tables.find((t) => t.id === entry.tableId)
  if (table && table.heldFor === entry.id) {
    table.status = 'available'
    table.heldFor = null
  }
  entry.status = 'waiting'
  entry.tableId = null
  entry.calledAt = null
  rescheduleEntryOrders(state, entry, now, true)
  return { entry }
}

export function seatEntry(state, { entryId }, now) {
  const entry = findEntry(state, entryId)
  if (entry.status !== 'called') throw new Error('Allocate a table before seating the group')
  const table = findTable(state, entry.tableId)
  const session = {
    id: nextId(state, 'session', 'S', 4),
    tableId: table.id,
    queueEntryId: entry.id,
    customerId: entry.customerId,
    partySize: entry.partySize,
    seatedAt: now,
    expectedDepartAt: now + diningMinutes(state.settings, entry.partySize, now) * MIN,
    status: 'active',
  }
  state.sessions.push(session)
  table.status = 'occupied'
  table.heldFor = null
  table.sessionId = session.id
  entry.status = 'seated'
  entry.seatedAt = now
  entry.sessionId = session.id
  entry.sessionExpiresAt = Math.max(entry.sessionExpiresAt || 0, now + (state.settings.sessionHours || 6) * 60 * MIN) // keep ordering from the same phone

  // Pre-orders: link them to the table and start cooking everything that is still scheduled.
  state.orders
    .filter((o) => o.queueEntryId === entry.id && !['cancelled', 'served'].includes(o.status))
    .forEach((o) => {
      o.tableId = table.id
      o.sessionId = session.id
      o.clockStartAt = now
      state.tasks
        .filter((t) => t.orderId === o.id && t.status === 'scheduled')
        .forEach((t) => {
          t.status = 'received'
          t.tableId = table.id
          t.createdAt = Math.min(t.createdAt, now)
        })
      state.tasks.filter((t) => t.orderId === o.id).forEach((t) => (t.tableId = table.id))
      syncOrderStatus(state, o.id, now)
    })
  return { session, table }
}

export function seatWalkIn(state, { tableId, partySize }, now) {
  const table = findTable(state, tableId)
  const n = Number(partySize)
  if (table.status !== 'available') throw new Error(`Table ${table.id} is not available`)
  if (!Number.isInteger(n) || n < 1 || n > table.capacity) throw new Error(`Party size must be between 1 and ${table.capacity}`)
  const session = {
    id: nextId(state, 'session', 'S', 4),
    tableId: table.id,
    queueEntryId: null,
    customerId: null,
    partySize: n,
    seatedAt: now,
    expectedDepartAt: now + diningMinutes(state.settings, n, now) * MIN,
    status: 'active',
  }
  state.sessions.push(session)
  table.status = 'occupied'
  table.sessionId = session.id
  return { session, table }
}

export function endSession(state, { tableId }, now) {
  const table = findTable(state, tableId)
  if (table.status !== 'occupied') throw new Error('Table is not occupied')
  const session = state.sessions.find((s) => s.id === table.sessionId)
  if (session) {
    session.status = 'ended'
    session.endedAt = now
  }
  table.status = 'cleaning'
  table.sessionId = null
  table.cleanDoneAt = now + state.settings.cleaningMinutes * MIN
  return { table }
}

export function setTableStatus(state, { tableId, status }, now) {
  const table = findTable(state, tableId)
  if (['occupied', 'reserved'].includes(table.status)) throw new Error('Free the table through the queue / seating flow first')
  if (!['available', 'cleaning', 'blocked'].includes(status)) throw new Error('Invalid table status')
  table.status = status
  table.cleanDoneAt = status === 'cleaning' ? now + state.settings.cleaningMinutes * MIN : null
  return { table }
}

export function notifyEntry(state, { entryId, kind = 'reminder' }, now) {
  const entry = findEntry(state, entryId)
  const body = entry.status === 'called' ? `Reminder: table ${entry.tableId} is waiting for you.` : `${entry.id}, your turn is coming up. Please stay close to the entrance.`
  notify(state, { kind, body, entryId: entry.id }, now)
  entry.lastNotifiedAt = now
  return { entry }
}

export function extendGrace(state, { entryId }, now) {
  const entry = findEntry(state, entryId)
  if (entry.status !== 'called') throw new Error('Not waiting for arrival')
  entry.calledAt = (entry.calledAt || now) + 2 * MIN
  return { entry }
}

// ───────────────────────── orders ─────────────────────────

export function lineUnitPrice(menuItem, options = []) {
  return menuItem.price + options.reduce((s, o) => s + (o.price || 0), 0)
}

export function orderTotals(settings, lines) {
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const tax = Math.round((subtotal * settings.gstPercent) / 100)
  return { subtotal, tax, total: subtotal + tax }
}

export function createOrder(state, { type, entryId, tableId, items, clientRequestId, note }, now) {
  if (clientRequestId) {
    const dup = state.orders.find((o) => o.clientRequestId === clientRequestId)
    if (dup) return { order: dup, duplicate: true } // double tap / retry → same order
  }
  if (!Array.isArray(items) || !items.length) throw new Error('Your cart is empty')
  if (items.length > 30) throw new Error('Too many different dishes in one order')

  let entry = null
  let table = null
  let session = null
  if (type === 'preorder') {
    entry = findEntry(state, entryId)
    if (!['waiting', 'called', 'seated'].includes(entry.status)) throw new Error('This queue entry is no longer active')
  } else if (type === 'qr') {
    table = findTable(state, tableId)
    session = state.sessions.find((s) => s.id === table.sessionId && s.status === 'active')
    if (!session) throw new Error(`Table ${table.id} has no active seating session. Ask the host to seat you first.`)
  } else throw new Error('Unknown order type')

  const lines = items.map((line) => {
    const menu = state.menu.find((m) => m.id === line.menuItemId)
    if (!menu) throw new Error('A dish in your cart no longer exists')
    const qty = Number(line.qty)
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error(`Invalid quantity for ${menu.name}`)
    if (!menu.available || (menu.stock != null && menu.stock < qty)) throw new Error(`${menu.name} is not available right now`)
    const options = (line.options || []).map((o) => ({ group: o.group, label: o.label, price: Number(o.price) || 0 }))
    return {
      menu,
      qty,
      options,
      instructions: cleanText(line.instructions, 140),
      unitPrice: lineUnitPrice(menu, options),
    }
  })
  const totals = orderTotals(state.settings, lines)

  const order = {
    id: nextId(state, 'order', 'O', 4),
    orderNo: '#' + (1000 + state.counters.order),
    clientRequestId: clientRequestId || null,
    type,
    queueEntryId: entry?.id || null,
    tableId: table?.id || entry?.tableId || null,
    sessionId: session?.id || entry?.sessionId || null,
    customerId: entry?.customerId || session?.customerId || null,
    partySize: entry?.partySize || session?.partySize || null,
    note: cleanText(note, 200),
    status: 'pending_payment',
    paymentStatus: 'pending',
    ...totals,
    createdAt: now,
  }
  state.orders.push(order)
  lines.forEach((l) => {
    state.orderItems.push({
      id: nextId(state, 'orderItem', 'OI', 5),
      orderId: order.id,
      menuItemId: l.menu.id,
      name: l.menu.name,
      emoji: l.menu.emoji,
      qty: l.qty,
      unitPrice: l.unitPrice,
      station: l.menu.station,
      options: l.options,
      instructions: l.instructions,
      status: 'pending',
    })
  })
  if (entry && type === 'preorder') entry.preorderOrderId = entry.preorderOrderId || order.id
  return { order }
}

export function payOrder(state, { orderId, mode = 'demo', outcome = 'success', idempotencyKey, providerPaymentId }, now) {
  const order = findOrder(state, orderId)

  // Duplicate callbacks / double clicks must never charge or create tasks twice.
  if (idempotencyKey) {
    const dup = state.payments.find((p) => p.idempotencyKey === idempotencyKey)
    if (dup) return { payment: dup, order, duplicate: true }
  }
  if (order.paymentStatus === 'paid') {
    const paid = state.payments.find((p) => p.orderId === order.id && p.status === 'paid')
    return { payment: paid, order, duplicate: true }
  }

  const payment = {
    id: nextId(state, 'payment', 'P', 5),
    orderId: order.id,
    amount: order.total,
    currency: 'INR',
    mode, // always 'demo' (simulated)
    status: outcome === 'success' ? 'paid' : 'failed',
    idempotencyKey: idempotencyKey || null,
    providerPaymentId: providerPaymentId || null,
    createdAt: now,
  }

  if (outcome !== 'success') {
    payment.failureReason = 'Payment declined (simulated)'
    state.payments.push(payment)
    order.lastPaymentFailure = now
    if (order.queueEntryId) notify(state, { kind: 'payment_failed', entryId: order.queueEntryId, orderId: order.id, body: `Payment for order ${order.orderNo} failed. No money was taken. Please retry.` }, now)
    return { payment, order, failed: true }
  }

  // Re-check everything at payment time: a dish may have sold out in the meantime.
  const items = state.orderItems.filter((i) => i.orderId === order.id)
  for (const item of items) {
    const menu = state.menu.find((m) => m.id === item.menuItemId)
    if (!menu || !menu.available || (menu.stock != null && menu.stock < item.qty)) {
      throw new Error(`${item.name} just became unavailable. Please remove it from your cart.`)
    }
  }
  let entry = null
  if (order.type === 'preorder') {
    entry = findEntry(state, order.queueEntryId)
    if (!['waiting', 'called', 'seated'].includes(entry.status)) throw new Error('Your queue entry is no longer active')
  } else {
    const table = findTable(state, order.tableId)
    if (!table.sessionId) throw new Error('Your table session has ended')
  }

  state.payments.push(payment)
  order.paymentStatus = 'paid'
  order.paymentMode = mode
  order.paidAt = now
  order.status = 'confirmed'

  items.forEach((item) => {
    const menu = state.menu.find((m) => m.id === item.menuItemId)
    if (menu.stock != null) {
      menu.stock -= item.qty
      if (menu.stock <= 0) menu.available = false
    }
    item.status = 'queued'
  })

  // Kitchen tasks: pre-orders are SCHEDULED for later, table orders go straight to the kitchen.
  const immediate = order.type === 'qr' || entry?.status === 'seated'
  items.forEach((item) => {
    const menu = state.menu.find((m) => m.id === item.menuItemId)
    state.tasks.push({
      id: nextId(state, 'task', 'KT', 5),
      orderId: order.id,
      orderItemId: item.id,
      itemName: item.name,
      emoji: item.emoji,
      qty: item.qty,
      station: item.station,
      durationMin: itemDuration(menu, item.qty),
      status: immediate ? 'received' : 'scheduled',
      priority: 'normal',
      override: false,
      instructions: item.instructions,
      options: item.options.map((o) => o.label).join(', '),
      createdAt: now,
      scheduledStart: now,
      delayMin: 0,
      tableId: order.tableId,
      token: order.queueEntryId,
    })
  })

  if (!immediate) {
    order.expectedSeatAt = expectedSeatAtForEntry(state, entry, now)
    schedulePreorderTasks(state, order.id, order.expectedSeatAt, now)
  } else if (order.type === 'preorder') {
    order.clockStartAt = now
  } else {
    order.clockStartAt = now
  }
  syncOrderStatus(state, order.id, now)

  if (order.queueEntryId) {
    notify(state, { kind: 'order_confirmed', entryId: order.queueEntryId, orderId: order.id, body: `Order ${order.orderNo} confirmed (test payment). We will time it so your food is ready when you sit down.` }, now)
  }
  return { payment, order }
}

// Customer removes a dish before the kitchen has started it.
export function cancelOrderItem(state, { orderItemId }, now) {
  const item = state.orderItems.find((i) => i.id === orderItemId)
  if (!item) throw new Error('Item not found')
  const order = findOrder(state, item.orderId)
  const task = state.tasks.find((t) => t.orderItemId === item.id)
  if (order.paymentStatus === 'paid' && task && !['scheduled', 'received'].includes(task.status)) {
    throw new Error('The kitchen has already started this dish')
  }
  if (item.status === 'cancelled') return { order }
  item.status = 'cancelled'
  if (task) task.status = 'cancelled'
  if (order.paymentStatus === 'paid') {
    item.refunded = true
    refundItem(state, order, item.unitPrice * item.qty)
    const menu = state.menu.find((m) => m.id === item.menuItemId)
    if (menu && menu.stock != null) menu.stock += item.qty
  }
  syncOrderStatus(state, order.id, now)
  const stillLive = state.orderItems.some((i) => i.orderId === order.id && i.status !== 'cancelled')
  if (!stillLive) {
    order.status = 'cancelled'
    order.cancelReason = 'All items removed'
  }
  return { order }
}

function rescheduleEntryOrders(state, entry, now, force) {
  state.orders
    .filter((o) => o.queueEntryId === entry.id && o.paymentStatus === 'paid' && !['cancelled', 'served'].includes(o.status))
    .forEach((o) => {
      const seatAt = expectedSeatAtForEntry(state, entry, now)
      if (force || Math.abs(seatAt - (o.expectedSeatAt || 0)) >= MIN) {
        o.expectedSeatAt = seatAt
        schedulePreorderTasks(state, o.id, seatAt, now)
      }
    })
}

// ───────────────────────── kitchen ─────────────────────────

export function setTaskStatus(state, { taskId, status }, now) {
  const task = findTask(state, taskId)
  const order = findOrder(state, task.orderId)
  const flow = { scheduled: ['preparing', 'cancelled'], received: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['served'], served: [], cancelled: [] }
  if (!flow[task.status].includes(status)) throw new Error(`Cannot move a dish from ${task.status} to ${status}`)
  const item = state.orderItems.find((i) => i.id === task.orderItemId)

  if (status === 'preparing') {
    if (task.status === 'scheduled') task.override = true // started early by kitchen staff
    task.startedAt = now
  }
  if (status === 'ready') {
    task.readyAt = now
    if (item) {
      item.actualPrepMin = Math.round(((now - (task.startedAt || now)) / MIN) * 10) / 10
      item.readyAt = now
    }
  }
  if (status === 'served') {
    task.servedAt = now
    if (item) item.servedAt = now
    if (!order.firstServedAt) order.firstServedAt = now
  }
  if (status === 'cancelled' && item) {
    item.status = 'cancelled'
    if (order.paymentStatus === 'paid' && !item.refunded) {
      item.refunded = true
      refundItem(state, order, item.unitPrice * item.qty)
    }
  }
  task.status = status
  if (item && status !== 'cancelled') item.status = status
  syncOrderStatus(state, order.id, now)
  return { task }
}

export function delayTask(state, { taskId, minutes = 5 }, now) {
  const task = findTask(state, taskId)
  const m = Math.max(1, Math.min(30, Number(minutes) || 5))
  if (task.status === 'scheduled') {
    task.scheduledStart += m * MIN
    task.estReady = (task.estReady || task.scheduledStart) + m * MIN
    task.override = true // manual override: the scheduler leaves this dish alone from now on
  } else if (task.status === 'preparing') {
    task.durationMin += m
  } else throw new Error('Only scheduled or cooking dishes can be delayed')
  task.delayMin = (task.delayMin || 0) + m
  task.delayNote = `Kitchen delay +${m} min`
  return { task }
}

export function setTaskPriority(state, { taskId, priority }, now) {
  const task = findTask(state, taskId)
  task.priority = priority === 'high' ? 'high' : 'normal'
  return { task }
}

export function startTaskNow(state, { taskId }, now) {
  return setTaskStatus(state, { taskId, status: 'preparing' }, now)
}

// Ingredient ran out: cancel this dish, refund it, hide it from the menu, tell the customer.
export function reportUnavailable(state, { taskId }, now) {
  const task = findTask(state, taskId)
  const item = state.orderItems.find((i) => i.id === task.orderItemId)
  const menu = state.menu.find((m) => m.id === item?.menuItemId)
  if (menu) {
    menu.available = false
    menu.stock = 0
  }
  setTaskStatus(state, { taskId, status: 'cancelled' }, now)
  const order = findOrder(state, task.orderId)
  if (order.queueEntryId) notify(state, { kind: 'item_unavailable', entryId: order.queueEntryId, orderId: order.id, body: `Sorry, ${task.itemName} is unavailable. It has been removed from order ${order.orderNo} and refunded (test).` }, now)
  return { task }
}

// ───────────────────────── admin ─────────────────────────

export function upsertMenuItem(state, { item }, now) {
  const name = cleanText(item.name, 60)
  if (!name) throw new Error('Dish name is required')
  const price = Number(item.price)
  const prepMin = Number(item.prepMin)
  if (!(price >= 0) || !(prepMin >= 1)) throw new Error('Price and preparation time must be valid numbers')
  if (!state.stations.some((s) => s.id === item.station)) throw new Error('Choose a kitchen station')
  const clean = {
    ...item,
    name,
    description: cleanText(item.description, 160),
    price,
    prepMin,
    complexity: Math.min(5, Math.max(1, Number(item.complexity) || 2)),
    stock: item.stock === '' || item.stock == null ? null : Number(item.stock),
    available: item.available !== false,
  }
  const idx = state.menu.findIndex((m) => m.id === item.id)
  if (idx >= 0) state.menu[idx] = { ...state.menu[idx], ...clean }
  else state.menu.push({ ...clean, id: 'M' + pad(nextCounter(state, 'menu'), 3), emoji: clean.emoji || '🍽️', options: clean.options || [] })
  return {}
}

function nextCounter(state, key) {
  state.counters[key] = (state.counters[key] || 0) + 1
  return state.counters[key]
}

export function deleteMenuItem(state, { id }, now) {
  const inUse = state.tasks.some((t) => ['scheduled', 'received', 'preparing'].includes(t.status) && state.orderItems.find((i) => i.id === t.orderItemId)?.menuItemId === id)
  if (inUse) throw new Error('This dish is in active orders. Mark it unavailable instead.')
  state.menu = state.menu.filter((m) => m.id !== id)
  return {}
}

export function setAvailability(state, { id, available }, now) {
  const m = state.menu.find((x) => x.id === id)
  if (!m) throw new Error('Dish not found')
  m.available = !!available
  if (available && m.stock === 0) m.stock = null
  return {}
}

export function upsertTable(state, { table }, now) {
  const id = cleanText(table.id, 6).toUpperCase()
  const capacity = Number(table.capacity)
  if (!/^T\d{2,3}$/.test(id)) throw new Error('Table id must look like T11')
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 20) throw new Error('Capacity must be 1–20')
  const existing = state.tables.find((t) => t.id === id)
  if (existing) {
    existing.capacity = capacity
    existing.zone = table.zone || existing.zone
  } else state.tables.push({ id, capacity, zone: table.zone || 'Indoor', status: 'available', sessionId: null, heldFor: null })
  return {}
}

export function deleteTable(state, { id }, now) {
  const t = findTable(state, id)
  if (t.status !== 'available') throw new Error('Only an available table can be removed')
  state.tables = state.tables.filter((x) => x.id !== id)
  return {}
}

export function updateSettings(state, { patch }, now) {
  const next = { ...patch }
  if ('kioskPin' in next && !/^\d{4,8}$/.test(String(next.kioskPin))) throw new Error('Kiosk PIN must be 4–8 digits')
  if ('publicBaseUrl' in next) {
    const u = String(next.publicBaseUrl || '').trim().replace(/\/+$/, '')
    if (u && !/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/i.test(u)) throw new Error('Public base URL must start with http:// or https://')
    next.publicBaseUrl = u
  }
  if ('sessionHours' in next) {
    const h = Number(next.sessionHours)
    if (!Number.isFinite(h) || h < 1 || h > 72) throw new Error('Link lifetime must be 1–72 hours')
    next.sessionHours = h
  }
  state.settings = { ...state.settings, ...next }
  return {}
}

export function updateStation(state, { id, chefs }, now) {
  const st = state.stations.find((s) => s.id === id)
  const n = Number(chefs)
  if (!st || !Number.isInteger(n) || n < 1 || n > 8) throw new Error('Chefs must be 1–8')
  st.chefs = n
  return {}
}

// ───────────────────────── housekeeping (runs on every change and every few seconds) ─────────────────────────

export function housekeeping(state, now) {
  let changed = false

  // Cleaning finished → table available again.
  state.tables.forEach((t) => {
    if (t.status === 'cleaning' && t.cleanDoneAt && t.cleanDoneAt <= now) {
      t.status = 'available'
      t.cleanDoneAt = null
      changed = true
    }
  })

  // Called group did not show up within the grace period → no-show.
  state.queue
    .filter((q) => q.status === 'called')
    .forEach((q) => {
      const grace = state.settings.graceMinutes * (q.ackAt ? 2 : 1)
      if (state.settings.autoNoShow && now - q.calledAt > grace * MIN) {
        cancelEntry(state, { entryId: q.id, by: 'system', reason: 'No response to seating notification' }, now)
        changed = true
      }
    })

  // Scheduled pre-order dishes whose start time has arrived go to the kitchen.
  state.tasks.forEach((t) => {
    if (t.status === 'scheduled' && t.scheduledStart <= now) {
      t.status = 'received'
      changed = true
      syncOrderStatus(state, t.orderId, now)
    }
  })

  // The seating prediction moved (someone left early / late) → recalculate pre-order schedules.
  state.queue
    .filter((q) => ACTIVE_ENTRY.includes(q.status) && q.preorderOrderId)
    .forEach((q) => {
      state.orders
        .filter((o) => o.queueEntryId === q.id && o.paymentStatus === 'paid' && !['cancelled', 'served'].includes(o.status))
        .forEach((o) => {
          if (!state.tasks.some((t) => t.orderId === o.id && t.status === 'scheduled' && !t.override)) return
          const seatAt = expectedSeatAtForEntry(state, q, now)
          if (Math.abs(seatAt - (o.expectedSeatAt || 0)) >= MIN) {
            o.expectedSeatAt = seatAt
            schedulePreorderTasks(state, o.id, seatAt, now)
            o.rescheduledAt = now
            changed = true
          }
        })
    })

  return changed
}

export const ACTIONS = {
  joinQueue,
  cancelEntry,
  updateEntry,
  allocateTable,
  releaseTable,
  openSession,
  renewSession,
  ackCall,
  seatEntry,
  seatWalkIn,
  endSession,
  setTableStatus,
  notifyEntry,
  extendGrace,
  createOrder,
  payOrder,
  cancelOrderItem,
  setTaskStatus,
  delayTask,
  setTaskPriority,
  startTaskNow,
  reportUnavailable,
  upsertMenuItem,
  deleteMenuItem,
  setAvailability,
  upsertTable,
  deleteTable,
  updateSettings,
  updateStation,
}

// Re-exported for the UI.
export { computeKitchenPlan, findSlot }
