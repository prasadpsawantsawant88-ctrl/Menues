// The store: one shared "database" for all interfaces. Three ways to run, same API for the screens:
//
//  1. SERVER mode  – the DineFlow server (server/server.mjs) holds the state. Every screen, on every
//                    device, is a live view of it (Server-Sent Events). This is what the launchers use,
//                    and what lets a kiosk phone, a customer phone and a laptop work together.
//  2. LOCAL mode   – no server (npm run dev, or static hosting): state lives in this browser; tabs of the
//                    same browser sync through the `storage` event.
//  3. Optional Supabase mirror in LOCAL mode (src/lib/sync.js) for static hosting such as Cloudflare Pages.
//
// Every change goes through act(name, args). It is async in both modes and resolves to { ok, error?, ...result }.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ACTIONS, housekeeping } from './actions.js'
import { createSeedState, DEMO_ACCOUNTS } from './seed.js'
import { setPrepModel } from './engines.js'

// Wait-time estimates in the browser use the same learned prep-time model the server trained.
const useModel = (st) => setPrepModel(st && st.settings.useAiTimings !== false ? st.ml || null : null)
import { syncEnabled, pullRemote, pushRemote, subscribeRemote } from './sync.js'

const KEY = 'dineflow-state-v1'
const SESSION_KEY = 'dineflow-session'
const AUTH_KEY = 'dineflow-auth'
const StoreContext = createContext(null)

const isLocalHost = (h) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(h)

// The address printed in QR codes. A phone cannot open "localhost", so on the laptop we use the
// network address the server reports. On a phone / tunnel / hosted site, the address in use is right.
export function resolveBaseUrl(settings, config) {
  if (settings?.publicBaseUrl) return settings.publicBaseUrl
  if (config?.tunnelUrl) return config.tunnelUrl // public https address (START_ONLINE)
  if (isLocalHost(window.location.hostname) && config?.publicBaseUrl) return config.publicBaseUrl
  return window.location.origin
}

export function getSavedSession() {
  try { return localStorage.getItem(SESSION_KEY) } catch { return null }
}

// ───────────────────────── provider: pick the mode ─────────────────────────

export function StoreProvider({ children }) {
  const [mode, setMode] = useState(null) // null = still checking

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(2500), cache: 'no-store' })
        const data = await res.json()
        if (alive) setMode(data?.ok === true ? 'server' : 'local')
      } catch {
        if (alive) setMode('local')
      }
    })()
    return () => { alive = false }
  }, [])

  if (!mode) return <Splash text="Starting…" />
  return mode === 'server' ? <ServerStore>{children}</ServerStore> : <LocalStore>{children}</LocalStore>
}

function Splash({ text, error }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'Inter, system-ui, sans-serif', color: '#172B36', background: '#F5F7F6', padding: 24, textAlign: 'center' }}>
      <div>
        <img src="/logo-mark.png" alt="" width="72" style={{ margin: "0 auto" }} />
        <div style={{ fontWeight: 700, marginTop: 8 }}>{text}</div>
        {error && <div style={{ marginTop: 8, color: '#687782', maxWidth: 360 }}>{error}</div>}
      </div>
    </div>
  )
}

// ───────────────────────── SERVER mode ─────────────────────────

