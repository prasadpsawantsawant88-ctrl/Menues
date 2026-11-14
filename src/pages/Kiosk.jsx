import { useCallback, useEffect, useRef, useState } from 'react'
import { Delete, Expand, Lock, Shrink, Users, WifiOff } from 'lucide-react'
import { useStore, useNow } from '../lib/store.jsx'
import { predictEntry, predictWait } from '../lib/engines.js'
import { maxCapacity } from '../lib/actions.js'
import { isValidPhone, normalizePhone } from '../lib/util.js'
import { LogoMark } from '../components/Brand.jsx'
import QueueQr from '../components/QueueQr.jsx'

const IDLE_MS = 60 * 1000 // untouched registration screen → attract screen
const TOKEN_SCANNED_MS = 12 * 1000 // after the customer scans, free the screen quickly
const TOKEN_MAX_MS = 90 * 1000 // otherwise return to the start after this long

// ───────── device features: full screen, keep awake, install ─────────

function useFullscreen() {
  const [full, setFull] = useState(!!document.fullscreenElement)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', on)
    return () => document.removeEventListener('fullscreenchange', on)
  }, [])
  const enter = useCallback(async () => {
    try { await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }) } catch { /* not allowed on this device (e.g. iPhone Safari) */ }
  }, [])
  const exit = useCallback(async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen() } catch { /* ignore */ }
  }, [])
  return { full, enter, exit, supported: !!document.documentElement.requestFullscreen }
}

// Keeps the screen awake. The browser releases the lock when the page is hidden, so ask again on return.
function useWakeLock() {
  const [active, setActive] = useState(false)
  const lock = useRef(null)
  const request = useCallback(async () => {
    if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return
    try {
      lock.current = await navigator.wakeLock.request('screen')
      setActive(true)
      lock.current.addEventListener('release', () => setActive(false))
    } catch { setActive(false) }
  }, [])
  useEffect(() => {
    request()
    const on = () => document.visibilityState === 'visible' && request()
    document.addEventListener('visibilitychange', on)
    document.addEventListener('pointerdown', on, { once: true }) // some browsers only allow it after a touch
    return () => { document.removeEventListener('visibilitychange', on); lock.current?.release?.() }
  }, [request])
  return active
}

// ───────── PIN pad (staff exit) ─────────

function PinPad({ title, onSubmit, onCancel, error, busy }) {
  const [pin, setPin] = useState('')
  const press = (d) => setPin((p) => (p.length < 8 ? p + d : p))
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-4">
      <div className="w-full max-w-xs rounded-3xl bg-white p-5 text-center shadow-xl">
        <Lock className="mx-auto text-brand-600" />
        <h2 className="mt-2 text-lg font-extrabold">{title}</h2>
        <div className="my-3 flex h-10 items-center justify-center gap-2" aria-label="PIN entered">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => <span key={i} className={`h-3 w-3 rounded-full ${i < pin.length ? 'bg-brand-600' : 'bg-line'}`} />)}
        </div>
        {error && <div className="mb-2 text-sm font-semibold text-red-600">{error}</div>}
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className="h-14 rounded-2xl bg-surface text-xl font-bold active:bg-brand-100" onClick={() => press(d)}>{d}</button>)}
          <button className="h-14 rounded-2xl bg-surface font-bold text-muted active:bg-brand-100" onClick={onCancel}>Cancel</button>
          <button className="h-14 rounded-2xl bg-surface text-xl font-bold active:bg-brand-100" onClick={() => press('0')}>0</button>
          <button className="flex h-14 items-center justify-center rounded-2xl bg-surface active:bg-brand-100" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete"><Delete size={20} /></button>
        </div>
        <button className="btn-primary mt-3 w-full !py-3 text-base" disabled={pin.length < 4 || busy} onClick={async () => { await onSubmit(pin); setPin('') }}>{busy ? 'Checking…' : 'Unlock'}</button>
      </div>
    </div>
  )
}

// ───────── screens ─────────

