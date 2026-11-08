import { useMemo, useState } from 'react'
import { AlertTriangle, Check, ChefHat, Clock, Flame, Pause, Play, Truck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { RequireRole, StatusBanners } from '../components/Layouts.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { computeKitchenPlan, stationLoad } from '../lib/engines.js'
import { fmtTime, MIN } from '../lib/util.js'

export default function Kitchen() {
  return (
    <RequireRole role="kitchen">
      <KitchenInner />
    </RequireRole>
  )
}

const STATUS_BG = { scheduled: 'border-violet-400', received: 'border-sky-400', preparing: 'border-orange-400', ready: 'border-emerald-400' }

function KitchenInner() {
  const { state, act } = useStore()
  const now = useNow(3000)
  const [view, setView] = useState('stations') // stations | orders
  const [error, setError] = useState('')
  const plan = useMemo(() => computeKitchenPlan(state, now), [state.tasks, state.stations, now])
  const load = useMemo(() => stationLoad(state, now), [state.tasks, state.stations, now])
  const live = state.tasks.filter((t) => ['scheduled', 'received', 'preparing', 'ready'].includes(t.status))
  const ordersById = Object.fromEntries(state.orders.map((o) => [o.id, o]))

  const run = async (name, args) => {
    const r = await act(name, args)
    setError(r.ok ? '' : r.error)
  }

  const sortTasks = (a, b) => {
    const rank = { ready: 0, preparing: 1, received: 2, scheduled: 3 }
    return rank[a.status] - rank[b.status] || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || (plan.plans[a.id]?.start ?? a.scheduledStart) - (plan.plans[b.id]?.start ?? b.scheduledStart)
  }

  const TaskCard = ({ t }) => {
    const order = ordersById[t.orderId]
    const p = plan.plans[t.id]
    const late = t.status === 'scheduled' && t.delayMin > 0
    const startsIn = t.status === 'scheduled' ? Math.ceil((t.scheduledStart - now) / MIN) : null
    const elapsed = t.status === 'preparing' ? Math.floor((now - t.startedAt) / MIN) : null
    const overdue = t.status === 'preparing' && elapsed > t.durationMin
    return (
      <div className={`rounded-2xl border-l-8 bg-slate-800 p-4 ${STATUS_BG[t.status]} ${t.priority === 'high' ? 'ring-2 ring-red-500' : ''}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xl font-extrabold leading-tight">{t.qty} × {t.itemName}</div>
            <div className="mt-0.5 text-sm text-slate-300">
              {order?.orderNo} · {t.tableId ? <b className="text-white">Table {t.tableId}</b> : <b className="text-violet-300">Waiting {t.token}</b>}
              {order?.partySize ? ` · party of ${order.partySize}` : ''}
            </div>
          </div>
          <span className="rounded-full bg-slate-700 px-2.5 py-1 text-xs font-bold uppercase">{t.status}</span>
        </div>
        {(t.options || t.instructions) && <div className="mt-2 rounded-lg bg-amber-400/15 px-2.5 py-1.5 text-base font-semibold text-amber-200">{[t.options, t.instructions && `“${t.instructions}”`].filter(Boolean).join(' · ')}</div>}
        <div className="mt-2 space-y-0.5 text-sm text-slate-300">
          {t.status === 'scheduled' && (
            <>
              <div className="flex items-center gap-1"><Clock size={14} /> Start <b className="text-white">{fmtTime(t.scheduledStart)}</b> ({startsIn > 0 ? `in ${startsIn} min` : 'now'}) · ready ~{fmtTime(t.estReady)}</div>
              <div>Guest expected at {fmtTime(order?.expectedSeatAt)}{t.override && ' · MANUAL OVERRIDE'}</div>
              {late && <div className="flex items-center gap-1 font-bold text-red-300"><AlertTriangle size={14} /> Will be ~{t.delayMin} min after seating</div>}
            </>
          )}
          {t.status === 'received' && p && <div>Estimated done {fmtTime(p.end)} · {t.durationMin} min dish</div>}
          {t.status === 'preparing' && <div className={overdue ? 'font-bold text-red-300' : ''}>Cooking {elapsed} / {t.durationMin} min{overdue ? ' · running late' : ''}</div>}
          {t.status === 'ready' && <div className="font-bold text-emerald-300">Ready since {fmtTime(t.readyAt)}. Waiting to be served.</div>}
          {t.delayNote && <div className="text-red-300">{t.delayNote}</div>}
          {t.priority === 'high' && <div className="flex items-center gap-1 font-bold text-red-300"><Flame size={14} /> HIGH PRIORITY</div>}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {['scheduled', 'received'].includes(t.status) && <button className="rounded-xl bg-orange-500 px-4 py-2.5 text-base font-bold text-white" onClick={() => run('setTaskStatus', { taskId: t.id, status: 'preparing' })}><Play size={16} className="mr-1 inline" />{t.status === 'scheduled' ? 'Start now' : 'Start'}</button>}
          {t.status === 'preparing' && <button className="rounded-xl bg-emerald-500 px-4 py-2.5 text-base font-bold text-white" onClick={() => run('setTaskStatus', { taskId: t.id, status: 'ready' })}><Check size={16} className="mr-1 inline" />Mark ready</button>}
          {t.status === 'ready' && <button className="rounded-xl bg-sky-500 px-4 py-2.5 text-base font-bold text-white" onClick={() => run('setTaskStatus', { taskId: t.id, status: 'served' })}><Truck size={16} className="mr-1 inline" />Served</button>}
          {['scheduled', 'preparing'].includes(t.status) && <button className="rounded-xl bg-slate-600 px-3 py-2.5 text-sm font-bold" onClick={() => run('delayTask', { taskId: t.id, minutes: 5 })}><Pause size={14} className="mr-1 inline" />+5 min</button>}
          {t.status !== 'ready' && <button className="rounded-xl bg-slate-600 px-3 py-2.5 text-sm font-bold" onClick={() => run('setTaskPriority', { taskId: t.id, priority: t.priority === 'high' ? 'normal' : 'high' })}>{t.priority === 'high' ? 'Normal priority' : 'Rush'}</button>}
          {['scheduled', 'received', 'preparing'].includes(t.status) && <button className="rounded-xl bg-red-900/70 px-3 py-2.5 text-sm font-bold text-red-100" onClick={() => { if (confirm(`Out of ingredients for ${t.itemName}? It will be cancelled, refunded and hidden from the menu.`)) run('reportUnavailable', { taskId: t.id }) }}>Out of stock</button>}
        </div>
      </div>
    )
  }

  const counts = (status) => live.filter((t) => t.status === status).length

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      <StatusBanners />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-5 py-3">
        <div className="flex items-center gap-3">
          <ChefHat className="text-brand-500" size={30} />
          <div>
            <h1 className="text-2xl font-extrabold">Kitchen display</h1>
            <div className="text-sm text-slate-400">{state.settings.restaurantName} · {fmtTime(now)}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <span className="rounded-full bg-violet-500/20 px-3 py-1 text-violet-200">Scheduled {counts('scheduled')}</span>
          <span className="rounded-full bg-sky-500/20 px-3 py-1 text-sky-200">Received {counts('received')}</span>
          <span className="rounded-full bg-orange-500/20 px-3 py-1 text-orange-200">Preparing {counts('preparing')}</span>
          <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-200">Ready {counts('ready')}</span>
          <button className={`rounded-xl px-3 py-1.5 ${view === 'stations' ? 'bg-white text-slate-900' : 'bg-slate-700'}`} onClick={() => setView('stations')}>By station</button>
          <button className={`rounded-xl px-3 py-1.5 ${view === 'orders' ? 'bg-white text-slate-900' : 'bg-slate-700'}`} onClick={() => setView('orders')}>By order</button>
          <Link to="/staff" className="rounded-xl bg-slate-700 px-3 py-1.5">Exit</Link>
        </div>
      </header>
      {error && <div className="bg-red-600 px-5 py-2 font-semibold">{error}</div>}

      {view === 'stations' ? (
        <div className="grid gap-4 p-4 md:grid-cols-2 2xl:grid-cols-4">
          {state.stations.map((st) => {
            const tasks = live.filter((t) => t.station === st.id).sort(sortTasks)
            const l = load.find((x) => x.station.id === st.id)
            return (
              <section key={st.id} className="rounded-3xl bg-slate-800/60 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-xl font-extrabold">{st.name} station</h2>
                  <div className="text-right text-xs text-slate-400">{st.chefs} chef{st.chefs > 1 ? 's' : ''} · {l.busyChefs} busy<br />clear in ~{l.clearsInMin} min</div>
                </div>
                <div className="space-y-3">
                  {tasks.map((t) => <TaskCard key={t.id} t={t} />)}
                  {!tasks.length && <div className="rounded-2xl border border-dashed border-slate-600 p-6 text-center text-slate-500">Nothing to cook</div>}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-4 p-4 lg:grid-cols-2 2xl:grid-cols-3">
          {[...new Set(live.map((t) => t.orderId))].map((oid) => {
            const o = ordersById[oid]
            const tasks = live.filter((t) => t.orderId === oid).sort(sortTasks)
            return (
              <section key={oid} className="rounded-3xl bg-slate-800/60 p-3">
                <div className="mb-3 px-1">
                  <h2 className="text-xl font-extrabold">{o.orderNo} · {o.tableId ? `Table ${o.tableId}` : `Waiting ${o.queueEntryId}`}</h2>
                  <div className="text-xs text-slate-400">{o.type === 'preorder' ? 'Pre-order' : 'Table order'}{o.partySize ? ` · party of ${o.partySize}` : ''}{o.expectedSeatAt && !o.sessionId ? ` · seating ~${fmtTime(o.expectedSeatAt)}` : ''}</div>
                </div>
                <div className="space-y-3">{tasks.map((t) => <TaskCard key={t.id} t={t} />)}</div>
              </section>
            )
          })}
          {!live.length && <div className="col-span-full p-10 text-center text-slate-500">No active orders.</div>}
        </div>
      )}
    </div>
  )
}
