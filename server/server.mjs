// DineFlow local server — no dependencies, Node 20+.
//
//  • Serves the built web app (dist/) to every device on the network.
//  • Holds the ONE shared restaurant state (data/demo-db.json) and runs the same action code
//    the browser uses (src/lib/actions.js), so kiosk, phones, staff and kitchen always agree.
//  • Pushes every change to every open screen with Server-Sent Events (live updates, auto-reconnect).
//  • Role checks (staff / kitchen / admin) with an HttpOnly cookie; customers prove ownership of
//    their queue entry with the secret in their personal link.
//  • Optional: Power Automate webhook alerts. Payments are a simulated "Pay" button (no payment provider).
//
// Start: node server/server.mjs      (or double-click START_DEMO.bat / ./START_DEMO.sh)

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ACTIONS, housekeeping } from '../src/lib/actions.js'
import { setPrepModel } from '../src/lib/engines.js'
import { createSeedState, DEMO_ACCOUNTS } from '../src/lib/seed.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ───────────────────────── configuration (.env + environment) ─────────────────────────

function loadDotEnv() {
  const file = path.join(ROOT, '.env')
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (!m || line.trim().startsWith('#')) continue
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadDotEnv()

const env = process.env
const PORT = Number(env.PORT || 5173)
const HOST = env.HOST || '0.0.0.0'
const DIST = path.join(ROOT, 'dist')
const DATA_DIR = env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(ROOT, 'data')
const DB_FILE = path.join(DATA_DIR, 'demo-db.json')
const PID_FILE = path.join(DATA_DIR, 'dineflow.pid')
const SECRET_FILE = path.join(DATA_DIR, 'admin-secret.txt')
fs.mkdirSync(DATA_DIR, { recursive: true })

const ACCOUNTS = DEMO_ACCOUNTS.map((a) => ({ ...a, pin: env[`${a.role.toUpperCase()}_PIN`] || a.pin }))
const WEBHOOK = env.POWER_AUTOMATE_WEBHOOK_URL || ''

// Local-only secret for reset/stop scripts. Never sent to a browser.
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(24).toString('hex'), { mode: 0o600 })
const ADMIN_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim()

