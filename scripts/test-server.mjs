// API tests for the local server: roles, redaction, sessions, realtime, persistence, simulated payments, webhooks.
// Run: npm run test:server   (starts its own server on a spare port with a temporary database)
import { spawn } from 'node:child_process'
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PORT = 5199, HOOK_PORT = 5198
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dineflow-test-'))
const BASE = `http://127.0.0.1:${PORT}`
let passed = 0, failed = 0
const ok = (n, c, d = '') => { c ? passed++ : failed++; console.log(c ? '  ✓' : '  ✗', n, c ? '' : d) }

// A fake Power Automate endpoint that records what it receives.
const hookCalls = []
const hook = http.createServer((req, res) => {
  let b = ''
  req.on('data', (c) => (b += c))
  req.on('end', () => { hookCalls.push(JSON.parse(b)); res.end('ok') })
}).listen(HOOK_PORT)

let proc
function start(extra = {}) {
  proc = spawn('node', ['server/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: DATA, POWER_AUTOMATE_WEBHOOK_URL: `http://127.0.0.1:${HOOK_PORT}/flow`, ...extra },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  return new Promise((resolve) => proc.stdout.on('data', (d) => String(d).includes('running') && resolve()))
}
const stop = () => new Promise((r) => { proc.once('exit', r); proc.kill('SIGTERM') })

async function api(method, url, body, cookie) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, json, headers: res.headers }
}
const act = (name, args, cookie) => api('POST', '/api/act', { name, args }, cookie)
async function login(username, pin) {
  const r = await api('POST', '/api/login', { username, pin })
  return { r, cookie: r.headers.get('set-cookie')?.split(';')[0] }
}

await start()
console.log('\nBasics')
ok('health', (await api('GET', '/api/health')).json.ok)
const cfg = (await api('GET', '/api/config')).json
ok('config has public base url', !!cfg.publicBaseUrl && cfg.powerAutomate)

console.log('\nWhat each viewer receives')
const pub = (await api('GET', '/api/state')).json
ok('public state has no phone numbers', !JSON.stringify(pub).match(/\b9000020021\b|\b9[0-9]{9}\b/))
ok('public state has no personal-link secrets', !pub.queue.some((q) => q.sessionToken) && !JSON.stringify(pub).includes('sessionToken'))
ok('public state has no kiosk PIN, no payments, no customers', !('kioskPin' in pub.settings) && pub.payments.length === 0 && pub.customers.length === 0)
ok('public state has no 10-day history', !pub.orders.some((o) => o.history) && pub.orders.length < 20, String(pub.orders.length))
const bad = await login('staff', '0000')
ok('wrong PIN rejected', bad.r.status === 401)
const staff = await login('staff', '1111')
ok('staff login sets HttpOnly cookie', staff.r.status === 200 && /HttpOnly/i.test(staff.r.headers.get('set-cookie')) && /SameSite=Strict/i.test(staff.r.headers.get('set-cookie')))
const staffState = (await api('GET', '/api/state', null, staff.cookie)).json
ok('staff sees phones and personal links but not the kiosk PIN', staffState.queue.some((q) => q.phone) && staffState.queue.some((q) => q.sessionToken) && !('kioskPin' in staffState.settings))
const kitchen = await login('kitchen', '2222')
const kState = (await api('GET', '/api/state', null, kitchen.cookie)).json
ok('kitchen sees no phones', !JSON.stringify(kState).includes('"phone"'))
const admin = await login('admin', '9999')
const aState = (await api('GET', '/api/state', null, admin.cookie)).json
ok('admin gets history for analytics and the kiosk PIN', aState.orders.some((o) => o.history) && aState.settings.kioskPin === '1234')

console.log('\nRole enforcement')
ok('anonymous cannot allocate a table', (await act('allocateTable', { entryId: 'Q021', tableId: 'T03' })).status === 401)
ok('anonymous cannot change settings', (await act('updateSettings', { patch: { restaurantName: 'Hacked' } })).status === 401)
ok('anonymous cannot mark a dish ready', (await act('setTaskStatus', { taskId: 'KT00001', status: 'ready' })).status === 401)
ok('kitchen cannot change the menu', (await act('setAvailability', { id: 'M001', available: false }, kitchen.cookie)).status === 403)
ok('staff cannot change settings', (await act('updateSettings', { patch: { kioskPin: '9999' } }, staff.cookie)).status === 403)
ok('admin can change settings', (await act('updateSettings', { patch: { queueAlertThreshold: 4 } }, admin.cookie)).json.ok)
ok('unknown action rejected', (await act('__proto__', {})).status === 400)