function Idle({ state, now, onStart }) {
  const p2 = predictWait(state, { partySize: 2 }, now)
  const p4 = predictWait(state, { partySize: 4 }, now)
  const waiting = state.queue.filter((q) => q.status === 'waiting').length
  return (
    <button onClick={onStart} className="flex min-h-full w-full flex-col items-center justify-center gap-6 bg-gradient-to-b from-brand-600 to-navy p-6 text-center text-white">
      <LogoMark size={96} white />
      <div>
        <div className="font-brand text-5xl font-bold">{state.settings.restaurantName}</div>
        <div className="mt-2 text-lg opacity-90">Skip the crowd. Join the queue from here.</div>
      </div>
      <div className="grid w-full max-w-sm grid-cols-3 gap-2 rounded-3xl bg-white/10 p-4">
        <div><div className="text-3xl font-extrabold tabular">{waiting}</div><div className="text-xs opacity-80">groups waiting</div></div>
        <div><div className="text-3xl font-extrabold tabular">{p2.waitMin ?? '–'}<span className="text-sm"> min</span></div><div className="text-xs opacity-80">wait for 2</div></div>
        <div><div className="text-3xl font-extrabold tabular">{p4.waitMin ?? '–'}<span className="text-sm"> min</span></div><div className="text-xs opacity-80">wait for 4</div></div>
      </div>
      <span className="rounded-full bg-white px-8 py-4 text-xl font-extrabold text-brand-700">Tap to join the queue</span>
    </button>
  )
}

function Register({ state, now, act, onDone, connected }) {
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [name, setName] = useState('')
  const [preference, setPreference] = useState('Any')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const requestId = useRef(`kiosk-${Date.now()}`)
  const cap = maxCapacity(state)
  const preview = predictWait(state, { partySize: party, preference }, now)
  const ok = isValidPhone(phone)
  const digits = normalizePhone(phone)

  const key = (d) => setPhone((p) => (normalizePhone(p + d).length <= 10 ? p + d : p))
  const submit = async () => {
    if (!ok || busy || !connected) return
    setBusy(true)
    setError('')
    const r = await act('joinQueue', { phone, partySize: party, name, preference })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    onDone(r)
  }

  return (
    <div className="mx-auto grid min-h-full w-full max-w-3xl gap-4 p-4 md:grid-cols-2 md:items-start">
      <div className="space-y-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold">Join the queue</h1>
          <p className="text-sm text-muted">Enter your mobile number. We use it only to avoid duplicate entries; nothing is sent to your phone.</p>
        </div>
        <div className={`rounded-2xl border-2 bg-white px-4 py-3 text-center text-3xl font-extrabold tabular tracking-wider ${phone && !ok ? 'border-amber-400' : 'border-line'}`} aria-label="Mobile number">
          {phone ? digits.replace(/(\d{5})(\d{0,5})/, '$1 $2') : <span className="text-muted/50">98765 43210</span>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => <button key={d} className="h-14 rounded-2xl bg-white text-2xl font-bold shadow-sm active:bg-brand-100" onClick={() => key(d)}>{d}</button>)}
          <button className="h-14 rounded-2xl bg-white font-bold text-muted shadow-sm active:bg-brand-100" onClick={() => setPhone('')}>Clear</button>
          <button className="h-14 rounded-2xl bg-white text-2xl font-bold shadow-sm active:bg-brand-100" onClick={() => key('0')}>0</button>
          <button className="flex h-14 items-center justify-center rounded-2xl bg-white shadow-sm active:bg-brand-100" onClick={() => setPhone((p) => p.slice(0, -1))} aria-label="Delete"><Delete size={22} /></button>
        </div>
        {phone && !ok && <div className="text-sm font-semibold text-amber-700">Enter a 10-digit mobile number starting with 6–9.</div>}
      </div>

      <div className="space-y-4">
        <div className="card p-4">
          <div className="text-xs font-bold uppercase text-muted">How many people?</div>
          <div className="mt-2 flex items-center gap-3">
            <button className="h-14 w-14 rounded-full bg-surface text-3xl font-bold active:bg-brand-100" onClick={() => setParty(Math.max(1, party - 1))} aria-label="Fewer people">−</button>
            <div className="flex-1 text-center text-4xl font-extrabold tabular"><Users size={22} className="mr-2 inline text-muted" />{party}</div>
            <button className="h-14 w-14 rounded-full bg-surface text-3xl font-bold active:bg-brand-100" onClick={() => setParty(Math.min(cap, party + 1))} aria-label="More people">+</button>
          </div>
        </div>
        <div className="flex gap-2">
          {['Any', ...state.layout.zones.map((z) => z.name)].map((p) => <button key={p} onClick={() => setPreference(p)} className={`flex-1 rounded-full border py-3 text-sm font-bold ${preference === p ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line bg-white'}`}>{p}</button>)}
        </div>
        <input className="input !py-3 text-base" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
        <div className="rounded-2xl bg-brand-50 p-4">
          <div className="text-xs font-bold uppercase text-brand-700">Estimated wait for {party}</div>
          <div className="text-3xl font-extrabold tabular text-brand-700">{preview.possible ? (preview.waitMin === 0 ? 'A table is free' : `About ${preview.waitMin} min`) : 'Please ask the host'}</div>
          <div className="text-xs text-muted">Estimate only. It changes as tables free up.</div>
        </div>
        {error && <div className="rounded-2xl bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        <button className="btn-primary w-full !py-4 text-lg" disabled={!ok || busy || !connected || !preview.possible} onClick={submit}>{busy ? 'Registering…' : 'Get my token & QR code'}</button>
        {!connected && <div className="text-center text-sm font-semibold text-amber-700">Waiting for the restaurant server…</div>}
      </div>
    </div>
  )
}

