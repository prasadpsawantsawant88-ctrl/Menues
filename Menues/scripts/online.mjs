// START_ONLINE: gives DineFlow a public https address with a free Cloudflare quick tunnel, so a customer's
// phone can open the QR link from ANY network (mobile data included), not just the restaurant Wi-Fi.
// Keep this window open while presenting. Needs internet. No Cloudflare account needed.
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

const env = {}
for (const line of fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const PORT = Number(process.env.PORT || env.PORT || 5173)
const dataDir = path.resolve(process.env.DATA_DIR || env.DATA_DIR || 'data')

// 1. make sure the local server is running (reuses scripts/launch.mjs, without opening a browser)
const started = spawnSync(process.execPath, ['scripts/launch.mjs'], { stdio: 'inherit', env: { ...process.env, NO_BROWSER: '1' } })
if (started.status !== 0) process.exit(started.status || 1)

// 2. find cloudflared: CLOUDFLARED_BIN, one on the PATH, or the copy the npm package downloads
async function findCloudflared() {
  if (process.env.CLOUDFLARED_BIN) return process.env.CLOUDFLARED_BIN
  const probe = spawnSync('cloudflared', ['--version'], { stdio: 'ignore' })
  if (!probe.error && probe.status === 0) return 'cloudflared'
  try {
    const mod = await import('cloudflared')
    if (!fs.existsSync(mod.bin)) { console.log('Downloading the Cloudflare tunnel program (one time)…'); await mod.install(mod.bin) }
    return mod.bin
  } catch (e) {
    console.error('\nCould not get the Cloudflare tunnel program:', e.message)
    console.error('Install it yourself from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ and run START_ONLINE again.')
    process.exit(1)
  }
}
const bin = await findCloudflared()

// 3. start the tunnel and read its public address
console.log('\nOpening the public tunnel… (needs internet)')
const tunnel = spawn(bin, ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { stdio: ['ignore', 'pipe', 'pipe'] })
const secret = fs.readFileSync(path.join(dataDir, 'admin-secret.txt'), 'utf8').trim()
const tell = (url) => fetch(`http://127.0.0.1:${PORT}/api/public-url`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-dineflow-secret': secret }, body: JSON.stringify({ url }) }).then((r) => r.json()).catch(() => ({}))

let publicUrl = ''
const onData = async (chunk) => {
  if (publicUrl) return
  const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)
  if (!m) return
  publicUrl = m[0]
  // the new address can take a few seconds to resolve everywhere
  let reachable = false
  for (let i = 0; i < 30 && !reachable; i++) {
    try { reachable = (await fetch(`${publicUrl}/api/health`, { signal: AbortSignal.timeout(4000) })).ok } catch { /* not yet */ }
    if (!reachable) await new Promise((r) => setTimeout(r, 2000))
  }
  const res = await tell(publicUrl)
  if (!res.ok) { console.error('The server did not accept the public address.'); shutdown(1) }
  console.log('\n===============  DineFlow is ONLINE  ===============')
  console.log(`PUBLIC LINK:   ${publicUrl}`)
  console.log(`PUBLIC KIOSK:  ${publicUrl}/kiosk   (open this on the kiosk phone)`)
  console.log(`STAFF:         ${publicUrl}/staff`)
  console.log('QR codes now open the public link, from any network.')
  if (!reachable) console.log('(The address did not answer yet; give it a minute and refresh.)')
  console.log('Keep this window open. Press Ctrl+C to go offline. The tunnel is free and has no uptime guarantee.')
  console.log('====================================================\n')
  if (!process.env.NO_BROWSER) {
    const url = `${publicUrl}/kiosk`
    const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
    try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref() } catch { /* no browser */ }
  }
}
tunnel.stdout.on('data', onData)
tunnel.stderr.on('data', onData)
tunnel.on('error', (e) => { console.error('Could not start the tunnel:', e.message); shutdown(1) })
tunnel.on('exit', () => { if (!closing) { console.log('The tunnel stopped. QR codes fall back to the Wi-Fi address.'); shutdown(0) } })
setTimeout(() => { if (!publicUrl) { console.error('\nNo public address after 60 seconds. Check your internet connection and run START_ONLINE again.'); shutdown(1) } }, 60000)

let closing = false
async function shutdown(code = 0) {
  if (closing) return
  closing = true
  await tell(null) // QR codes go back to the Wi-Fi address
  try { tunnel.kill() } catch { /* already gone */ }
  process.exit(code)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