function lanUrls() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`)
    }
  }
  // Prefer home/office private ranges over virtual adapters.
  const rank = (u) => (/\/\/192\.168\./.test(u) ? 0 : /\/\/10\./.test(u) ? 1 : /\/\/172\.(1[6-9]|2\d|3[01])\./.test(u) ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b))
}

// ───────────────────────── state + persistence ─────────────────────────

let state = loadOrSeed()
setPrepModel(state.settings.useAiTimings === false ? null : state.ml || null)
function loadOrSeed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
    // A database from before inventory, loyalty and the floor-plan editor is replaced by fresh demo data.
    if (parsed?.meta?.version === 1 && parsed.ingredients && parsed.layout) return parsed
  } catch { /* first start or unreadable file: seed fresh data */ }
  const fresh = createSeedState(Date.now(), '')
  fs.writeFileSync(DB_FILE, JSON.stringify(fresh))
  return fresh
}

let persistTimer = null
function persistSoon() {
  clearTimeout(persistTimer)
  persistTimer = setTimeout(persistNow, 400)
}
function persistNow() {
  try {
    const tmp = DB_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(state))
    fs.renameSync(tmp, DB_FILE) // atomic: a crash never leaves a half-written database
  } catch (e) {
    console.error('Could not save data:', e.message)
  }
}

function commit(fn) {
  const draft = structuredClone(state)
  const now = Date.now()
  const result = fn(draft, now) // throws on invalid input → nothing changes
  housekeeping(draft, now)
  draft.meta.rev = (state.meta.rev || 0) + 1
  state = draft
  afterChange()
  return result
}

function afterChange() {
  persistSoon()
  broadcast()
  checkAlerts(state)
}

// Time moves on: expire no-shows, finish cleaning, start scheduled dishes, re-plan.
setInterval(() => {
  const probe = structuredClone(state)
  if (housekeeping(probe, Date.now())) {
    probe.meta.rev = (state.meta.rev || 0) + 1
    state = probe
    afterChange()
  } else checkAlerts(state)
}, 5000)

// ───────────────────────── who sees what ─────────────────────────

function view(role) {
  if (role === 'admin') return state
  const liveOrders = state.orders.filter((o) => !o.history)
  const liveIds = new Set(liveOrders.map((o) => o.id))
  const base = {
    ...state,
    queue: state.queue.filter((q) => !q.history),
    orders: liveOrders,
    orderItems: state.orderItems.filter((i) => liveIds.has(i.orderId)),
    sessions: state.sessions.filter((s) => s.status === 'active'),
  }
  const { kioskPin, ...settings } = state.settings // only the admin ever receives the kiosk PIN
  // Stock levels, supplier prices, recipes and loyalty balances are for the admin only. Dishes keep "portionsLeft" so sold-out shows.
  const { ingredients, stockLog, loyaltyLog, ...rest0 } = base
  const slim = { ...rest0, menu: base.menu.map(({ recipe, ...m }) => m) }
  if (role === 'staff') return { ...slim, settings, customers: [] } // staff see phones (masked on screen) and personal links
  // kitchen and the public never receive phone numbers, personal-link secrets or payment records
  return {
    ...slim,
    settings,
    customers: [],
    payments: [],
    queue: base.queue.map(({ phone, name, customerId, sessionToken, ...rest }) => rest),
    orders: base.orders.map(({ clientRequestId, customerId, ...rest }) => rest),
  }
}

const viewCache = {}
function viewJson(role) {
  const rev = state.meta.rev
  const hit = viewCache[role]
  if (hit && hit.rev === rev) return hit.json
  const json = JSON.stringify(view(role))
  viewCache[role] = { rev, json }
  return json
}

const PUBLIC_ACTIONS = new Set(['joinQueue', 'openSession', 'ackCall', 'cancelEntry', 'createOrder', 'payOrder', 'cancelOrderItem', 'seatWalkIn', 'myLoyalty'])
const KITCHEN_ACTIONS = new Set(['setTaskStatus', 'delayTask', 'setTaskPriority', 'startTaskNow', 'reportUnavailable'])
const ADMIN_ACTIONS = new Set(['upsertMenuItem', 'deleteMenuItem', 'setAvailability', 'upsertTable', 'deleteTable', 'updateSettings', 'updateStation',
  'upsertIngredient', 'deleteIngredient', 'receiveStock', 'adjustStock', 'setStockCount', 'upsertCategory', 'deleteCategory',
  'saveFloorPlan', 'retrainPrepModel', 'setPrepModelEnabled', 'adjustPoints', 'saveLoyaltyConfig'])

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

function ownsEntry(entry, secret, now) {
  return !!(entry && entry.sessionToken && typeof secret === 'string' && safeEqual(entry.sessionToken, secret) && (!entry.sessionExpiresAt || entry.sessionExpiresAt > now))
}

// Returns null when allowed, or { status, error }.
function authorize(role, name, args) {
  const now = Date.now()
  if (role === 'admin') return null
  if (role === 'staff') return ADMIN_ACTIONS.has(name) ? { status: 403, error: 'Admin only' } : null
  if (role === 'kitchen') return KITCHEN_ACTIONS.has(name) ? null : { status: 403, error: 'The kitchen account cannot do this' }

  // Everyone else (kiosk, customer phones)
  if (!PUBLIC_ACTIONS.has(name)) return { status: 401, error: 'Please sign in' }
  const needsOwner = (entryId) => {
    const entry = state.queue.find((q) => q.id === entryId)
    return ownsEntry(entry, args.session, now) ? null : { status: 403, error: 'Open your personal link (the QR code from the entrance) to do this' }
  }
  if (name === 'myLoyalty') return state.queue.some((q) => ownsEntry(q, args.session, now)) ? null : { status: 403, error: 'Open your personal link to see your rewards' }
  if (name === 'ackCall' || name === 'cancelEntry') return needsOwner(args.entryId)
  if (name === 'createOrder' && args.type === 'preorder') return needsOwner(args.entryId)
  if (name === 'payOrder' || name === 'cancelOrderItem') {
    const orderId = name === 'payOrder' ? args.orderId : state.orderItems.find((i) => i.id === args.orderItemId)?.orderId
    const order = state.orders.find((o) => o.id === orderId)
    if (order?.type === 'preorder') return needsOwner(order.queueEntryId)
  }
  if (name === 'seatWalkIn' && !state.settings.demoShortcuts) return { status: 403, error: 'Ask the host to seat you' }
  return null
}

// Customers may only send the fields they are meant to send.
function sanitize(role, name, args) {
  if (role === 'admin' || role === 'staff' || role === 'kitchen') return args
  const { session, ...rest } = args
  if (name === 'joinQueue') return { phone: rest.phone, partySize: rest.partySize, name: rest.name, preference: rest.preference, source: 'self' }
  if (name === 'cancelEntry') return { entryId: rest.entryId, by: 'customer' }
  if (name === 'openSession' || name === 'myLoyalty') return { session }
  return rest
}

function scrubResult(role, name, result) {
  if (role === 'admin' || role === 'staff') return result
  const out = { ...result }
  for (const key of ['entry']) {
    if (out[key]) {
      const { phone, name: n, customerId, ...rest } = out[key]
      if (name !== 'joinQueue') delete rest.sessionToken // only the person who just joined gets their secret back
      out[key] = rest
    }
  }
  return out
}

// ───────────────────────── logins ─────────────────────────

const logins = new Map() // cookie token → { role, username, at }
const LOGIN_TTL = 12 * 3600 * 1000

function cookieOf(req, key) {
  const m = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(key + '='))
  return m ? decodeURIComponent(m.slice(key.length + 1)) : null
}
function roleOf(req) {
  const t = cookieOf(req, 'dfauth')
  const l = t && logins.get(t)
  if (!l) return 'public'
  if (Date.now() - l.at > LOGIN_TTL) { logins.delete(t); return 'public' }
  return l.role
}

const hits = new Map()
function limited(key, max, windowMs) {
  const now = Date.now()
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs)
  list.push(now)
  hits.set(key, list)
  return list.length > max
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref()

// ───────────────────────── live updates (Server-Sent Events) ─────────────────────────

const clients = new Set()
function broadcast() {
  for (const c of clients) {
    try {
      c.res.write(`event: state\ndata: ${viewJson(c.role)}\n\n`)
    } catch { clients.delete(c) }
  }
}
setInterval(() => {
  for (const c of clients) {
    try { c.res.write(': keep-alive\n\n') } catch { clients.delete(c) }
  }
}, 15000).unref()

// ───────────────────────── optional Power Automate alerts ─────────────────────────

const alertMemory = { queueHigh: false, delayed: new Set(), tables: null, noShows: new Set() }
function sendAlert(event, data) {
  if (!WEBHOOK) return
  fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event, restaurant: state.settings.restaurantName, at: new Date().toISOString(), ...data }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => { /* optional integration: never affects the app */ })
}
function checkAlerts(s) {
  const tableNow = Object.fromEntries(s.tables.map((t) => [t.id, t.status]))
  if (!alertMemory.tables) { alertMemory.tables = tableNow; s.queue.forEach((q) => q.status === 'no_show' && alertMemory.noShows.add(q.id)) } // first run: remember, do not alert
  if (!WEBHOOK) { alertMemory.tables = tableNow; return }
  const waiting = s.queue.filter((q) => q.status === 'waiting').length
  const limit = s.settings.queueAlertThreshold
  if (waiting >= limit && !alertMemory.queueHigh) { alertMemory.queueHigh = true; sendAlert('queue_threshold_exceeded', { waiting, threshold: limit }) }
  if (waiting < limit) alertMemory.queueHigh = false
  const now = Date.now()
  for (const t of s.tasks) {
    if (t.status === 'preparing' && now - t.startedAt > (t.durationMin + 3) * 60000 && !alertMemory.delayed.has(t.id)) {
      alertMemory.delayed.add(t.id)
      sendAlert('kitchen_order_delayed', { dish: t.itemName, station: t.station, table: t.tableId, minutesLate: Math.round((now - t.startedAt) / 60000 - t.durationMin) })
    }
  }
  for (const t of s.tables) {
    if (t.status === 'available' && alertMemory.tables[t.id] && alertMemory.tables[t.id] !== 'available') sendAlert('table_available', { table: t.id, capacity: t.capacity })
  }
  for (const q of s.queue) {
    if (q.status === 'no_show' && !alertMemory.noShows.has(q.id)) { alertMemory.noShows.add(q.id); if (!q.history) sendAlert('customer_no_show', { token: q.id, partySize: q.partySize, table: q.tableId }) }
  }
  alertMemory.tables = tableNow
}

// ───────────────────────── HTTP helpers ─────────────────────────

function sendJson(res, status, body, headers = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers })
  res.end(data)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > 1_000_000) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}) } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })) }
    })
    req.on('error', reject)
  })
}

// Public https address from START_ONLINE (Cloudflare tunnel). Kept in memory only, so a dead tunnel
// address never stays in the saved data.
let tunnelUrl = ''

function resolvedBaseUrl() {
  return state.settings.publicBaseUrl || tunnelUrl || env.PUBLIC_BASE_URL || lanUrls()[0] || `http://localhost:${PORT}`
}

