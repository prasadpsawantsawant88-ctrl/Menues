// Restores the original demo evening (queue, tables, orders, history). Works while the server runs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const line of fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}
const PORT = Number(process.env.PORT || env.PORT || 5173)
const dataDir = path.resolve(process.env.DATA_DIR || env.DATA_DIR || path.join(ROOT, 'data'))
const secretFile = path.join(dataDir, 'admin-secret.txt')

try {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/reset`, { method: 'POST', headers: { 'x-dineflow-secret': fs.readFileSync(secretFile, 'utf8').trim() }, signal: AbortSignal.timeout(5000) })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error)
  console.log('Demo data reset to the original evening.')
} catch (e) {
  if (e.code === 'ENOENT' || /fetch failed|ECONNREFUSED|timeout/i.test(String(e.message) + String(e.cause))) {
    // Server is not running: deleting the database file is enough, it is re-seeded on next start.
    const db = path.join(dataDir, 'demo-db.json')
    if (fs.existsSync(db)) fs.unlinkSync(db)
    console.log('DineFlow is not running. Demo data will start fresh next time you run START_DEMO.')
  } else {
    console.error('Reset failed:', e.message)
    process.exit(1)
  }
}
