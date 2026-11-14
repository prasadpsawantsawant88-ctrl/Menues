import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Gift, BellRing, MessageSquare, PartyPopper, Users } from 'lucide-react'
import { CustomerShell } from '../components/Layouts.jsx'
import MenuBrowser from '../components/MenuBrowser.jsx'
import { OrderCard } from '../components/OrderStatus.jsx'
import { Confidence, Modal, Notice, StatusChip } from '../components/ui.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { expectedSeatAtForEntry, predictEntry, predictWait } from '../lib/engines.js'
import { fmtTime, MIN } from '../lib/util.js'

// The guest's own points, tier and rewards. Only loads through the personal link (the server checks it).
function LoyaltyCard({ entryId }) {
  const { act, state } = useStore()
  const [acc, setAcc] = useState(null)
  const orders = state.orders.length
  useEffect(() => {
    act('myLoyalty', {}).then((r) => setAcc(r.ok ? r.account : null))
  }, [entryId, orders, state.settings.loyalty])
  if (!acc || !acc.enabled) return null
  const goal = acc.nextTier
  return (
    <section className="rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 p-4 ring-1 ring-amber-200">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-extrabold text-amber-900"><Gift size={17} /> Your rewards</h2>
        <span className="chip bg-amber-200 text-amber-900">{acc.tier}</span>
      </div>
      <div className="mt-1 text-3xl font-extrabold text-amber-900">{acc.points} <span className="text-sm font-semibold">points</span></div>
      <div className="text-xs text-amber-800">{acc.visits} visit{acc.visits === 1 ? '' : 's'}{acc.multiplier > 1 ? ` · earning ×${acc.multiplier}` : ''}{goal ? ` · ${goal.pointsToGo} more points to ${goal.name}` : ''}</div>
      <div className="mt-2 text-xs text-amber-900">
        {acc.rewards.map((r) => <div key={r.id} className={r.affordable ? 'font-semibold' : 'opacity-60'}>{r.affordable ? '✓' : '·'} {r.name}: {r.points} points</div>)}
        <div className="mt-1">Choose a reward when you pay for a pre-order. Points are saved against your phone number.</div>
      </div>
    </section>
  )
}

