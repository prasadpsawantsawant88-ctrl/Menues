// Starts DineFlow in the background, prints the addresses and opens the browser.
// Used by START_DEMO / INSTALL_AND_START. Safe to run twice.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(ROOT)

const major = Number(process.versions.node.split('.')[0])
if (major < 20) {
  console.error(`\nDineFlow needs Node.js 20 or newer (you have ${process.versions.node}).\nInstall the LTS version from https://nodejs.org and run this again.\n`)
  process.exit(1)
}

// 1. settings file
if (!fs.existsSync('.env') && fs.existsSync('.env.example')) {
  fs.copyFileSync('.env.example', '.env')
  console.log('Created .env with demo settings.')
}
const env = {}
for (const line of fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const PORT = Number(process.env.PORT || env.PORT || 5173)
const dataDir = path.resolve(process.env.DATA_DIR || env.DATA_DIR || 'data')
fs.mkdirSync(dataDir, { recursive: true })

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (args) => spawnSync(npm, args, { stdio: 'inherit', shell: process.platform === 'win32' })

// 2. dependencies and build (only when needed)
// The package ships with a built app. Rebuild only if it is missing (INSTALL_AND_START always rebuilds).
const needsBuild = !fs.existsSync('dist/index.html') || !fs.existsSync('dist/kiosk.html')
if (needsBuild) {
  if (!fs.existsSync('node_modules')) {
    console.log('Installing packages (first time only, needs internet)…')
    if (run(['install', '--no-audit', '--no-fund']).status !== 0) { console.error('\nnpm install failed. Check your internet connection and try again.'); process.exit(1) }
  }
  console.log('Building the app…')
  if (run(['run', 'build']).status !== 0) { console.error('\nBuild failed.'); process.exit(1) }
}

// 3. start (or reuse) the server
const health = async () => {
  try { return (await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}
if (await health()) {
  console.log('DineFlow is already running.')
} else {
  const log = fs.openSync(path.join(dataDir, 'server.log'), 'a')
  const child = spawn(process.execPath, ['server/server.mjs'], { detached: true, stdio: ['ignore', log, log], env: { ...process.env, PORT: String(PORT) }, windowsHide: true })
  child.unref()
  let up = false
  for (let i = 0; i < 40 && !up; i++) { await new Promise((r) => setTimeout(r, 250)); up = await health() }
  if (!up) { console.error(`\nThe server did not start. See ${path.join(dataDir, 'server.log')} for the reason.`); process.exit(1) }
}

// 4. addresses
const cfg = await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json()
const net = cfg.lanUrls?.[0] || null
const share = cfg.publicBaseUrl || net
const pad = (s) => s.padEnd(15)
console.log('\n================  DineFlow is running  ================')
console.log(`${pad('MAIN:')} http://localhost:${PORT}`)
console.log(`${pad('KIOSK:')} http://localhost:${PORT}/kiosk`)
console.log(`${pad('STAFF:')} http://localhost:${PORT}/staff      (staff / ${env.STAFF_PIN || '1111'})`)
console.log(`${pad('KITCHEN:')} http://localhost:${PORT}/kitchen    (kitchen / ${env.KITCHEN_PIN || '2222'})`)
console.log(`${pad('ADMIN:')} http://localhost:${PORT}/admin      (admin / ${env.ADMIN_PIN || '9999'})`)
console.log(share
  ? `${pad('MOBILE NETWORK:')} ${share}\n${pad('PHONE KIOSK:')} ${share}/kiosk\n  (phones must be on the same Wi-Fi as this computer)`
  : `${pad('MOBILE NETWORK:')} not detected. Connect this computer to Wi-Fi, then run START_DEMO again.`)
console.log('Stop with STOP_DEMO. Reset the demo with RESET_DEMO.')
console.log('=======================================================\n')

// 5. open the browser
if (!process.env.NO_BROWSER) {
  const url = `http://localhost:${PORT}`
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  try { spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).on('error', () => {}).unref() } catch { /* no browser available */ }
}
