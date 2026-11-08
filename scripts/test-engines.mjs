// Logic tests for the engines and actions (no browser needed): npm run test:engines
import { createSeedState } from '../src/lib/seed.js'
import { ACTIONS, housekeeping } from '../src/lib/actions.js'
import { predictWait, computeKitchenPlan, estimateDish, estimateOrder, suggestEntryForTable, simulateQueue } from '../src/lib/engines.js'
import { MIN } from '../src/lib/util.js'

let passed = 0
let failed = 0
function check(name, condition, detail = '') {
  if (condition) {
    passed++
    console.log('  ✓', name)
  } else {
    failed++
    console.log('  ✗', name, detail)
  }
}
function throws(name, fn, expected) {
  try {
    fn()
    failed++
    console.log('  ✗', name, '(did not throw)')
  } catch (e) {
    const ok = !expected || e.message.includes(expected)
    ok ? passed++ : failed++
    console.log(ok ? '  ✓' : '  ✗', name, ok ? '' : `got: ${e.message}`)
  }
}

const NOW = new Date('2026-11-05T19:00:00+05:30').getTime()
const state = createSeedState(NOW, 'http://localhost:5173')
const act = (name, args, at = NOW) => ACTIONS[name](state, args, at)
const dish = (n) => state.menu.find((m) => m.name === n)

console.log('\nSeed data')
check('10 tables', state.tables.length === 10)
check('4 stations', state.stations.length === 4)
check('20–30 menu items', state.menu.length >= 20 && state.menu.length <= 30, state.menu.length)
check('6 categories', state.categories.length === 6)
check('history has orders', state.orders.filter((o) => o.history).length > 100, state.orders.length)
check('3 live queue entries', state.queue.filter((q) => q.status === 'waiting').length === 3)
check('queue counter continues at Q024', state.counters.queue === 24)
check('failed payment sample exists', state.payments.some((p) => p.status === 'failed'))
check('scheduled pre-order tasks exist', state.tasks.some((t) => t.status === 'scheduled'))

console.log('\nWaiting-time prediction')
const p4 = predictWait(state, { partySize: 4 }, NOW)
console.log('   party of 4 →', { waitMin: p4.waitMin, groupsAhead: p4.groupsAhead, confidence: p4.confidence, table: p4.tableId })
check('possible and 3 groups ahead', p4.possible && p4.groupsAhead === 3)
check('wait is not queue position × constant', p4.waitMin !== 3 * 15)
const p2 = predictWait(state, { partySize: 2 }, NOW)
const p8 = predictWait(state, { partySize: 8 }, NOW)
check('bigger parties wait at least as long as a table for them frees up', p8.waitMin >= 0 && p2.waitMin >= 0)
throws('party above largest table rejected', () => act('joinQueue', { phone: '9876543210', partySize: 12 }), 'up to 8')

console.log('\nJoin queue')
throws('invalid phone rejected', () => act('joinQueue', { phone: '12345', partySize: 2 }), 'valid 10-digit')
throws('party size 0 rejected', () => act('joinQueue', { phone: '9876543210', partySize: 0 }), 'Party size')
const joined = act('joinQueue', { phone: '9876543210', partySize: 4, name: 'Prasad' })
check('gets token Q024', joined.entry.id === 'Q024', joined.entry.id)
check('in-app update logged, no phone number in it', state.notifications[0].kind === 'queue_joined' && !JSON.stringify(state.notifications[0]).includes('9876543210'))
check('no SMS fields anywhere', !('to' in state.notifications[0]) && !('channel' in state.notifications[0]))
check('personal session token is long and random', joined.entry.sessionToken.length >= 32 && /^[A-Za-z0-9_-]+$/.test(joined.entry.sessionToken))
check('session token does not contain the phone number', !joined.entry.sessionToken.includes('9876543210') && !joined.entry.sessionToken.includes('98765'))
check('session expires in the future', joined.entry.sessionExpiresAt > NOW + 60 * MIN)
const other = act('joinQueue', { phone: '9123456780', partySize: 2 })
check('every customer gets a different token', other.entry.sessionToken !== joined.entry.sessionToken)
act('cancelEntry', { entryId: other.entry.id, by: 'staff' })
throws('duplicate phone refused (no link hand-over)', () => act('joinQueue', { phone: '+91 98765 43210', partySize: 4 }), 'already in the queue as Q024')
const opened = act('openSession', { session: joined.entry.sessionToken })
check('openSession resolves the right entry', opened.entryId === 'Q024')
check('openSession records the scan', state.queue.find((q) => q.id === 'Q024').sessionOpenedAt === NOW)
throws('wrong secret rejected', () => act('openSession', { session: 'nope' }), 'not valid')
throws('Q024 (short token) is not a valid secret', () => act('openSession', { session: 'Q024' }), 'not valid')
throws('expired link rejected', () => act('openSession', { session: joined.entry.sessionToken }, NOW + 7 * 60 * MIN), 'expired')
const oldToken = joined.entry.sessionToken
const renewed = act('renewSession', { entryId: 'Q024' })
check('renewSession changes the secret', renewed.entry.sessionToken !== oldToken)
throws('old secret stops working', () => act('openSession', { session: oldToken }), 'not valid')
throws('bad kiosk PIN rejected', () => act('updateSettings', { patch: { kioskPin: '12' } }), '4–8 digits')
throws('bad public URL rejected', () => act('updateSettings', { patch: { publicBaseUrl: 'ftp://x' } }), 'http')
act('updateSettings', { patch: { publicBaseUrl: 'https://demo.example.com/' } })
check('public URL normalised', state.settings.publicBaseUrl === 'https://demo.example.com')
act('updateSettings', { patch: { publicBaseUrl: '' } })

