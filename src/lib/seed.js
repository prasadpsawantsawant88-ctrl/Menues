// Seed data for "Menues": settings, stations, tables, menu, 10 days of synthetic
// history (so the analytics are not empty) and a live evening scenario built through the real actions.
// Everything here is SYNTHETIC DEMO DATA, not measured business results.

import { MIN, makeRng, newSessionToken } from './util.js'
import { createOrder, payOrder, setTaskStatus, joinQueue, allocateTable } from './actions.js'
import { diningMinutes } from './engines.js'

const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const DEMO_ACCOUNTS = [
  { role: 'staff', username: 'staff', pin: '1111', label: 'Restaurant staff (host stand)' },
  { role: 'kitchen', username: 'kitchen', pin: '2222', label: 'Kitchen display' },
  { role: 'admin', username: 'admin', pin: '9999', label: 'Manager / admin' },
]

const spice = { name: 'Spice level', required: true, choices: [{ label: 'Mild', price: 0 }, { label: 'Medium', price: 0 }, { label: 'Spicy', price: 0 }] }

// [category, name, emoji, veg, price, prepMin, station, complexity, description, options, popularity]
const MENU_ROWS = [
  ['Starters', 'Paneer Tikka', '🧀', true, 240, 15, 'grill', 3, 'Cottage cheese marinated in spiced yoghurt, charred in the tandoor.', [spice, { name: 'Add-on', choices: [{ label: 'Extra mint chutney', price: 20 }] }], 4],
  ['Starters', 'Hara Bhara Kebab', '🥬', true, 200, 14, 'grill', 2, 'Spinach and green pea patties with warm spices.', [], 2],
  ['Starters', 'Chicken Tikka', '🍗', false, 290, 16, 'grill', 3, 'Boneless chicken, saffron marinade, tandoor roasted.', [spice], 3.5],
  ['Starters', 'Fish Amritsari', '🐟', false, 310, 14, 'grill', 3, 'Crisp batter-fried fish with ajwain and lemon.', [], 2],
  ['Starters', 'Crispy Corn', '🌽', true, 170, 9, 'grill', 1, 'Golden corn tossed with pepper and spring onion.', [], 2],
  ['Starters', 'Veg Spring Roll', '🥟', true, 180, 10, 'grill', 2, 'Crunchy rolls with sweet chilli dip.', [], 1.5],
  ['Main Course', 'Dal Makhani', '🍲', true, 190, 18, 'curry', 3, 'Black lentils slow-cooked overnight with butter and cream.', [], 4],
  ['Main Course', 'Paneer Butter Masala', '🍛', true, 230, 15, 'curry', 2, 'Cottage cheese in a silky tomato-butter gravy.', [spice], 4],
  ['Main Course', 'Kadai Paneer', '🫕', true, 240, 15, 'curry', 2, 'Peppers and paneer in a freshly ground kadai masala.', [spice], 2],
  ['Main Course', 'Palak Paneer', '🥗', true, 220, 14, 'curry', 2, 'Paneer in a smooth spinach gravy.', [], 2],
  ['Main Course', 'Mixed Veg Curry', '🥘', true, 180, 12, 'curry', 1, 'Seasonal vegetables in a home-style gravy.', [], 1.5],
  ['Main Course', 'Butter Chicken', '🍗', false, 310, 18, 'curry', 3, 'Tandoori chicken in a creamy tomato gravy.', [spice], 4],
  ['Main Course', 'Mutton Rogan Josh', '🍖', false, 380, 28, 'curry', 4, 'Slow-braised mutton with Kashmiri chilli.', [spice], 2],
  ['Indian Breads', 'Butter Naan', '🫓', true, 45, 6, 'bread', 1, 'Soft tandoor-baked bread brushed with butter.', [], 6],
  ['Indian Breads', 'Garlic Naan', '🧄', true, 60, 6, 'bread', 1, 'Naan topped with roasted garlic and coriander.', [], 4],
  ['Indian Breads', 'Tandoori Roti', '🫓', true, 30, 5, 'bread', 1, 'Whole wheat roti from the tandoor.', [], 3],
  ['Indian Breads', 'Laccha Paratha', '🥞', true, 55, 7, 'bread', 2, 'Flaky layered whole wheat paratha.', [], 2],
  ['Indian Breads', 'Stuffed Kulcha', '🥙', true, 80, 8, 'bread', 2, 'Kulcha stuffed with spiced potato and onion.', [], 1.5],
  ['Rice and Biryani', 'Veg Biryani', '🍚', true, 220, 18, 'curry', 3, 'Basmati rice layered with vegetables and saffron.', [{ name: 'Add-on', choices: [{ label: 'Raita', price: 30 }] }], 3.5],
  ['Rice and Biryani', 'Chicken Biryani', '🍗', false, 290, 22, 'curry', 4, 'Dum-cooked biryani with marinated chicken.', [{ name: 'Add-on', choices: [{ label: 'Raita', price: 30 }] }], 4],
  ['Rice and Biryani', 'Jeera Rice', '🍚', true, 120, 10, 'curry', 1, 'Basmati rice tempered with cumin.', [], 2],
  ['Rice and Biryani', 'Steamed Rice', '🍚', true, 100, 8, 'curry', 1, 'Plain steamed basmati rice.', [], 1.5],
  ['Beverages', 'Cold Coffee', '🧋', true, 120, 4, 'beverage', 1, 'Chilled coffee blended with milk.', [{ name: 'Add-on', choices: [{ label: 'Scoop of ice cream', price: 40 }] }], 3],
  ['Beverages', 'Masala Chai', '☕', true, 50, 4, 'beverage', 1, 'Spiced Indian tea.', [], 3],
  ['Beverages', 'Fresh Lime Soda', '🍋', true, 80, 3, 'beverage', 1, 'Sweet, salted or mixed.', [{ name: 'Style', required: true, choices: [{ label: 'Sweet', price: 0 }, { label: 'Salted', price: 0 }, { label: 'Mixed', price: 0 }] }], 2.5],
  ['Beverages', 'Mango Lassi', '🥭', true, 110, 4, 'beverage', 1, 'Thick yoghurt drink with Alphonso mango.', [], 2.5],
  ['Desserts', 'Gulab Jamun', '🍮', true, 90, 4, 'beverage', 1, 'Warm milk dumplings in rose syrup (2 pcs).', [], 3],
  ['Desserts', 'Rasmalai', '🥛', true, 120, 5, 'beverage', 1, 'Soft cottage cheese discs in saffron milk.', [], 2],
  ['Desserts', 'Brownie with Ice Cream', '🍫', true, 160, 6, 'beverage', 2, 'Warm chocolate brownie with vanilla ice cream.', [], 2],
]