function Token({ result, state, now, onNext }) {
  const entry = state.queue.find((q) => q.id === result.entry.id) || result.entry
  const wait = predictEntry(state, entry, now)?.waitMin
  const scanned = !!entry.sessionOpenedAt
  const [left, setLeft] = useState(TOKEN_MAX_MS / 1000)
  useEffect(() => {
    const ms = scanned ? TOKEN_SCANNED_MS : TOKEN_MAX_MS
    setLeft(Math.round(ms / 1000))
    const id = setInterval(() => setLeft((s) => s - 1), 1000)
    return () => clearInterval(id)
  }, [scanned])
  useEffect(() => { if (left <= 0) onNext() }, [left, onNext])

  const seated = result.seatedImmediately
  return (
    <div className="mx-auto flex min-h-full w-full max-w-md flex-col items-center gap-4 p-4 text-center">
      <div>
        <div className="text-xs font-bold uppercase text-muted">Your token</div>
        <div className="font-display text-6xl font-extrabold tabular text-brand-700">{entry.id}</div>
        <div className="text-sm text-muted">Party of {entry.partySize}{entry.name ? ` · ${entry.name}` : ''}</div>
      </div>
      {seated ? (
        <div className="rounded-2xl bg-brand-600 p-4 text-white"><div className="text-sm font-bold">A table is free right now</div><div className="text-3xl font-extrabold">Table {result.table?.id}</div></div>
      ) : (
        <div className="rounded-2xl bg-brand-50 px-6 py-3"><div className="text-xs font-bold uppercase text-brand-700">Estimated wait</div><div className="text-3xl font-extrabold tabular text-brand-700">About {wait ?? '–'} min</div></div>
      )}
      {scanned ? (
        <div className="rounded-3xl bg-emerald-50 p-6 text-emerald-800"><div className="text-5xl">✓</div><div className="mt-1 text-xl font-extrabold">Connected to your phone</div><div className="text-sm">Follow your queue position there. You may put this phone down.</div></div>
      ) : (
        <>
          <div className="text-lg font-extrabold">Scan this QR code with your phone camera</div>
          <QueueQr secret={result.entry.sessionToken} expiresAt={entry.sessionExpiresAt} size={230} scanned={scanned} />
          <div className="text-xs text-muted">Your personal link opens your live queue page, menu and pre-order. It contains no phone number.</div>
        </>
      )}
      <button className="btn-primary w-full !py-4 text-lg" onClick={onNext}>Next customer</button>
      <div className="text-xs text-muted">This screen resets in {Math.max(0, left)} s so your QR code is not left on display.</div>
    </div>
  )
}

// ───────── the kiosk ─────────