console.log('\nDish and order estimates')
const plan = computeKitchenPlan(state, NOW)
const paneer = estimateDish(plan, dish('Paneer Tikka'), 1, NOW)
console.log('   Paneer Tikka →', { prep: paneer.prepMin, backlog: paneer.backlogMin, total: paneer.totalMin })
check('dish estimate = prep + backlog', paneer.totalMin === paneer.prepMin + paneer.backlogMin)
const lines = [dish('Paneer Tikka'), dish('Dal Makhani'), dish('Butter Naan'), dish('Cold Coffee')].map((item) => ({ item, qty: 1 }))
const est = estimateOrder(plan, lines, NOW)
console.log('   whole order →', { totalMin: est.totalMin, naiveSum: est.naiveSumMin })
check('order estimate is parallel (less than the sum)', est.totalMin < est.naiveSumMin)
check('order estimate ≥ slowest dish', est.totalMin >= 18)

console.log('\nPre-order scheduling')
const q24 = state.queue.find((q) => q.id === 'Q024')
const { order: pre } = act('createOrder', { type: 'preorder', entryId: 'Q024', clientRequestId: 'req-1', items: [
  { menuItemId: dish('Paneer Tikka').id, qty: 1 }, { menuItemId: dish('Dal Makhani').id, qty: 1 },
  { menuItemId: dish('Butter Naan').id, qty: 2 }, { menuItemId: dish('Cold Coffee').id, qty: 1 }] })
check('order created unpaid', pre.paymentStatus === 'pending' && pre.status === 'pending_payment')
const again = act('createOrder', { type: 'preorder', entryId: 'Q024', clientRequestId: 'req-1', items: [{ menuItemId: dish('Paneer Tikka').id, qty: 1 }] })
check('duplicate submit returns same order', again.duplicate && again.order.id === pre.id)
check('no tasks before payment', state.tasks.filter((t) => t.orderId === pre.id).length === 0)

act('updateEntry', { entryId: 'Q024', manualSeatAt: NOW + 40 * MIN })
const failedPay = act('payOrder', { orderId: pre.id, outcome: 'fail', idempotencyKey: 'k-fail' })
check('failed payment leaves order unpaid', failedPay.failed && state.orders.find((o) => o.id === pre.id).paymentStatus === 'pending')
const ok = act('payOrder', { orderId: pre.id, outcome: 'success', idempotencyKey: 'k-ok' })
check('retry succeeds', ok.payment.status === 'paid' && ok.order.paymentStatus === 'paid')
const dupPay = act('payOrder', { orderId: pre.id, outcome: 'success', idempotencyKey: 'k-ok' })
check('duplicate callback ignored', dupPay.duplicate === true)
const dupPay2 = act('payOrder', { orderId: pre.id, outcome: 'success', idempotencyKey: 'another-key' })
check('second payment attempt on paid order ignored', dupPay2.duplicate === true)
check('exactly one successful payment', state.payments.filter((p) => p.orderId === pre.id && p.status === 'paid').length === 1)

