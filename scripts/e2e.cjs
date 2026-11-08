// Multi-device end-to-end test: one DineFlow server, separate browser "devices" (kiosk phone,
// customer phone, staff laptop, kitchen screen). Run: node scripts/e2e.cjs   (needs `npm run build` first)
const { chromium, devices } = require('playwright')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const PORT = 5188
const children = []
process.on('exit', () => children.forEach((c) => { try { c.kill('SIGKILL') } catch { /* gone */ } }))
const BASE = `http://localhost:${PORT}`
const SHOTS = process.env.SHOTS
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
let passed = 0
const failures = []
const check = (name, ok, extra = '') => { if (ok) passed++; else failures.push(name + (extra ? ` (${extra})` : '')); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : extra ? '  → ' + extra : ''}`) }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }) }

;(async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dineflow-e2e-'))
  const server = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: 'ignore' })
  children.push(server)
  for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)) }

  const browser = await chromium.launch()
  const errors = []
  const device = async (opts, label) => {
    const ctx = await browser.newContext(opts)
    const page = await ctx.newPage()
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errors.push(`${label}: ${m.text()}`) })
    return { ctx, page }
  }
  const kiosk = await device({ ...devices['Pixel 7'] }, 'kiosk')
  const phone = await device({ ...devices['iPhone 13'] }, 'customer')
  const staff = await device({ viewport: { width: 1366, height: 800 } }, 'staff')
  const kitchen = await device({ viewport: { width: 1280, height: 800 } }, 'kitchen')

  try {
    // ── the kiosk is a plain website page
    const k = kiosk.page
    await k.goto(BASE + '/kiosk')
    await k.waitForSelector('text=Tap to join the queue')
    await shot(k, '01-kiosk-idle')

    // ── public https link (what START_ONLINE sets): QR codes must use it
    const adminSecret = fs.readFileSync(path.join(dataDir, 'admin-secret.txt'), 'utf8').trim()
    const setTunnel = (url) => fetch(BASE + '/api/public-url', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dineflow-secret': adminSecret }, body: JSON.stringify({ url }) }).then((r) => r.json())
    check('public link cannot be set without the local secret', (await fetch(BASE + '/api/public-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://evil.example.com' }) })).status === 403)
    check('server accepts the tunnel address', (await setTunnel('https://demo-tunnel.trycloudflare.com')).ok)
    await k.reload()
    await k.waitForSelector('text=Tap to join the queue')

    // ── register at the kiosk
    await k.click('text=Tap to join the queue')
    await k.waitForSelector('text=Join the queue')
    for (const d of '9876543210') await k.click(`button:text-is("${d}")`)
    await k.click('button[aria-label="More people"]') // party of 3
    await shot(k, '02-kiosk-register')
    await k.click('text=Get my token & QR code')
    await k.waitForSelector('text=Scan this QR code with your phone camera')
    const token = (await k.textContent('.font-display.text-6xl')).trim()
    const url = (await k.locator('.break-all').first().textContent()).trim()
    await shot(k, '03-kiosk-token')
    check('kiosk shows a token', /^Q\d{3}$/.test(token), token)
    check('QR URL is /queue/session/<secret>', /\/queue\/session\/[A-Za-z0-9_-]{32}$/.test(url), url)
    check('QR URL uses the public https link', url.startsWith('https://demo-tunnel.trycloudflare.com/queue/session/'), url)
    check('QR URL has no phone number and no localhost', !url.includes('9876543210') && !/localhost|127\.0\.0\.1/.test(url), url)
    check('Simulate Customer Scan and Copy URL buttons exist', (await k.locator('text=Simulate customer scan').count()) === 1 && (await k.locator('text=Copy customer URL').count()) === 1)

    // duplicate phone is refused (no link hand-over)
    const dup = await fetch(BASE + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'joinQueue', args: { phone: '9876543210', partySize: 2 } }) }).then((r) => r.json())
    check('same phone cannot fetch the existing personal link', dup.ok === false)

    await setTunnel(null)

    // ── customer phone scans the QR (a different device)
    const secret = url.split('/').pop()
    const p = phone.page
    await p.goto(`${BASE}/queue/session/${secret}`)
    await p.waitForURL(new RegExp(`/queue/${token}$`))
    await p.waitForSelector(`text=Token ${token}`)
    await shot(p, '04-customer-queue')
    check('scan opens the personal queue page', true)
    await k.waitForSelector('text=Connected to your phone', { timeout: 8000 })
    check('kiosk shows "scanned" after the customer opens the link', true)
    await shot(k, '05-kiosk-scanned')

    // ── stranger without the secret cannot act on that entry
    const stranger = await fetch(BASE + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'cancelEntry', args: { entryId: token } }) }).then((r) => r.json())
    check('someone without the secret cannot cancel the entry', stranger.ok === false)

    // ── staff sees the entry (no phone number), signs in
    const s = staff.page
    await s.goto(BASE + '/staff')
    await s.fill('input[placeholder=Username]', 'staff')
    await s.fill('input[placeholder=PIN]', '1111')
    await s.click('button:text-is("Sign in")')
    await s.waitForSelector(`text=${token}`)
    await shot(s, '06-staff')
    check('staff dashboard shows the new token live', true)
    check('staff screen does not show the phone number', !(await s.content()).includes('9876543210'))

    // ── customer pre-orders and pays (demo payment)
    await p.waitForSelector('text=Pre-order while you wait')
    await p.locator('button:text-is("Add")').first().click()
    const customAdd = p.locator('button:has-text("Add ·")')
    if (await customAdd.count()) await customAdd.first().click() // dish with options: accept the defaults
    await p.locator('button:has-text("View cart"), button:has(svg) >> text=/cart/i').first().click().catch(async () => { await p.locator('.fixed button.bg-brand-600').first().click() })
    await p.locator('button:has-text("Proceed to payment")').click()
    await p.waitForSelector('text=Demo payment')
    await shot(p, '07-customer-payment')
    await p.locator('button:has-text("Pay ₹")').click()
    await p.waitForSelector('text=Payment successful', { timeout: 5000 })
    await shot(p, '07b-payment-success')
    check('Pay shows "Payment successful"', true)
    await p.waitForSelector('text=/Pre-order confirmed/', { timeout: 10000 })
    check('customer moves on to the next page after payment', true)

    // ── the database file holds everything (kiosk registration + order + payment)
    await new Promise((r) => setTimeout(r, 900))
    const db = JSON.parse(fs.readFileSync(path.join(dataDir, 'demo-db.json'), 'utf8'))
    const row = db.queue.find((q) => q.id === token)
    check('database: kiosk registration saved (phone, party, status)', row && row.phone === '9876543210' && row.partySize === 3 && row.status === 'waiting')
    const orderRow = db.orders.find((o) => o.queueEntryId === token)
    check('database: order saved as paid', orderRow && orderRow.paymentStatus === 'paid')
    check('database: payment record saved', db.payments.some((x) => x.orderId === orderRow.id && x.status === 'paid'))
    check('database: kitchen tasks created for the order', db.tasks.some((t) => t.orderId === orderRow.id))
    const adminLogin = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', pin: '9999' }) })
    const adminCookie = adminLogin.headers.get('set-cookie').split(';')[0]
    const adminState = await fetch(BASE + '/api/state', { headers: { cookie: adminCookie } }).then((r) => r.json())
    check('admin interface sees the same registration, payment and tasks', adminState.queue.some((q) => q.id === token) && adminState.payments.some((x) => x.orderId === orderRow.id) && adminState.tasks.some((t) => t.orderId === orderRow.id))

    // ── kitchen (own login) sees the dish scheduled for the seating time
    const kt = kitchen.page
    await kt.goto(BASE + '/kitchen')
    await kt.fill('input[placeholder=Username]', 'kitchen')
    await kt.fill('input[placeholder=PIN]', '2222')
    await kt.click('button:text-is("Sign in")')
    await kt.waitForSelector('text=/Scheduled|Station|station/', { timeout: 8000 })
    await shot(kt, '08-kitchen')
    check('kitchen display shows the pre-ordered dish', (await kt.content()).includes(token) || (await kt.locator('text=/Q\\d{3}/').count()) > 0)

    // ── staff seats the group (API with the staff cookie), customer + kitchen update live
    const cookies = await staff.ctx.cookies()
    const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const act = (name, args) => fetch(BASE + '/api/act', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ name, args }) }).then((r) => r.json())
    const state = await fetch(BASE + '/api/state', { headers: { cookie } }).then((r) => r.json())
    let free = state.tables.find((t) => t.status === 'available' && t.capacity >= 3)
    if (!free) { // the seeded evening is busy: guests at one table finish, it is cleaned and becomes available
      const busy = state.tables.find((t) => t.status === 'occupied' && t.capacity >= 3)
      await act('endSession', { tableId: busy.id })
      await act('setTableStatus', { tableId: busy.id, status: 'available' })
      free = busy
    }
    {
      const a = await act('allocateTable', { entryId: token, tableId: free.id })
      check('staff allocates a table', a.ok, a.error)
      await p.waitForSelector('text=Your table is ready', { timeout: 8000 })
      check('customer phone shows "table ready" without refreshing', true)
      await shot(p, '09-customer-called')
      const seat = await act('seatEntry', { entryId: token })
      check('staff marks seated', seat.ok, seat.error)
    }

    // ── persistence: state survives a server restart
    const before = await fetch(BASE + '/api/state').then((r) => r.json())
    server.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 800))
    const again = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: 'ignore' }); children.push(again)
    for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)) }
    const after = await fetch(BASE + '/api/state').then((r) => r.json())
    check('data survives a server restart', after.queue.some((q) => q.id === token) && after.queue.length === before.queue.length)
    // customer phone reconnects by itself
    await p.waitForTimeout(3500)
    check('customer page recovers after the restart', (await p.locator(`text=Token ${token}`).count()) === 1)
    again.kill('SIGTERM')

    // ── kiosk PIN exit
    const server2 = spawn(process.execPath, ['server/server.mjs'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir }, stdio: 'ignore' }); children.push(server2)
    for (let i = 0; i < 40; i++) { try { if ((await fetch(BASE + '/api/health')).ok) break } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)) }
    await k.goto(BASE + '/kiosk')
    await k.waitForSelector('text=Tap to join the queue')
    for (let i = 0; i < 5; i++) await k.click('button[aria-label="Restaurant logo"]')
    await k.waitForSelector('text=Staff PIN to exit kiosk')
    for (const d of '0000') await k.click(`.grid button:text-is("${d}")`)
    await k.click('button:text-is("Unlock")')
    await k.waitForSelector('text=Wrong PIN')
    check('kiosk refuses a wrong exit PIN', true)
    for (const d of '1234') await k.click(`.grid button:text-is("${d}")`)
    await k.click('button:text-is("Unlock")')
    await k.waitForSelector('text=Kiosk unlocked', { timeout: 5000 })
    check('kiosk unlocks with the right PIN', true)
    server2.kill('SIGTERM')
  } catch (e) {
    check('flow completed without exception', false, e.message.split('\n')[0])
  }

  check('no browser errors on any device', errors.length === 0, errors.slice(0, 3).join(' | '))
  await browser.close()
  server.kill('SIGTERM')
  console.log(`\n${passed} passed, ${failures.length} failed`)
  if (failures.length) console.log('Failures:\n - ' + failures.join('\n - '))
  process.exit(failures.length ? 1 : 0)
})()