// ───────────────────────── API ─────────────────────────

async function handleApi(req, res, pathname) {
  const ip = req.socket.remoteAddress || 'unknown'
  const role = roleOf(req)

  if (req.method === 'GET' && pathname === '/api/health') return sendJson(res, 200, { ok: true, rev: state.meta.rev })

  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, {
      mode: 'server',
      publicBaseUrl: resolvedBaseUrl(),
      tunnelUrl,
      lanUrls: lanUrls(),
      powerAutomate: !!WEBHOOK,
    })
  }

  if (req.method === 'GET' && pathname === '/api/me') {
    const l = logins.get(cookieOf(req, 'dfauth'))
    return sendJson(res, 200, role === 'public' ? { role: null } : { role, username: l?.username })
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    if (clients.size > 300) return sendJson(res, 503, { error: 'Too many open screens' })
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    res.write(`retry: 2000\nevent: state\ndata: ${viewJson(role)}\n\n`)
    const client = { res, role }
    clients.add(client)
    req.on('close', () => clients.delete(client))
    return
  }

  if (req.method === 'GET' && pathname === '/api/state') return sendJson(res, 200, JSON.parse(viewJson(role)))

  if (req.method === 'POST' && pathname === '/api/login') {
    if (limited('login:' + ip, 10, 60000)) return sendJson(res, 429, { ok: false, error: 'Too many attempts. Wait a minute.' })
    const { username, pin } = await readBody(req)
    const account = ACCOUNTS.find((a) => a.username === String(username || '').trim().toLowerCase() && safeEqual(a.pin, String(pin || '')))
    if (!account) return sendJson(res, 401, { ok: false, error: 'Wrong username or PIN' })
    const token = crypto.randomBytes(32).toString('hex')
    logins.set(token, { role: account.role, username: account.username, at: Date.now() })
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
    return sendJson(res, 200, { ok: true, role: account.role, username: account.username }, { 'Set-Cookie': `dfauth=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${LOGIN_TTL / 1000}${secure}` })
  }

  if (req.method === 'POST' && pathname === '/api/logout') {
    logins.delete(cookieOf(req, 'dfauth'))
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'dfauth=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' })
  }

  if (req.method === 'POST' && pathname === '/api/kiosk-exit') {
    if (limited('kiosk:' + ip, 8, 60000)) return sendJson(res, 429, { ok: false, error: 'Too many attempts. Wait a minute.' })
    const { pin } = await readBody(req)
    return sendJson(res, 200, { ok: safeEqual(state.settings.kioskPin, String(pin || '')) })
  }

  if (req.method === 'POST' && pathname === '/api/act') {
    if (limited('act:' + ip, 240, 60000)) return sendJson(res, 429, { ok: false, error: 'Too many requests. Please slow down.' })
    const body = await readBody(req)
    const name = body.name
    const args = body.args && typeof body.args === 'object' ? body.args : {}
    if (typeof name !== 'string' || !Object.hasOwn(ACTIONS, name)) return sendJson(res, 400, { ok: false, error: 'Unknown action' })
    if (name === 'joinQueue' && role === 'public' && limited('join:' + ip, 15, 60000)) return sendJson(res, 429, { ok: false, error: 'Too many registrations from this device.' })
    const denied = authorize(role, name, args)
    if (denied) return sendJson(res, denied.status, { ok: false, error: denied.error })
    const safeArgs = sanitize(role, name, { ...args })
    if (name === 'payOrder') {
      safeArgs.mode = 'demo' // simulated payment only
    }
    try {
      if (name === 'myLoyalty') return sendJson(res, 200, { ok: true, rev: state.meta.rev, ...ACTIONS[name](state, safeArgs, Date.now()) }) // read-only: no new revision
      const result = commit((draft, now) => ACTIONS[name](draft, safeArgs, now))
      if (name === 'payOrder' && safeArgs.outcome === 'fail') sendAlert('payment_failed', { order: result.order?.orderNo || safeArgs.orderId, amount: result.order?.total })
      return sendJson(res, 200, { ok: true, rev: state.meta.rev, ...scrubResult(role, name, result) })
    } catch (e) {
      return sendJson(res, 200, { ok: false, error: e.message || 'Something went wrong' })
    }
  }

  // START_ONLINE tells the server its public https address; QR codes then use it. Local scripts only (secret file).
  if (req.method === 'POST' && pathname === '/api/public-url') {
    const secret = req.headers['x-dineflow-secret']
    if (!secret || !safeEqual(secret, ADMIN_SECRET)) return sendJson(res, 403, { ok: false, error: 'Not allowed' })
    const { url } = await readBody(req)
    if (url && !/^https:\/\/[a-z0-9.-]+$/i.test(String(url))) return sendJson(res, 400, { ok: false, error: 'Expected an https address' })
    tunnelUrl = url ? String(url) : ''
    commit(() => ({})) // push a new revision so open screens redraw their QR codes
    return sendJson(res, 200, { ok: true, url: tunnelUrl })
  }

  if (req.method === 'POST' && pathname === '/api/reset') {
    const allowed = role === 'admin' || (req.headers['x-dineflow-secret'] && safeEqual(req.headers['x-dineflow-secret'], ADMIN_SECRET))
    if (!allowed) return sendJson(res, 403, { ok: false, error: 'Admin only' })
    const fresh = createSeedState(Date.now(), '')
    fresh.meta.rev = (state.meta.rev || 0) + 1
    state = fresh
    alertMemory.delayed.clear()
    alertMemory.tables = null
    afterChange()
    return sendJson(res, 200, { ok: true })
  }

  return sendJson(res, 404, { ok: false, error: 'Not found' })
}