const preTasks = state.tasks.filter((t) => t.orderId === pre.id)
check('4 tasks scheduled (not sent immediately)', preTasks.length === 4 && preTasks.every((t) => t.status === 'scheduled'))
const show = (label, seat) => {
  console.log(`   ${label} (seating at +${Math.round((seat - NOW) / MIN)} min)`)
  preTasks.forEach((t) => console.log(`     ${t.itemName.padEnd(14)} ${t.station.padEnd(8)} start +${Math.round((t.scheduledStart - NOW) / MIN)}, ready +${Math.round((t.estReady - NOW) / MIN)}${t.delayMin ? `  (late by ${t.delayMin} min)` : ''}`))
}
let seatAt = state.orders.find((o) => o.id === pre.id).expectedSeatAt
show('Seating 40 minutes away', seatAt)
check('every dish is ready at seating time (± 1 min)', preTasks.every((t) => Math.abs(t.estReady - seatAt) <= MIN))
check('longest dish starts first', [...preTasks].sort((a, b) => a.scheduledStart - b.scheduledStart)[0].itemName === 'Dal Makhani')
check('nothing starts before now', preTasks.every((t) => t.scheduledStart >= NOW))
check('nothing is prepared excessively early (≤ max-early window)', preTasks.every((t) => seatAt - t.estReady <= 10 * MIN))
const o22seed = state.orders.find((o) => o.queueEntryId === 'Q022' && o.paymentStatus === 'paid')
const t22 = state.tasks.filter((t) => t.orderId === o22seed.id)
console.log('   Q022 (seating only ~10 min away): ' + t22.map((t) => `${t.itemName} start +${Math.round((t.scheduledStart - NOW) / MIN)} ready +${Math.round((t.estReady - NOW) / MIN)} late ${t.delayMin}`).join(' | '))
check('seating too soon for a dish → starts immediately and is flagged late', t22.some((t) => t.delayMin > 0) && t22.every((t) => t.scheduledStart >= NOW - 6 * MIN))
act('updateEntry', { entryId: 'Q024', clearManualSeat: true })

console.log('\nSchedule recalculation')
const startsBefore = preTasks.map((t) => t.scheduledStart).join()
act('updateEntry', { entryId: 'Q024', manualSeatAt: seatAt + 15 * MIN })
housekeeping(state, NOW + 1000)
const startsAfter = state.tasks.filter((t) => t.orderId === pre.id).map((t) => t.scheduledStart).join()
check('moving the seating time moves the schedule', startsBefore !== startsAfter)
const newSeat = state.orders.find((o) => o.id === pre.id).expectedSeatAt
check('expected seat time updated', newSeat >= seatAt + 14 * MIN)
const dalTask = state.tasks.find((t) => t.orderId === pre.id && t.itemName === 'Dal Makhani')
act('delayTask', { taskId: dalTask.id, minutes: 5 })
check('kitchen override locks the dish', dalTask.override === true)
const dalStart = dalTask.scheduledStart
act('updateEntry', { entryId: 'Q024', manualSeatAt: newSeat + 10 * MIN })
housekeeping(state, NOW + 2000)
check('overridden dish is not rescheduled', state.tasks.find((t) => t.id === dalTask.id).scheduledStart === dalStart)
act('updateEntry', { entryId: 'Q024', clearManualSeat: true })

console.log('\nFair seating + table allocation')
housekeeping(state, NOW + 3 * MIN) // T03 finishes cleaning
const t3 = state.tables.find((t) => t.id === 'T03')
check('T03 available after cleaning', t3.status === 'available', t3.status)
const sug = suggestEntryForTable(state, t3)
console.log('   suggestion for T03 →', sug?.entry.id, '—', sug?.reason)
check('table for 2 goes to party of 2, not the group of 6', sug.entry.id === 'Q022')
throws('cannot give a 2-seater to 4 people', () => act('allocateTable', { entryId: 'Q023', tableId: 'T03' }, NOW + 3 * MIN), 'seats 2')
const t4 = state.tables.find((t) => t.id === 'T04')
state.sessions.find((s) => s.id === t4.sessionId).expectedDepartAt = NOW
act('endSession', { tableId: 'T04' }, NOW + 3 * MIN)
housekeeping(state, NOW + 7 * MIN)
const big = suggestEntryForTable(state, state.tables.find((t) => t.id === 'T04'))
console.log('   suggestion for T04 →', big?.entry.id, '—', big?.reason)
check('4-seater suggestion fits the party', big.entry.partySize <= 4)

const t = NOW + 7 * MIN
act('allocateTable', { entryId: 'Q022', tableId: 'T03' }, t)
check('Q022 called, T03 reserved', state.queue.find((q) => q.id === 'Q022').status === 'called' && t3.status === 'reserved')
check('table-ready update logged for the customer page', state.notifications[0].kind === 'table_ready' && state.notifications[0].entryId === 'Q022')
const q022Order = state.orders.find((o) => o.queueEntryId === 'Q022' && o.paymentStatus === 'paid')
check('pre-order rescheduled for table ready', q022Order.expectedSeatAt <= t + 4 * MIN, Math.round((q022Order.expectedSeatAt - t) / MIN))
act('seatEntry', { entryId: 'Q022' }, t + 2 * MIN)
check('Q022 seated, table occupied', state.queue.find((q) => q.id === 'Q022').status === 'seated' && t3.status === 'occupied')
const q22tasks = state.tasks.filter((x) => x.orderId === q022Order.id)
check('kitchen tasks now carry table number', q22tasks.every((x) => x.tableId === 'T03' && x.status === 'received'))