export function baseSettings() {
  return {
    restaurantName: 'Menues',
    tagline: 'Fine North Indian dining',
    openTime: '11:00',
    closeTime: '23:00',
    graceMinutes: 5,
    cleaningMinutes: 3,
    walkInMinutes: 3,
    maxSkips: 2,
    dining: { small: 45, medium: 60, large: 75 },
    peakHours: [[12, 15], [19, 22]],
    peakMultiplier: 1.15,
    readyOffsetMinutes: 0,
    maxEarlyMinutes: 10,
    gstPercent: 5,
    kioskPin: '1234', // demo PIN to leave the kiosk screen (change it in Admin → Settings)
    publicBaseUrl: '', // address printed in QR codes; blank = detect (LAN address of the server)
    sessionHours: 6, // how long a customer's personal link stays valid
    demoShortcuts: true, // lets a table page seat a pretend party (demo convenience)
    queueAlertThreshold: 6, // optional Power Automate alert when this many groups wait
    autoNoShow: true,
    reservationsEnabled: false,
  }
}

const TABLES = [
  ['T01', 2, 'Indoor'], ['T02', 2, 'Indoor'], ['T03', 2, 'Window'], ['T04', 4, 'Indoor'], ['T05', 4, 'Indoor'],
  ['T06', 4, 'Window'], ['T07', 4, 'Outdoor'], ['T08', 6, 'Indoor'], ['T09', 6, 'Outdoor'], ['T10', 8, 'Indoor'],
]