// ───────────────────────── static files (the built web app) ─────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain',
}

function serveStatic(req, res, pathname) {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    res.writeHead(503, { 'Content-Type': 'text/plain' })
    return res.end('DineFlow has not been built yet. Run: npm run build')
  }
  let rel = decodeURIComponent(pathname)
  if (rel === '/kiosk' || rel.startsWith('/kiosk/')) rel = '/kiosk.html' // the kiosk is its own page
  let file = path.normalize(path.join(DIST, rel))
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end() } // no path traversal
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (path.extname(rel)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found') }
    file = path.join(DIST, 'index.html') // single-page-app routes
  }
  const ext = path.extname(file)
  const immutable = file.includes(`${path.sep}assets${path.sep}`)
  res.writeHead(200, {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(file).pipe(res)
}

// ───────────────────────── start ─────────────────────────

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname)
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end() }
    serveStatic(req, res, pathname)
  } catch (e) {
    if (!res.headersSent) sendJson(res, e.status || 500, { ok: false, error: e.status ? e.message : 'Server error' })
    else res.end()
    if (!e.status) console.error(e)
  }
})
server.on('clientError', (_, socket) => socket.destroy())

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is DineFlow already running? Use STOP_DEMO first, or set PORT in .env.`)
  else console.error(e)
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  fs.writeFileSync(PID_FILE, String(process.pid))
  console.log(`DineFlow server running on port ${PORT}`)
  console.log(`  local:   http://localhost:${PORT}`)
  lanUrls().forEach((u) => console.log(`  network: ${u}`))
})

function shutdown() {
  persistNow()
  try { fs.unlinkSync(PID_FILE) } catch { /* already gone */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
