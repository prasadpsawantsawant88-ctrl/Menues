import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart3, ChefHat, ClipboardList, Cloud, CloudOff, LayoutDashboard, LogOut, RotateCcw, Settings, Boxes, Brain, Gift, LayoutGrid, Table2, Utensils, WifiOff, Workflow, QrCode } from 'lucide-react'
import { Brand, LogoMark } from './Brand.jsx'
import { useStore } from '../lib/store.jsx'
import { DEMO_ACCOUNTS } from '../lib/seed.js'
import { Modal, Notice } from './ui.jsx'

// ───────── sign-in gate (checked on the DineFlow server; demo accounts are listed for convenience) ─────────

export function RequireRole({ role, children }) {
  const { auth, login } = useStore()
  const [username, setUsername] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const allowed = auth && (auth.role === role || auth.role === 'admin')
  if (allowed) return children

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    const r = await login(username, pin)
    setBusy(false)
    if (!r.ok) return setError(r.error || 'Wrong username or PIN')
    if (r.role !== role && r.role !== 'admin') setError(`This account cannot open the ${role} area`)
  }
  const quick = DEMO_ACCOUNTS.find((a) => a.role === role)

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="mb-3"><Brand /></div>
          <h1 className="text-xl font-extrabold">{role === 'staff' ? 'Staff' : role === 'kitchen' ? 'Kitchen' : 'Admin'} sign-in</h1>
          <p className="mt-1 text-sm text-muted">Demo accounts are listed below. Change the PINs in <code>.env</code> before using DineFlow anywhere other than a demo.</p>
        </div>
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" />
        <input className="input" placeholder="PIN" type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" />
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
          <div className="mb-1 font-semibold">Demo credentials</div>
          {DEMO_ACCOUNTS.map((a) => (
            <div key={a.role}>
              <code>{a.username}</code> / <code>{a.pin}</code> — {a.label}
            </div>
          ))}
          <button type="button" className="mt-2 font-semibold text-brand-700 underline" onClick={() => { setUsername(quick.username); setPin(quick.pin) }}>
            Fill in {quick.username} credentials
          </button>
        </div>
        <Link to="/" className="block text-center text-sm text-muted hover:underline">← Back to restaurant</Link>
      </form>
    </div>
  )
}

// ───────── banners ─────────

export function StatusBanners() {
  const { online, connected, mode } = useStore()
  if (online && connected) return null
  return (
    <div className="flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-semibold text-white">
      <WifiOff size={14} /> {!online ? 'No Wi-Fi connection.' : 'Reconnecting to the restaurant…'} {mode === 'server' ? 'Your last view stays on screen and updates return automatically.' : 'Changes are kept on this device.'}
    </div>
  )
}

export function SyncBadge() {
  const { syncStatus, mode } = useStore()
  if (mode === 'local' && syncStatus === 'local') return <span className="chip bg-slate-100 text-slate-600" title="Data lives in this browser only. Use START_DEMO to share it between devices.">Browser-only demo</span>
  const ok = syncStatus === 'live' || syncStatus === 'synced'
  const map = { connecting: 'Connecting…', synced: 'Supabase live', live: 'Live', reconnecting: 'Reconnecting…', offline: 'Offline', error: 'Sync error' }
  const Icon = ok ? Cloud : CloudOff
  return (
    <span className={`chip gap-1 ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
      <Icon size={12} /> {map[syncStatus]}
    </span>
  )
}

// ───────── customer shell (mobile first) ─────────

export function CustomerShell({ title, subtitle, back, children, wide = false }) {
  const { state } = useStore()
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-slate-100">
      <StatusBanners />
      <div className={`mx-auto min-h-screen bg-white shadow-sm ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <header className="sticky top-0 z-30 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            {back ? (
              <button onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white" aria-label="Back">
                <ArrowLeft size={18} />
              </button>
            ) : (
              <Link to="/" className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-white" aria-label="Home">
                <LogoMark size={24} />
              </Link>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-extrabold leading-tight">{title || state.settings.restaurantName}</div>
              {(subtitle || title) && <div className="truncate text-xs text-slate-500">{subtitle || state.settings.restaurantName}</div>}
            </div>
            <SyncBadge />
          </div>
        </header>
        <main className="pb-28">{children}</main>
      </div>
    </div>
  )
}

// ───────── staff / admin shell ─────────

const NAV = {
  staff: [
    { to: '/staff', label: 'Queue & tables', icon: ClipboardList, end: true },
    { to: '/kitchen', label: 'Kitchen display', icon: ChefHat },
    { to: '/admin', label: 'Admin', icon: LayoutDashboard },
  ],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
    { to: '/admin/menu', label: 'Menu', icon: Utensils },
    { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
    { to: '/admin/floor-plan', label: 'Floor plan', icon: LayoutGrid },
    { to: '/admin/prep-ai', label: 'Prep-time AI', icon: Brain },
    { to: '/admin/loyalty', label: 'Loyalty', icon: Gift },
    { to: '/admin/tables', label: 'Tables & QR', icon: QrCode },
    { to: '/admin/settings', label: 'Kitchen & settings', icon: Settings },
    { to: '/staff', label: 'Staff dashboard', icon: ClipboardList },
    { to: '/kitchen', label: 'Kitchen display', icon: ChefHat },
    { to: '/how-it-works', label: 'How it works', icon: Workflow },
  ],
}

export function DashboardShell({ area, title, actions, children }) {
  const { state, resetDemo, auth, logout } = useStore()
  const [resetError, setResetError] = useState('')
  const [confirmReset, setConfirmReset] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const items = NAV[area]
  const signOut = async () => {
    await logout()
    navigate('/')
  }
  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-2 px-4 py-3 lg:py-5">
          <Link to="/" aria-label="Home"><Brand name={state.settings.restaurantName} /></Link>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {items.map((item) => (
            <NavLink
              key={item.to + item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <item.icon size={17} /> {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="hidden space-y-2 p-3 lg:absolute lg:bottom-0 lg:block lg:w-60">
          <SyncBadge />
          <button className="btn-ghost w-full !py-2 text-xs" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset demo data</button>
          <button className="btn-ghost w-full !py-2 text-xs" onClick={signOut}><LogOut size={14} /> Sign out</button>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <StatusBanners />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <h1 className="text-2xl font-extrabold">{title}</h1>
          <div className="flex items-center gap-2">
            {actions}
            <button className="btn-ghost !py-2 text-xs lg:hidden" onClick={() => setConfirmReset(true)}><RotateCcw size={14} /> Reset</button>
          </div>
        </div>
        <main className="px-4 pb-10 sm:px-6">{children}</main>
      </div>
      {confirmReset && (
        <Modal title="Reset demo data?" onClose={() => setConfirmReset(false)}>
          <p className="text-sm text-slate-600">This restores the original seeded evening (queue, tables, orders and 10 days of history). Everything you did in the demo will be lost.</p>
          {resetError && <div className="mt-2"><Notice tone="bad">{resetError}</Notice></div>}
          <div className="mt-4 flex gap-2">
            <button className="btn-danger flex-1" onClick={async () => { const r = await resetDemo(); if (r.ok) setConfirmReset(false); else setResetError(r.error || 'Only the admin can reset') }}>Reset now</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmReset(false)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}