console.log('\nKiosk registration and personal session')
const join = (await act('joinQueue', { phone: '98765 43210', partySize: 4, name: 'Prasad', source: 'staff' })).json
ok('join works without login', join.ok && join.entry.id === 'Q024')
ok('customer is given a personal secret', join.entry.sessionToken?.length >= 32)
ok('result does not leak the phone number', !JSON.stringify(join).includes('9876543210'))
ok('customer cannot pose as staff via source', (await api('GET', '/api/state', null, admin.cookie)).json.queue.find((q) => q.id === 'Q024').source === 'self')
const secret = join.entry.sessionToken
ok('duplicate phone refused', (await act('joinQueue', { phone: '9876543210', partySize: 2 })).json.error?.includes('already in the queue'))
ok('QR url would not contain the phone number', !secret.includes('9876543210'))
const opened = (await act('openSession', { session: secret })).json
ok('personal link opens its own entry', opened.ok && opened.entryId === 'Q024')
ok('wrong secret does not open', !(await act('openSession', { session: 'x'.repeat(32) })).json.ok)
ok('secret is not in the public state afterwards', !JSON.stringify((await api('GET', '/api/state')).json).includes(secret))
ok('customer cannot cancel someone else’s entry', (await act('cancelEntry', { entryId: 'Q021', session: secret })).status === 403)
ok('customer cannot cancel without the secret', (await act('cancelEntry', { entryId: 'Q024' })).status === 403)
ok('invalid phone rejected', !(await act('joinQueue', { phone: '12345', partySize: 2 })).json.ok)

console.log('\nOrders and payments')
const dish = pub.menu.find((m) => m.name === 'Butter Naan').id
ok('pre-order needs the owner’s secret', (await act('createOrder', { type: 'preorder', entryId: 'Q024', items: [{ menuItemId: dish, qty: 2 }] })).status === 403)
const o = (await act('createOrder', { type: 'preorder', entryId: 'Q024', session: secret, clientRequestId: 'r1', items: [{ menuItemId: dish, qty: 2 }] })).json
ok('pre-order created unpaid', o.ok && o.order.paymentStatus === 'pending')
const o2 = (await act('createOrder', { type: 'preorder', entryId: 'Q024', session: secret, clientRequestId: 'r1', items: [{ menuItemId: dish, qty: 2 }] })).json
ok('double submit returns the same order', o2.duplicate && o2.order.id === o.order.id)
ok('another customer cannot pay my order', (await act('payOrder', { orderId: o.order.id, mode: 'demo', outcome: 'success' })).status === 403)
const fail = (await act('payOrder', { orderId: o.order.id, session: secret, mode: 'demo', outcome: 'fail', idempotencyKey: 'a' })).json
ok('failed payment recorded, order still unpaid', fail.failed)
const spoof = (await act('payOrder', { orderId: o.order.id, session: secret, mode: 'razorpay_test', outcome: 'success', idempotencyKey: 'b' })).json
ok('payment mode is always the simulated one', spoof.ok && spoof.order.paymentMode === 'demo')
ok('payment marks the order paid', spoof.order.paymentStatus === 'paid')
const dup = (await act('payOrder', { orderId: o.order.id, session: secret, mode: 'demo', outcome: 'success', idempotencyKey: 'e' })).json
ok('second payment on a paid order is a no-op', dup.duplicate)

console.log('\nStaff and kitchen workflow over the API')
const sState = () => api('GET', '/api/state', null, staff.cookie).then((r) => r.json)
let st = await sState()
const freeTable = st.tables.find((t) => t.status === 'cleaning')
ok('seeded evening is present', st.queue.filter((q) => q.status === 'waiting').length === 4)
await act('endSession', { tableId: 'T04' }, staff.cookie)
await act('setTableStatus', { tableId: 'T04', status: 'available' }, staff.cookie)
ok('staff allocates T04 to Q024', (await act('allocateTable', { entryId: 'Q024', tableId: 'T04' }, staff.cookie)).json.ok)
ok('staff seats Q024', (await act('seatEntry', { entryId: 'Q024' }, staff.cookie)).json.ok)
st = await sState()
const t = st.tasks.find((x) => x.orderId === o.order.id)
ok('kitchen task now carries the table number', t.tableId === 'T04' && t.status === 'received')
ok('kitchen marks it preparing then ready', (await act('setTaskStatus', { taskId: t.id, status: 'preparing' }, kitchen.cookie)).json.ok && (await act('setTaskStatus', { taskId: t.id, status: 'ready' }, kitchen.cookie)).json.ok)
const pubAfter = (await api('GET', '/api/state')).json
ok('customer-visible order status updated to ready', pubAfter.orders.find((x) => x.id === o.order.id).status === 'ready')
ok('customer sees the in-app “order ready” update', pubAfter.notifications.some((n) => n.entryId === 'Q024' && n.kind === 'order_ready'))
ok('customer-visible entry shows the table', pubAfter.queue.find((q) => q.id === 'Q024').tableId === 'T04')
ok('QR table order allowed for the seated table', (await act('createOrder', { type: 'qr', tableId: 'T04', items: [{ menuItemId: dish, qty: 1 }] })).json.ok)
await act('setTableStatus', { tableId: 'T03', status: 'available' }, staff.cookie)
ok('walk-in demo shortcut works when enabled', (await act('seatWalkIn', { tableId: 'T03', partySize: 2 })).json.ok)
await act('updateSettings', { patch: { demoShortcuts: false } }, admin.cookie)
ok('walk-in shortcut blocked when disabled', (await act('seatWalkIn', { tableId: 'T01', partySize: 2 })).status === 403)

