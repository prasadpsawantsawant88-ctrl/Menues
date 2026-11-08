// Stops the DineFlow server started by START_DEMO. Data is saved before it exits.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pidFile = path.join(path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')), 'dineflow.pid')
if (!fs.existsSync(pidFile)) { console.log('DineFlow is not running.'); process.exit(0) }
const pid = Number(fs.readFileSync(pidFile, 'utf8'))
try {
  process.kill(pid, 'SIGTERM')
  console.log('DineFlow stopped. Your demo data is kept.')
} catch {
  console.log('DineFlow was not running.')
}
try { fs.unlinkSync(pidFile) } catch { /* already gone */ }