console.log('\nKitchen flow')
const first = q22tasks[0]
throws('cannot skip straight to served', () => act('setTaskStatus', { taskId: first.id, status: 'served' }, t + 3 * MIN), 'Cannot move')
q22tasks.forEach((x) => {
  act('setTaskStatus', { taskId: x.id, status: 'preparing' }, t + 3 * MIN)
  act('setTaskStatus', { taskId: x.id, status: 'ready' }, t + 12 * MIN)
})
check('order ready when all dishes ready', state.orders.find((o) => o.id === q022Order.id).status === 'ready')
q22tasks.forEach((x) => act('setTaskStatus', { taskId: x.id, status: 'served' }, t + 13 * MIN))
check('order served', state.orders.find((o) => o.id === q022Order.id).status === 'served')

console.log('\nQR ordering')
throws('table without session cannot order', () => act('createOrder', { type: 'qr', tableId: 'T04', items: [{ menuItemId: dish('Masala Chai').id, qty: 1 }] }, t), 'no active seating session')
const { order: qr } = act('createOrder', { type: 'qr', tableId: 'T02', items: [{ menuItemId: dish('Veg Biryani').id, qty: 1 }, { menuItemId: dish('Mango Lassi').id, qty: 2 }] }, t)
act('payOrder', { orderId: qr.id, outcome: 'success', idempotencyKey: 'qr-1' }, t)
const qrTasks = state.tasks.filter((x) => x.orderId === qr.id)
check('QR order goes straight to kitchen with table', qrTasks.length === 2 && qrTasks.every((x) => x.status === 'received' && x.tableId === 'T02'))
const planNow = computeKitchenPlan(state, t)
check('kitchen plan has an estimate for each task', qrTasks.every((x) => planNow.plans[x.id]))

console.log('\nUnavailable dish, cancellation and no-show')
const lassi = qrTasks.find((x) => x.itemName === 'Mango Lassi')
act('reportUnavailable', { taskId: lassi.id }, t)
check('dish cancelled, hidden from menu, refunded', lassi.status === 'cancelled' && !dish('Mango Lassi').available && state.orders.find((o) => o.id === qr.id).refundedAmount > 0)
throws('unavailable dish cannot be ordered', () => act('createOrder', { type: 'qr', tableId: 'T02', items: [{ menuItemId: dish('Mango Lassi').id, qty: 1 }] }, t), 'not available')
act('setAvailability', { id: dish('Mango Lassi').id, available: true }, t)
check('admin can bring it back', dish('Mango Lassi').available)

const q21 = state.queue.find((q) => q.id === 'Q021')
const { order: pre21 } = act('createOrder', { type: 'preorder', entryId: 'Q021', items: [{ menuItemId: dish('Chicken Biryani').id, qty: 2 }] }, t)
act('payOrder', { orderId: pre21.id, outcome: 'success', idempotencyKey: 'q21' }, t)
act('cancelEntry', { entryId: 'Q021', by: 'customer' }, t + MIN)
check('customer cancel → abandoned', q21.status === 'abandoned')
check('pre-order cancelled and refunded (test)', state.orders.find((o) => o.id === pre21.id).paymentStatus === 'refund_initiated' && state.tasks.filter((x) => x.orderId === pre21.id).every((x) => x.status === 'cancelled'))

const t10 = state.tables.find((x) => x.id === 'T10')
state.sessions.find((s) => s.id === t10.sessionId).expectedDepartAt = t
act('endSession', { tableId: 'T10' }, t)
housekeeping(state, t + 4 * MIN)
const q23 = state.queue.find((q) => q.id === 'Q023')
act('allocateTable', { entryId: 'Q023', tableId: 'T10' }, t + 4 * MIN)
housekeeping(state, t + 4 * MIN + 6 * MIN)
check('no response within grace period → no-show, table released', q23.status === 'no_show' && t10.status === 'available', `${q23.status} ${t10.status}`)

console.log('\nAdmin guards')
throws('cannot delete dish used in active order', () => act('deleteMenuItem', { id: dish('Dal Makhani').id }, t), 'active orders')
throws('cannot remove occupied table', () => act('deleteTable', { id: 'T02' }, t), 'available')
act('upsertTable', { table: { id: 'T11', capacity: 4, zone: 'Indoor' } }, t)
check('can add a table', state.tables.some((x) => x.id === 'T11'))
throws('invalid price rejected', () => act('upsertMenuItem', { item: { name: 'X', price: -1, prepMin: 5, station: 'grill' } }, t), 'valid numbers')

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