export default function Kiosk() {
  const { state, act, connected, online, verifyKioskPin } = useStore()
  const now = useNow(5000)
  const { full, enter, exit, supported } = useFullscreen()
  const awake = useWakeLock()
  const [screen, setScreen] = useState('idle') // idle | register | token
  const [result, setResult] = useState(null)
  const [pinOpen, setPinOpen] = useState(false)
  const [pinError, setPinError] = useState('')
  const [pinBusy, setPinBusy] = useState(false)
  const [exited, setExited] = useState(false)
  const lastTouch = useRef(Date.now())
  const taps = useRef({ n: 0, t: 0 })

  // Idle timeout: an untouched registration screen goes back to the attract screen.
  useEffect(() => {
    const touch = () => { lastTouch.current = Date.now() }
    window.addEventListener('pointerdown', touch)
    window.addEventListener('keydown', touch)
    const id = setInterval(() => { if (screen === 'register' && Date.now() - lastTouch.current > IDLE_MS) setScreen('idle') }, 2000)
    return () => { window.removeEventListener('pointerdown', touch); window.removeEventListener('keydown', touch); clearInterval(id) }
  }, [screen])

  // Staff exit: tap the logo 5 times quickly, then enter the PIN.
  const logoTap = () => {
    const t = Date.now()
    taps.current = t - taps.current.t < 1500 ? { n: taps.current.n + 1, t } : { n: 1, t }
    if (taps.current.n >= 5) { taps.current = { n: 0, t: 0 }; setPinError(''); setPinOpen(true) }
  }
  const tryPin = async (pin) => {
    setPinBusy(true)
    const ok = await verifyKioskPin(pin)
    setPinBusy(false)
    if (!ok) return setPinError('Wrong PIN')
    setPinOpen(false)
    await exit()
    setExited(true)
  }

  const start = () => { enter(); lastTouch.current = Date.now(); setScreen('register') }
  const next = useCallback(() => { setResult(null); setScreen('idle') }, [])
  const showConnected = connected && online

  if (exited) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface p-6 text-center">
        <Lock className="text-brand-600" />
        <h1 className="font-display text-2xl font-extrabold">Kiosk unlocked</h1>
        <p className="max-w-xs text-sm text-muted">Full screen is off. Full screen is off. Return to the kiosk or open the staff pages.</p>
        <div className="flex flex-wrap justify-center gap-2">
          <button className="btn-primary" onClick={() => { setExited(false); setScreen('idle'); enter() }}>Return to kiosk</button>
          <a className="btn-ghost" href="/staff">Staff dashboard</a>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-surface text-ink" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex shrink-0 items-center gap-3 bg-navy px-4 py-2 text-white">
        <button onClick={logoTap} className="flex items-center gap-2 whitespace-nowrap font-display font-extrabold" aria-label="Restaurant logo">
          <LogoMark size={30} white /> <span className="font-brand text-xl">{state.settings.restaurantName}</span> <span className="text-xs font-semibold opacity-70">Kiosk</span>
        </button>
        <div className="flex-1" />
        <span className={`flex items-center gap-1.5 text-xs font-semibold ${showConnected ? 'text-emerald-300' : 'text-amber-300'}`}>
          <span className={`h-2.5 w-2.5 rounded-full ${showConnected ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'}`} /> {showConnected ? 'Connected' : 'Reconnecting…'}
        </span>
        {!awake && 'wakeLock' in navigator && <span className="hidden text-[10px] text-amber-300 sm:inline" title="Screen may sleep">screen may sleep</span>}
        {supported && <button className="rounded-full bg-white/15 p-1.5" onClick={full ? exit : enter} aria-label="Toggle full screen">{full ? <Shrink size={14} /> : <Expand size={14} />}</button>}
      </header>

      {!showConnected && (
        <div className="flex shrink-0 items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-xs font-bold text-white">
          <WifiOff size={14} /> {online ? 'Cannot reach the restaurant server.' : 'No Wi-Fi.'} Registration is paused and resumes automatically.
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto">
        {screen === 'idle' && <Idle state={state} now={now} onStart={start} />}
        {screen === 'register' && <Register state={state} now={now} act={act} connected={showConnected} onDone={(r) => { setResult(r); setScreen('token') }} />}
        {screen === 'token' && result && <Token result={result} state={state} now={now} onNext={next} />}
      </main>

      {pinOpen && <PinPad title="Staff PIN to exit kiosk" error={pinError} busy={pinBusy} onSubmit={tryPin} onCancel={() => setPinOpen(false)} />}
    </div>
  )
}
