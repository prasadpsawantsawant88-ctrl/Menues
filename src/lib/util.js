// Small helpers shared by the UI, the engines and the test script.

export const MIN = 60 * 1000

export function fmtTime(ms) {
  if (!ms) return '—'
  return new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}

export function fmtDate(ms) {
  return new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export function fmtMoney(n) {
  return '₹' + Math.round(n || 0).toLocaleString('en-IN')
}

export function minutesFrom(ms, now) {
  return Math.max(0, Math.ceil((ms - now) / MIN))
}

export function fmtDuration(min) {
  if (min == null) return '—'
  if (min < 1) return '< 1 min'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

// Indian mobile numbers: 10 digits starting with 6-9 (optional +91 / 0 prefix is stripped).
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-()]/g, '')
  if (p.startsWith('+91')) p = p.slice(3)
  else if (p.startsWith('91') && p.length === 12) p = p.slice(2)
  else if (p.startsWith('0') && p.length === 11) p = p.slice(1)
  return p
}

export function isValidPhone(raw) {
  return /^[6-9]\d{9}$/.test(normalizePhone(raw))
}

// Staff screens show a masked number so phone numbers are not exposed unnecessarily.
export function maskPhone(phone) {
  const p = normalizePhone(phone)
  if (p.length !== 10) return '••••••••••'
  return `+91 ${p.slice(0, 2)}•••••${p.slice(7)}`
}

export function cleanText(s, max = 60) {
  return String(s || '').replace(/[<>]/g, '').trim().slice(0, max)
}

export function pad(n, len = 3) {
  return String(n).padStart(len, '0')
}

// Tiny deterministic random generator so the seeded history is stable between resets.
export function makeRng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const STATUS_STYLES = {
  waiting: 'bg-amber-100 text-amber-800',
  called: 'bg-blue-100 text-blue-800',
  seated: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  abandoned: 'bg-slate-200 text-slate-700',
  no_show: 'bg-red-100 text-red-700',
  scheduled: 'bg-violet-100 text-violet-800',
  received: 'bg-sky-100 text-sky-800',
  preparing: 'bg-orange-100 text-orange-800',
  ready: 'bg-emerald-100 text-emerald-800',
  served: 'bg-slate-200 text-slate-700',
  pending_payment: 'bg-amber-100 text-amber-800',
  confirmed: 'bg-emerald-100 text-emerald-800',
  paid: 'bg-emerald-100 text-emerald-800',
  pending: 'bg-amber-100 text-amber-800',
  failed: 'bg-red-100 text-red-700',
  refunded: 'bg-slate-200 text-slate-700',
  refund_initiated: 'bg-slate-200 text-slate-700',
  available: 'bg-emerald-100 text-emerald-800',
  occupied: 'bg-rose-100 text-rose-800',
  reserved: 'bg-blue-100 text-blue-800',
  cleaning: 'bg-amber-100 text-amber-800',
  blocked: 'bg-slate-300 text-slate-700',
}

export const STATUS_LABELS = {
  no_show: 'No-show',
  pending_payment: 'Awaiting payment',
  refund_initiated: 'Refund initiated (test)',
}

export function statusLabel(s) {
  return STATUS_LABELS[s] || String(s).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

// 24 random bytes → 32 URL-safe characters (192 bits). Used for personal queue links: unguessable,
// and deliberately unrelated to the phone number. Needs Web Crypto (browsers, Node 20+).
export function newSessionToken() {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  let bin = ''
  bytes.forEach((b) => (bin += String.fromCharCode(b)))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