export default function QueueTracker() {
  const { token } = useParams()
  const location = useLocation()
  const { state, act } = useStore()
  const now = useNow(5000)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [banner, setBanner] = useState('')
  const [error, setError] = useState('')
  const entry = state.queue.find((q) => q.id === token.toUpperCase())

  if (!entry) {
    return (
      <CustomerShell title="Queue" back="/">
        <div className="p-6 text-center">
          <div className="text-5xl">🔍</div>
          <h2 className="mt-3 text-lg font-bold">We could not find queue token {token}</h2>
          <p className="mt-1 text-sm text-slate-500">Scan the QR code at the entrance again, or ask the host for a new one.</p>
          <Link to="/join-queue" className="btn-primary mt-4">Join the queue</Link>
        </div>
      </CustomerShell>
    )
  }

  const active = ['waiting', 'called'].includes(entry.status)
  const pred = predictEntry(state, entry, now)
  const table = entry.tableId ? state.tables.find((t) => t.id === entry.tableId) : null
  const orders = state.orders.filter((o) => o.queueEntryId === entry.id).sort((a, b) => b.createdAt - a.createdAt)
  const sms = state.notifications.filter((n) => n.entryId === entry.id)
  const grace = state.settings.graceMinutes * (entry.ackAt ? 2 : 1)
  const graceLeft = entry.status === 'called' ? Math.max(0, Math.ceil(((entry.calledAt || now) + grace * MIN - now) / MIN)) : 0
  const initial = Math.max(1, entry.initialAhead ?? 1)
  const progress = entry.status === 'waiting' ? Math.round(((initial - Math.min(initial, pred?.groupsAhead ?? initial)) / initial) * 100) : 100
  const expectedSeat = active ? expectedSeatAtForEntry(state, entry, now) : null
  const hasPendingPreorder = orders.some((o) => o.paymentStatus === 'paid')

  const cancelItem = async (item) => {
    const r = await act('cancelOrderItem', { orderItemId: item.id })
    if (!r.ok) setError(r.error)
  }

  return (
    <CustomerShell title={`Token ${entry.id}`} subtitle={state.settings.restaurantName} back="/">
      <div className="space-y-4 p-4">
        {location.state?.existing && <Notice tone="info">You are already in the queue with this number. Here is your existing token.</Notice>}
        {banner && <Notice tone="good">{banner}</Notice>}

        {/* Status card */}
        {entry.status === 'called' && table && (
          <div className="rounded-3xl bg-brand-600 p-5 text-white">
            <div className="flex items-center gap-2 text-sm font-semibold"><BellRing size={18} /> Your table is ready!</div>
            <div className="mt-1 text-4xl font-extrabold">Table {table.id}</div>
            <div className="mt-1 text-sm opacity-90">Please come to the host stand within {graceLeft} min or the table will be released.</div>
            {!entry.ackAt ? (
              <button className="mt-3 w-full rounded-xl bg-white py-2.5 font-bold text-brand-700" onClick={() => act('ackCall', { entryId: entry.id })}>I'm on my way</button>
            ) : <div className="mt-3 rounded-xl bg-white/20 py-2 text-center text-sm font-semibold">Thanks! We have extended your time to {grace} min.</div>}
          </div>
        )}

        {entry.status === 'waiting' && (
          <div className="rounded-3xl border border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Queue token</div>
              <StatusChip status="waiting" />
            </div>
            <div className="text-5xl font-extrabold tracking-tight">{entry.id}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-xl font-extrabold">{entry.partySize}</div><div className="text-[11px] text-slate-500">people</div></div>
              <div className="rounded-xl bg-slate-50 p-2.5"><div className="text-xl font-extrabold">{pred?.groupsAhead ?? '–'}</div><div className="text-[11px] text-slate-500">groups ahead</div></div>
              <div className="rounded-xl bg-brand-50 p-2.5"><div className="text-xl font-extrabold text-brand-700">{pred?.waitMin == null ? '–' : `${pred.waitMin} min`}</div><div className="text-[11px] text-brand-700">est. wait</div></div>
            </div>
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Joined {fmtTime(entry.joinedAt)}</span><span>Seating around {fmtTime(pred?.seatAt)}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(6, progress)}%` }} /></div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
              {<Confidence level={predictWait(state, { partySize: entry.partySize }, now).confidence} />}
              <span>Estimates update automatically.</span>
            </div>
          </div>
        )}

        {entry.status === 'seated' && (
          <div className="rounded-3xl bg-emerald-50 p-5 text-center">
            <PartyPopper className="mx-auto text-emerald-600" />
            <div className="mt-1 text-lg font-extrabold">You are seated at table {entry.tableId}</div>
            <p className="text-sm text-slate-600">Scan the QR code on your table, or tap below, to order more food.</p>
            <Link to={`/table/${entry.tableId}`} className="btn-primary mt-3">Order from your table</Link>
          </div>
        )}

        {['cancelled', 'abandoned', 'no_show'].includes(entry.status) && (
          <div className="rounded-3xl bg-slate-100 p-5 text-center">
            <StatusChip status={entry.status} />
            <p className="mt-2 text-sm text-slate-600">{entry.status === 'no_show' ? 'We did not hear back when your table was ready, so it was given to the next group.' : 'This queue entry has been cancelled.'}</p>
            <Link to="/join-queue" className="btn-primary mt-3">Join again</Link>
          </div>
        )}

        {active && (
          <button className="btn-ghost w-full text-red-600" onClick={() => setConfirmCancel(true)}>Leave the queue</button>
        )}

        {error && <Notice tone="bad">{error}</Notice>}

        <LoyaltyCard entryId={entry.id} />

        {/* Pre-orders */}
        {orders.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-extrabold">Your orders</h2>
            {orders.map((o) => <OrderCard key={o.id} order={o} allowCancel={active || entry.status === 'seated'} onCancelItem={cancelItem} />)}
          </section>
        )}

        {/* In-app updates */}
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-extrabold"><MessageSquare size={15} /> Updates for this token</h2>
          {sms.length === 0 && <div className="text-xs text-slate-500">No updates yet. Keep this page open.</div>}
          {sms.map((n) => (
            <div key={n.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-xs">
              <div className="mb-1 text-slate-400">{fmtTime(n.createdAt)}</div>
              <div className="text-slate-700">{n.body}</div>
            </div>
          ))}
        </section>
      </div>

      {active && (
        <>
          <div className="border-t border-slate-100 pt-4">
            <div className="px-4">
              <h2 className="flex items-center gap-2 text-xl font-extrabold"><Users size={18} /> Pre-order while you wait</h2>
              <p className="text-sm text-slate-500">{hasPendingPreorder ? 'Add more dishes if you like.' : 'Order now so your food is ready when you sit down.'}</p>
            </div>
            <MenuBrowser mode="preorder" entry={entry} expectedSeatAt={expectedSeat} onPaid={(id) => setBanner('Pre-order confirmed (test payment). Your kitchen schedule is shown under "Your orders".')} />
          </div>
        </>
      )}

      {confirmCancel && (
        <Modal title="Leave the queue?" onClose={() => setConfirmCancel(false)}>
          <p className="text-sm text-slate-600">You will lose your place. {hasPendingPreorder ? 'Your pre-order will be cancelled and refunded (test mode).' : ''}</p>
          <div className="mt-4 flex gap-2">
            <button className="btn-danger flex-1" onClick={async () => { await act('cancelEntry', { entryId: entry.id, by: 'customer' }); setConfirmCancel(false) }}>Leave queue</button>
            <button className="btn-ghost flex-1" onClick={() => setConfirmCancel(false)}>Stay</button>
          </div>
        </Modal>
      )}
    </CustomerShell>
  )
}