function ServerStore({ children }) {
  const [state, setState] = useState(null)
  const [connected, setConnected] = useState(false)
  const [config, setConfig] = useState(null)
  const [auth, setAuth] = useState(null)
  const [reconnectKey, setReconnectKey] = useState(0) // changes → open a fresh event stream
  const [slow, setSlow] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const ref = useRef(null)
  const waiters = useRef([])
  const sessionRef = useRef(getSavedSession())

  useEffect(() => {
    fetch('/api/me').then((r) => r.json()).then((m) => m.role && setAuth({ role: m.role, username: m.username })).catch(() => {})
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [])

  // Live stream. EventSource reconnects by itself after a network drop; if the browser gives up
  // (server restarted, bad response) we open a new one after a short pause.
  // The public address can change while the app is open (START_ONLINE), so reload it on every (re)connect.
  useEffect(() => {
    if (connected) fetch('/api/config', { cache: 'no-store' }).then((r) => r.json()).then(setConfig).catch(() => {})
  }, [connected])

  useEffect(() => {
    let es
    let retry
    const open = () => {
      es = new EventSource('/api/events')
      es.addEventListener('state', (e) => {
        const next = JSON.parse(e.data)
        if (!ref.current || next.meta.rev >= ref.current.meta.rev) {
          ref.current = next
          useModel(next)
          setState(next)
          waiters.current = waiters.current.filter((w) => (next.meta.rev >= w.rev ? (w.resolve(), false) : true))
        }
        setConnected(true)
      })
      es.onopen = () => setConnected(true)
      es.onerror = () => {
        setConnected(false)
        if (es.readyState === 2) retry = setTimeout(open, 2000)
      }
    }
    open()
    return () => { clearTimeout(retry); es.close() }
  }, [reconnectKey])

  useEffect(() => {
    const up = () => { setOnline(true); setReconnectKey((k) => k + 1) }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  const waitForRev = (rev) =>
    new Promise((resolve) => {
      if (ref.current && ref.current.meta.rev >= rev) return resolve()
      waiters.current.push({ rev, resolve })
      setTimeout(resolve, 3000) // never hang the screen if the stream is slow
    })

  const act = useCallback(async (name, args = {}) => {
    try {
      const res = await fetch('/api/act', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, args: { ...args, session: args.session ?? sessionRef.current } }),
      })
      const data = await res.json()
      if (data.ok && data.rev) await waitForRev(data.rev) // the screen already shows the change when this resolves
      return data
    } catch {
      return { ok: false, error: 'Cannot reach the restaurant server. Check the Wi-Fi connection and try again.' }
    }
  }, [])

  const login = useCallback(async (username, pin) => {
    try {
      const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, pin }) })
      const data = await res.json()
      if (data.ok) { setAuth({ role: data.role, username: data.username }); setReconnectKey((k) => k + 1) } // new stream = role-specific data
      return data
    } catch {
      return { ok: false, error: 'Cannot reach the restaurant server.' }
    }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {})
    setAuth(null)
    setReconnectKey((k) => k + 1)
  }, [])

  const resetDemo = useCallback(async () => {
    const res = await fetch('/api/reset', { method: 'POST' }).then((r) => r.json()).catch(() => ({ ok: false }))
    return res
  }, [])

  const verifyKioskPin = useCallback(async (pin) => {
    try {
      const res = await fetch('/api/kiosk-exit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
      return (await res.json()).ok === true
    } catch { return false }
  }, [])

  const setSession = useCallback((secret) => {
    sessionRef.current = secret
    try { localStorage.setItem(SESSION_KEY, secret) } catch { /* storage blocked */ }
  }, [])

  const value = useMemo(() => {
    if (!state) return null
    return {
      mode: 'server', state, act, resetDemo, online, connected: connected && online, config, auth, login, logout, verifyKioskPin, setSession,
      baseUrl: resolveBaseUrl(state.settings, config),
      syncStatus: connected ? 'live' : 'reconnecting',
    }
  }, [state, act, resetDemo, online, connected, config, auth, login, logout, verifyKioskPin, setSession])

  if (!value) return <Splash text={slow ? 'Cannot reach the restaurant server' : 'Connecting to the restaurant…'} error={slow ? 'Check that this device is on the same Wi-Fi as the laptop and that DineFlow is running (START_DEMO). Retrying automatically.' : undefined} />
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

// ───────────────────────── LOCAL mode (browser only) ─────────────────────────

function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.meta?.version === 1 ? parsed : null
  } catch {
    return null
  }
}

function saveLocal(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
    return true
  } catch {
    return false // storage full or blocked: the app keeps working in memory
  }
}