console.log('\nKiosk PIN')
ok('wrong kiosk PIN', !(await api('POST', '/api/kiosk-exit', { pin: '0000' })).json.ok)
ok('right kiosk PIN', (await api('POST', '/api/kiosk-exit', { pin: '1234' })).json.ok)
await act('updateSettings', { patch: { kioskPin: '5555' } }, admin.cookie)
ok('changed kiosk PIN is enforced', (await api('POST', '/api/kiosk-exit', { pin: '5555' })).json.ok && !(await api('POST', '/api/kiosk-exit', { pin: '1234' })).json.ok)

console.log('\nRealtime (Server-Sent Events)')
const events = []
const ctl = new AbortController()
const sse = fetch(BASE + '/api/events', { signal: ctl.signal }).then(async (res) => {
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value)
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2)
      const m = chunk.match(/^event: state\ndata: (.*)$/m)
      if (m) events.push(JSON.parse(m[1]).meta.rev)
    }
  }
}).catch(() => {})
await new Promise((r) => setTimeout(r, 300))
const before = events.length
await act('updateSettings', { patch: { queueAlertThreshold: 5 } }, admin.cookie)
await act('updateSettings', { patch: { queueAlertThreshold: 4 } }, admin.cookie)
await new Promise((r) => setTimeout(r, 300))
ok('stream sent the initial state', before >= 1)
ok('every change is pushed to open screens', events.length > before, `${before} → ${events.length}`)
ok('revisions only go up', events.every((v, i) => i === 0 || v >= events[i - 1]))
ctl.abort(); await sse

console.log('\nPower Automate (optional webhook)')
await new Promise((r) => setTimeout(r, 300))
ok('table-available event reached the webhook', hookCalls.some((c) => c.event === 'table_available'), JSON.stringify(hookCalls.map((c) => c.event)))
for (const [i, phone] of ['9111111111', '9222222222', '9333333333'].entries()) await act('joinQueue', { phone, partySize: 6 })
await new Promise((r) => setTimeout(r, 400))
ok('queue-threshold event reached the webhook', hookCalls.some((c) => c.event === 'queue_threshold_exceeded' && c.waiting >= 4), JSON.stringify(hookCalls.map((c) => c.event)))
ok('failed-payment event reached the webhook', hookCalls.some((c) => c.event === 'payment_failed' && c.order), JSON.stringify(hookCalls.map((c) => c.event)))
ok('webhook payload has no phone numbers', !JSON.stringify(hookCalls).match(/9[0-9]{9}/))

console.log('\nPersistence and reset')
const revBefore = (await api('GET', '/api/health')).json.rev
await new Promise((r) => setTimeout(r, 600))
await stop()
ok('database file written', fs.existsSync(path.join(DATA, 'demo-db.json')))
await start()
const after = (await api('GET', '/api/state', null, staff.cookie)).json
ok('state survives a restart', after.queue.some((q) => q.id === 'Q024' && q.status === 'seated') && after.meta.rev >= revBefore)
ok('logins do not survive restart (re-login needed)', (await api('GET', '/api/me', null, staff.cookie)).json.role === null)
ok('reset needs admin', (await api('POST', '/api/reset')).status === 403)
const secretFile = fs.readFileSync(path.join(DATA, 'admin-secret.txt'), 'utf8').trim()
const resetRes = await fetch(BASE + '/api/reset', { method: 'POST', headers: { 'x-dineflow-secret': secretFile } })
ok('reset with the local secret works', resetRes.status === 200)
const reset = (await api('GET', '/api/state')).json
ok('back to the seeded evening (Q024 free again)', !reset.queue.some((q) => q.id === 'Q024') && reset.queue.filter((q) => q.status === 'waiting').length === 3)
ok('wrong secret rejected', (await fetch(BASE + '/api/reset', { method: 'POST', headers: { 'x-dineflow-secret': 'nope' } })).status === 403)

console.log('\nLogin throttling and limits')
let last
for (let i = 0; i < 12; i++) last = await api('POST', '/api/login', { username: 'staff', pin: 'bad' + i })
ok('repeated bad logins are throttled', last.status === 429)
const big = await fetch(BASE + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(1_100_000) }).catch(() => ({ status: 413 }))
ok('oversized request refused', big.status === 413 || big.status === 400)

await stop()
hook.close()
fs.rmSync(DATA, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