const FIRST_NAMES = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha', 'Vikram', 'Ananya', 'Arjun', 'Saanvi', 'Neel', 'Tara']

function buildMenu() {
  const categories = [...new Set(MENU_ROWS.map((r) => r[0]))].map((name, i) => ({ id: 'C' + (i + 1), name, sort: i }))
  const menu = MENU_ROWS.map((r, i) => ({
    id: 'M' + String(i + 1).padStart(3, '0'),
    categoryId: categories.find((c) => c.name === r[0]).id,
    name: r[1],
    emoji: r[2],
    veg: r[3],
    price: r[4],
    prepMin: r[5],
    station: r[6],
    complexity: r[7],
    description: r[8],
    options: r[9],
    available: true,
    stock: null,
    image: null,
  }))
  const popularity = Object.fromEntries(MENU_ROWS.map((r, i) => [menu[i].id, r[10]]))
  return { categories, menu, popularity }
}

function pickWeighted(rng, entries) {
  const total = entries.reduce((s, e) => s + e[1], 0)
  let r = rng() * total
  for (const [value, w] of entries) {
    r -= w
    if (r <= 0) return value
  }
  return entries[entries.length - 1][0]
}

function startOfDay(ms) {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function buildHistory(state, popularity, now) {
  const rng = makeRng(2026)
  const DAYS = 10
  const pool = []
  for (let i = 0; i < 40; i++) {
    const c = { id: 'C' + String(i + 1).padStart(4, '0'), phone: String(9000010000 + i), name: FIRST_NAMES[i % FIRST_NAMES.length], createdAt: now - DAYS * DAY }
    pool.push(c)
    state.customers.push(c)
  }
  state.counters.customer = pool.length
  const hourWeights = [[11, 1], [12, 3], [13, 4], [14, 2], [15, 0.5], [18, 1], [19, 3], [20, 5], [21, 4], [22, 1]]
  const partyWeights = [[1, 0.05], [2, 0.35], [3, 0.15], [4, 0.25], [5, 0.08], [6, 0.09], [7, 0.02], [8, 0.01]]
  const menuWeights = state.menu.map((m) => [m, popularity[m.id]])
  let h = 0

  for (let d = DAYS; d >= 1; d--) {
    const dayStart = startOfDay(now - d * DAY)
    const weekday = new Date(dayStart).getDay()
    const factor = [0, 5, 6].includes(weekday) ? 1.4 : 1
    const parties = Math.round((14 + rng() * 8) * factor)
    for (let i = 0; i < parties; i++) {
      h++
      const hour = pickWeighted(rng, hourWeights)
      const peak = (hour >= 12 && hour < 15) || (hour >= 19 && hour < 22)
      const joinedAt = dayStart + hour * HOUR + Math.floor(rng() * 50) * MIN
      const party = pickWeighted(rng, partyWeights)
      const queued = rng() < (peak ? 0.7 : 0.25)
      const wait = queued ? Math.round(4 + rng() * (peak ? 30 : 12)) : 0
      const customer = pool[Math.floor(rng() * pool.length)]
      const entry = {
        id: `H${String(h).padStart(4, '0')}`,
        customerId: customer.id,
        phone: customer.phone,
        name: customer.name,
        partySize: party,
        preference: 'Any',
        source: 'self',
        joinedAt,
        skipCount: 0,
        priority: 0,
        history: true,
        predictedWaitMin: queued ? Math.max(0, wait + Math.round((rng() - 0.5) * 10)) : 0,
        queued,
      }
      if (queued && rng() < 0.11) {
        entry.status = 'abandoned'
        entry.endedAt = joinedAt + Math.round(5 + rng() * 10) * MIN
        state.queue.push(entry)
        continue
      }
      const seatedAt = joinedAt + wait * MIN
      entry.status = 'seated'
      entry.seatedAt = seatedAt
      const wantsPreorder = queued && wait >= 8 && rng() < 0.12 + (DAYS - d) * 0.035
      const table = state.tables.filter((t) => t.capacity >= party).sort(() => rng() - 0.5)[0]
      const dwell = Math.round(diningMinutes(state.settings, party, seatedAt) * (0.75 + rng() * 0.45))
      const session = {
        id: `HS${String(h).padStart(4, '0')}`,
        tableId: table.id,
        queueEntryId: entry.id,
        customerId: customer.id,
        partySize: party,
        seatedAt,
        endedAt: seatedAt + dwell * MIN,
        expectedDepartAt: seatedAt + dwell * MIN,
        status: 'ended',
      }
      state.sessions.push(session)
      state.queue.push(entry)

      const rounds = rng() < 0.3 ? 2 : 1
      for (let r = 0; r < rounds; r++) {
        const type = r === 0 && wantsPreorder ? 'preorder' : 'qr'
        const orderId = `HO${String(h).padStart(4, '0')}${r}`
        const itemCount = r === 0 ? 2 + Math.floor(rng() * 4) : 1 + Math.floor(rng() * 2)
        const chosen = []
        while (chosen.length < itemCount) {
          const m = pickWeighted(rng, menuWeights)
          if (!chosen.includes(m)) chosen.push(m)
        }
        const createdAt = type === 'preorder' ? joinedAt + 2 * MIN : r === 0 ? seatedAt + 3 * MIN : seatedAt + (30 + Math.round(rng() * 15)) * MIN
        const queueDelay = peak ? rng() * 7 : rng() * 3
        let subtotal = 0
        const actuals = []
        chosen.forEach((m, k) => {
          const qty = 1 + (rng() < 0.3 ? 1 : 0) + (m.station === 'bread' && rng() < 0.6 ? 1 : 0)
          const actual = Math.round(m.prepMin * (0.9 + rng() * 0.45) * 10) / 10
          actuals.push(actual)
          subtotal += m.price * qty
          state.orderItems.push({
            id: `${orderId}-${k}`,
            orderId,
            menuItemId: m.id,
            name: m.name,
            emoji: m.emoji,
            qty,
            unitPrice: m.price,
            station: m.station,
            options: [],
            status: 'served',
            actualPrepMin: actual,
          })
        })
        const tax = Math.round(subtotal * 0.05)
        // Pre-orders are timed to the seating moment; table orders wait for the kitchen after ordering.
        const firstServedAt = type === 'preorder' ? seatedAt + Math.round(1 + rng() * 4) * MIN : createdAt + (Math.min(...actuals) + queueDelay + 1) * MIN
        const readyAt = type === 'preorder' ? firstServedAt + Math.round(rng() * 3) * MIN : createdAt + (Math.max(...actuals) + queueDelay) * MIN
        const clockStartAt = type === 'preorder' ? seatedAt : createdAt
        state.orders.push({
          id: orderId,
          orderNo: '#H' + h + r,
          type,
          queueEntryId: entry.id,
          tableId: table.id,
          sessionId: session.id,
          customerId: customer.id,
          partySize: party,
          status: 'served',
          paymentStatus: 'paid',
          paymentMode: 'demo',
          subtotal,
          tax,
          total: subtotal + tax,
          createdAt,
          paidAt: createdAt,
          clockStartAt,
          firstServedAt,
          readyAt,
          servedAt: readyAt + 2 * MIN,
          hadIssue: rng() < 0.04,
          history: true,
        })
        if (type === 'preorder') entry.preorderOrderId = orderId
      }
    }
  }
}

// The live evening scenario is created through the real actions so it is always consistent.
function buildLiveScenario(state, now) {
  const mk = (id, phone, name) => {
    const c = { id, phone, name, createdAt: now - 3 * HOUR }
    state.customers.push(c)
    return c
  }
  const c21 = mk('C0101', '9000020021', 'Sharma family')
  const c22 = mk('C0102', '9000020022', 'Priya')
  const c23 = mk('C0103', '9000020023', 'Nikhil')
  state.counters.customer = 103

  const occupy = (tableId, partySize, minutesAgo) => {
    const table = state.tables.find((t) => t.id === tableId)
    const seatedAt = now - minutesAgo * MIN
    const session = {
      id: 'S' + String(++state.counters.session).padStart(4, '0'),
      tableId,
      queueEntryId: null,
      customerId: null,
      partySize,
      seatedAt,
      expectedDepartAt: seatedAt + diningMinutes(state.settings, partySize, seatedAt) * MIN,
      status: 'active',
    }
    state.sessions.push(session)
    table.status = 'occupied'
    table.sessionId = session.id
    return session
  }
  occupy('T01', 2, 38)
  occupy('T02', 2, 12)
  occupy('T04', 4, 52)
  occupy('T05', 3, 30)
  occupy('T06', 4, 8)
  occupy('T07', 2, 44)
  occupy('T08', 5, 20)
  occupy('T09', 6, 55)
  occupy('T10', 7, 35)
  const t3 = state.tables.find((t) => t.id === 'T03')
  t3.status = 'cleaning'
  t3.cleanDoneAt = now + 2 * MIN

  // Queue Q021–Q023 (counter continues at Q024, matching the example in the brief).
  const q = (id, c, party, minutesAgo, pref = 'Any') => {
    state.queue.push({ id, customerId: c.id, phone: c.phone, name: c.name, partySize: party, preference: pref, status: 'waiting', source: 'self', sessionToken: newSessionToken(), sessionExpiresAt: now + 6 * HOUR, joinedAt: now - minutesAgo * MIN, skipCount: 0, priority: 0, tableId: null, preorderOrderId: null })
  }
  q('Q021', c21, 6, 22)
  q('Q022', c22, 2, 14)
  q('Q023', c23, 4, 6)
  state.counters.queue = 24

  // Live orders on seated tables, replayed with realistic timestamps.
  const dish = (name) => state.menu.find((m) => m.name === name).id
  const order = (args, at) => {
    const { order: o } = createOrder(state, args, at)
    payOrder(state, { orderId: o.id, mode: 'demo', outcome: 'success', idempotencyKey: 'seed-' + o.id }, at)
    return o
  }
  const tasksOf = (o) => state.tasks.filter((t) => t.orderId === o.id)
  const task = (o, name) => tasksOf(o).find((t) => t.itemName === name)
  const t09 = state.tables.find((t) => t.id === 'T09')
  // T09: finished order (served).
  const o9 = order({ type: 'qr', tableId: t09.id, items: [{ menuItemId: dish('Chicken Biryani'), qty: 2 }, { menuItemId: dish('Mango Lassi'), qty: 3 }] }, now - 48 * MIN)
  tasksOf(o9).forEach((t) => {
    setTaskStatus(state, { taskId: t.id, status: 'preparing' }, now - 47 * MIN)
    setTaskStatus(state, { taskId: t.id, status: 'ready' }, now - 28 * MIN)
    setTaskStatus(state, { taskId: t.id, status: 'served' }, now - 26 * MIN)
  })
  // T08: some dishes ready, some still cooking.
  const o8 = order({ type: 'qr', tableId: 'T08', items: [{ menuItemId: dish('Paneer Tikka'), qty: 2 }, { menuItemId: dish('Butter Chicken'), qty: 1 }, { menuItemId: dish('Butter Naan'), qty: 4 }, { menuItemId: dish('Fresh Lime Soda'), qty: 3, options: [{ group: 'Style', label: 'Sweet', price: 0 }] }] }, now - 14 * MIN)
  setTaskStatus(state, { taskId: task(o8, 'Fresh Lime Soda').id, status: 'preparing' }, now - 13 * MIN)
  setTaskStatus(state, { taskId: task(o8, 'Fresh Lime Soda').id, status: 'ready' }, now - 9 * MIN)
  setTaskStatus(state, { taskId: task(o8, 'Fresh Lime Soda').id, status: 'served' }, now - 8 * MIN)
  setTaskStatus(state, { taskId: task(o8, 'Paneer Tikka').id, status: 'preparing' }, now - 12 * MIN)
  setTaskStatus(state, { taskId: task(o8, 'Butter Chicken').id, status: 'preparing' }, now - 11 * MIN)
  // T05: just ordered.
  order({ type: 'qr', tableId: 'T05', items: [{ menuItemId: dish('Dal Makhani'), qty: 1 }, { menuItemId: dish('Garlic Naan'), qty: 3 }, { menuItemId: dish('Cold Coffee'), qty: 2 }] }, now - 3 * MIN)

  // Q022 pre-ordered and paid: its dishes are SCHEDULED for the expected seating time.
  const o22 = order({ type: 'preorder', entryId: 'Q022', items: [{ menuItemId: dish('Paneer Butter Masala'), qty: 1, options: [{ group: 'Spice level', label: 'Medium', price: 0 }] }, { menuItemId: dish('Butter Naan'), qty: 2 }, { menuItemId: dish('Cold Coffee'), qty: 2 }] }, now - 5 * MIN)
  state.queue.find((x) => x.id === 'Q022').preorderOrderId = o22.id

  // Q023 tried to pre-order but the (simulated) payment failed → shows payment failure handling.
  const { order: o23 } = createOrder(state, { type: 'preorder', entryId: 'Q023', items: [{ menuItemId: dish('Veg Biryani'), qty: 1 }] }, now - 2 * MIN)
  payOrder(state, { orderId: o23.id, mode: 'demo', outcome: 'fail', idempotencyKey: 'seed-fail-' + o23.id }, now - 2 * MIN)

  notifyJoinLog(state)
}

function notifyJoinLog(state) {
  state.queue
    .filter((q) => ['Q021', 'Q022', 'Q023'].includes(q.id))
    .forEach((q) => {
      state.notifications.push({
        id: 'N' + q.id,
        kind: 'queue_joined',
        entryId: q.id,
        orderId: null,
        createdAt: q.joinedAt,
        body: `You are in the queue as ${q.id}. This page updates by itself when your table is ready.`,
      })
    })
  state.notifications.sort((a, b) => b.createdAt - a.createdAt)
}

export function createSeedState(now = Date.now(), baseUrl = '') {
  const { categories, menu, popularity } = buildMenu()
  const state = {
    meta: { version: 1, rev: 0, baseUrl, seededAt: now },
    settings: baseSettings(),
    stations: [
      { id: 'grill', name: 'Grill', chefs: 2 },
      { id: 'curry', name: 'Curry', chefs: 2 },
      { id: 'bread', name: 'Bread', chefs: 2 },
      { id: 'beverage', name: 'Beverage', chefs: 2 },
    ],
    tables: TABLES.map(([id, capacity, zone]) => ({ id, capacity, zone, status: 'available', sessionId: null, heldFor: null })),
    categories,
    menu,
    customers: [],
    queue: [],
    sessions: [],
    orders: [],
    orderItems: [],
    payments: [],
    tasks: [],
    notifications: [],
    counters: { queue: 1, order: 0, orderItem: 0, payment: 0, task: 0, session: 0, customer: 0, notification: 0, menu: menu.length },
  }
  buildHistory(state, popularity, now)
  // History uses its own id space; the live counters start fresh so live ids stay short.
  state.counters.session = 0
  buildLiveScenario(state, now)
  return state
}

// Used by the store when a brand-new walk-in needs to be created in tests.
export { joinQueue, allocateTable }