function LocalStore({ children }) {
  const [state, setState] = useState(() => {
    const existing = loadLocal()
    if (existing && existing.ingredients && existing.layout) { useModel(existing); return existing } // older saved data is replaced by the new demo data
    const fresh = createSeedState(Date.now(), window.location.origin)
    saveLocal(fresh)
    return fresh
  })
  const [online, setOnline] = useState(navigator.onLine)
  const [syncStatus, setSyncStatus] = useState(syncEnabled ? 'connecting' : 'local')
  const [auth, setAuth] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(AUTH_KEY)) } catch { return null }
  })
  const ref = useRef(state)
  const pushTimer = useRef(null)
  const dirty = useRef(false)

  const adopt = useCallback((next) => {
    ref.current = next
    useModel(next)
    setState(next)
  }, [])

  const schedulePush = useCallback(() => {
    if (!syncEnabled) return
    dirty.current = true
    clearTimeout(pushTimer.current)
    pushTimer.current = setTimeout(async () => {
      if (!navigator.onLine) return setSyncStatus('offline')
      try {
        await pushRemote(ref.current)
        dirty.current = false
        setSyncStatus('synced')
      } catch {
        setSyncStatus('error')
      }
    }, 400)
  }, [])

  const commit = useCallback(
    (fn) => {
      const draft = structuredClone(ref.current)
      const now = Date.now()
      let result
      try {
        result = fn(draft, now)
        housekeeping(draft, now)
      } catch (e) {
        return { ok: false, error: e.message || 'Something went wrong' }
      }
      draft.meta.rev = (draft.meta.rev || 0) + 1
      saveLocal(draft)
      adopt(draft)
      schedulePush()
      return { ok: true, ...result }
    },
    [adopt, schedulePush],
  )

  const act = useCallback(
    async (name, args = {}) => {
      const fn = ACTIONS[name]
      if (!fn) return { ok: false, error: `Unknown action ${name}` }
      return commit((draft, now) => fn(draft, args, now))
    },
    [commit],
  )

  const resetDemo = useCallback(async () => {
    const fresh = createSeedState(Date.now(), window.location.origin)
    fresh.meta.rev = (ref.current.meta.rev || 0) + 1
    saveLocal(fresh)
    adopt(fresh)
    schedulePush()
    return { ok: true }
  }, [adopt, schedulePush])

  // Demo-only sign-in (checked in the browser). Server mode checks on the server instead.
  const login = useCallback(async (username, pin) => {
    const account = DEMO_ACCOUNTS.find((a) => a.username === String(username).trim().toLowerCase() && a.pin === pin)
    if (!account) return { ok: false, error: 'Wrong username or PIN' }
    const value = { role: account.role, username: account.username }
    try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(value)) } catch { /* private mode */ }
    setAuth(value)
    return { ok: true, ...value }
  }, [])
  const logout = useCallback(async () => {
    try { sessionStorage.removeItem(AUTH_KEY) } catch { /* ignore */ }
    setAuth(null)
  }, [])
  const verifyKioskPin = useCallback(async (pin) => String(pin) === String(ref.current.settings.kioskPin), [])
  const setSession = useCallback((secret) => {
    try { localStorage.setItem(SESSION_KEY, secret) } catch { /* storage blocked */ }
  }, [])

  // Other tabs / windows of this browser.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== KEY || !e.newValue) return
      try {
        const next = JSON.parse(e.newValue)
        if (next?.meta?.version === 1) adopt(next)
      } catch { /* ignore corrupted writes */ }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [adopt])

  // Optional Supabase mirror: load once, then follow remote changes.
  useEffect(() => {
    if (!syncEnabled) return
    let stop = () => {}
    ;(async () => {
      try {
        const remote = await pullRemote()
        if (remote && (remote.meta?.rev || 0) >= (ref.current.meta.rev || 0)) {
          saveLocal(remote)
          adopt(remote)
        } else {
          await pushRemote(ref.current)
        }
        setSyncStatus('synced')
      } catch {
        setSyncStatus('error')
      }
      stop = subscribeRemote((remote) => {
        if ((remote.meta?.rev || 0) > (ref.current.meta.rev || 0)) {
          saveLocal(remote)
          adopt(remote)
        }
      })
    })()
    return () => stop()
  }, [adopt])

  useEffect(() => {
    const up = () => { setOnline(true); if (dirty.current) schedulePush() }
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [schedulePush])

  // Time keeps moving: expire no-shows, finish cleaning, start scheduled dishes, re-plan.
  useEffect(() => {
    const id = setInterval(() => {
      const probe = structuredClone(ref.current)
      if (housekeeping(probe, Date.now())) {
        probe.meta.rev = (probe.meta.rev || 0) + 1
        saveLocal(probe)
        adopt(probe)
        schedulePush()
      }
    }, 5000)
    return () => clearInterval(id)
  }, [adopt, schedulePush])

  const value = useMemo(
    () => ({ mode: 'local', state, act, resetDemo, online, connected: online, config: null, auth, login, logout, verifyKioskPin, setSession, baseUrl: resolveBaseUrl(state.settings, null), syncStatus }),
    [state, act, resetDemo, online, auth, login, logout, verifyKioskPin, setSession, syncStatus],
  )
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  return useContext(StoreContext)
}

// A clock that re-renders the component every few seconds (for countdowns and live estimates).
export function useNow(intervalMs = 5000) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
