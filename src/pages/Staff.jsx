import { useState } from 'react'
import { Bell, Clock, QrCode, Hand, LogIn, MessageSquare, Plus, Star, UserPlus, X } from 'lucide-react'
import { DashboardShell, RequireRole } from '../components/Layouts.jsx'
import { FloorMap, FloorLegend } from '../components/FloorMap.jsx'
import QueueQr from '../components/QueueQr.jsx'
import { Empty, Field, Modal, Notice, Stat, StatusChip, Confidence } from '../components/ui.jsx'
import { useStore, useNow } from '../lib/store.jsx'
import { predictEntry, predictWait, sortedWaiting, suggestEntryForTable } from '../lib/engines.js'
import { fmtDuration, fmtMoney, fmtTime, MIN } from '../lib/util.js'

export default function Staff() {
  return (
    <RequireRole role="staff">
      <StaffInner />
    </RequireRole>
  )
}

function StaffInner() {
  const { state, act } = useStore()
  const now = useNow(5000)
  const [msg, setMsg] = useState({ tone: '', text: '' })
  const [showAdd, setShowAdd] = useState(false)
  const [qr, setQr] = useState(null)
  const [showSms, setShowSms] = useState(false)
  const [editing, setEditing] = useState(null)
  const [tablePick, setTablePick] = useState(null) // entry that needs a table
  const [walkIn, setWalkIn] = useState(null) // table to seat a walk-in

  const waiting = sortedWaiting(state)
  const called = state.queue.filter((q) => q.status === 'called')
  const preds = Object.fromEntries([...waiting, ...called].map((q) => [q.id, predictEntry(state, q, now)]))
  const waits = waiting.map((q) => preds[q.id]?.waitMin).filter((v) => v != null)
  const avgWait = waits.length ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length) : 0
  const free = state.tables.filter((t) => t.status === 'available')
  const occupied = state.tables.filter((t) => t.status === 'occupied')
  const approaching = waiting.filter((q) => (preds[q.id]?.waitMin ?? 99) <= 10)

  const run = async (name, args, okText) => {
    const r = await act(name, args)
    setMsg(r.ok ? { tone: 'good', text: okText || 'Done' } : { tone: 'bad', text: r.error })
    return r
  }

  const preorderOf = (q) => state.orders.find((o) => o.queueEntryId === q.id && o.paymentStatus === 'paid' && o.status !== 'cancelled')
  const failedPay = (q) => state.orders.some((o) => o.queueEntryId === q.id && o.paymentStatus === 'pending' && o.lastPaymentFailure)

  return (
    <DashboardShell
      area="staff"
      title="Queue & tables"
      actions={
        <>
          <button className="btn-ghost !py-2 text-xs" onClick={() => setShowSms(true)}><MessageSquare size={14} /> Activity log</button>
          <button className="btn-primary !py-2 text-xs" onClick={() => setShowAdd(true)}><UserPlus size={14} /> Add customer</button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Customers waiting" value={waiting.length} sub={`${waiting.reduce((s, q) => s + q.partySize, 0)} people`} />
          <Stat label="Avg est. wait" value={fmtDuration(avgWait)} />
          <Stat label="Free tables" value={free.length} sub={`${state.tables.length} total`} tone={free.length ? 'good' : 'warn'} />
          <Stat label="Occupied" value={occupied.length} />
          <Stat label="Approaching turn" value={approaching.length} sub="≤ 10 min" tone={approaching.length ? 'warn' : 'default'} />
        </div>

        {msg.text && (
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1"><Notice tone={msg.tone}>{msg.text}</Notice></div>
            <button onClick={() => setMsg({ tone: '', text: '' })} aria-label="Dismiss"><X size={16} /></button>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-5">
          {/* Queue */}
          <section className="space-y-3 xl:col-span-3">
            <h2 className="text-lg font-extrabold">Queue</h2>

            {called.map((q) => {
              const graceLeft = Math.max(0, Math.ceil((q.calledAt + state.settings.graceMinutes * (q.ackAt ? 2 : 1) * MIN - now) / MIN))
              return (
                <div key={q.id} className="card border-blue-300 bg-blue-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2"><span className="text-xl font-extrabold">{q.id}</span><StatusChip status="called" label={`Table ${q.tableId} ready`} /></div>
                      <div className="text-sm text-slate-600">{q.name || 'Guest'} · party of {q.partySize}</div>
                      <div className="text-xs font-semibold text-blue-800">{q.ackAt ? 'Customer is on the way. ' : 'No response yet. '}Table released in {graceLeft} min</div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-primary !py-2 text-xs" onClick={() => run('seatEntry', { entryId: q.id }, `${q.id} seated at ${q.tableId}`)}><LogIn size={14} /> Mark seated</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={() => run('notifyEntry', { entryId: q.id }, 'Reminder sent to the customer’s queue page')}><Bell size={14} /> Remind</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={() => run('extendGrace', { entryId: q.id }, 'Grace period extended by 2 min')}>+2 min</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={() => run('releaseTable', { entryId: q.id }, 'Table released, group is back in the queue')}>Release table</button>
                      <button className="btn-ghost !py-2 text-xs text-red-600" onClick={() => run('cancelEntry', { entryId: q.id, by: 'staff' }, `${q.id} cancelled`)}>Cancel</button>
                    </div>
                  </div>
                </div>
              )
            })}

            {waiting.length === 0 && called.length === 0 && <Empty>Nobody is waiting. New customers appear here instantly.</Empty>}

            {waiting.map((q, idx) => {
              const p = preds[q.id]
              const order = preorderOf(q)
              const fits = free.filter((t) => t.capacity >= q.partySize)
              return (
                <div key={q.id} className="card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{idx + 1}</span>
                        <span className="text-xl font-extrabold">{q.id}</span>
                        {q.priority > 0 && <span className="chip bg-amber-100 text-amber-800"><Star size={11} className="mr-1" />Priority</span>}
                        {q.skipCount > 0 && <span className="chip bg-slate-100 text-slate-700" title="Times passed over for a smaller group">skipped ×{q.skipCount}</span>}
                        {q.manualSeatAt && <span className="chip bg-violet-100 text-violet-800">Seat time set manually</span>}
                      </div>
                      <div className="mt-0.5 text-sm text-slate-600">{q.name || 'Guest'} · <b>party of {q.partySize}</b> · {q.preference}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                        <span className="flex items-center gap-1 font-semibold"><Clock size={14} /> {p?.waitMin == null ? 'No table fits' : `~${p.waitMin} min`}</span>
                        <span className="text-slate-500">seating {fmtTime(p?.seatAt)}{p?.tableId ? ` · likely ${p.tableId}` : ''}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {order ? <><StatusChip status="paid" label="Pre-order paid" /><StatusChip status={order.status === 'scheduled' ? 'scheduled' : order.status} /></> : failedPay(q) ? <StatusChip status="failed" label="Payment failed" /> : <span className="chip bg-slate-100 text-slate-500">No pre-order</span>}
                      </div>
                      {order && <div className="mt-1 text-xs text-slate-500">{state.orderItems.filter((i) => i.orderId === order.id && i.status !== 'cancelled').map((i) => `${i.qty}× ${i.name}`).join(', ')} · {fmtMoney(order.total)}</div>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className="btn-primary !py-2 text-xs" disabled={!fits.length} onClick={() => setTablePick(q)} title={fits.length ? '' : 'No free table of this size'}><Hand size={14} /> Allocate table</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={() => setEditing(q)}>Edit</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={async () => { if (!confirm(`Create a new QR code for ${q.id}? The old link stops working.`)) return; const r = await run('renewSession', { entryId: q.id }, 'New QR code ready'); if (r.ok) setQr({ id: q.id, secret: r.entry.sessionToken, expiresAt: r.entry.sessionExpiresAt }) }}><QrCode size={14} /> New QR</button>
                      <button className="btn-ghost !py-2 text-xs" onClick={() => run('notifyEntry', { entryId: q.id }, 'Notification sent')}><Bell size={14} /> Notify</button>
                      <button className="btn-ghost !py-2 text-xs text-red-600" onClick={() => run('cancelEntry', { entryId: q.id, by: 'staff' }, `${q.id} cancelled`)}>Cancel</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </section>

          {/* Tables */}
          <section className="xl:col-span-2">
            <h2 className="mb-3 text-lg font-extrabold">Tables</h2>
            <div className="mb-3 space-y-2"><FloorMap layout={state.layout} tables={state.tables} /><FloorLegend layout={state.layout} /></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
              {state.tables.map((t) => {
                const session = state.sessions.find((s) => s.id === t.sessionId)
                const sug = t.status === 'available' ? suggestEntryForTable(state, t) : null
                const heldBy = t.heldFor
                const mins = session ? Math.round((now - session.seatedAt) / MIN) : null
                return (
                  <div key={t.id} className="card p-3">
                    <div className="flex items-center justify-between"><span className="text-lg font-extrabold">{t.id}</span><StatusChip status={t.status} /></div>
                    <div className="text-xs text-slate-500">{t.capacity} seats · {t.zone}</div>
                    {t.status === 'occupied' && session && (
                      <div className="mt-1 text-xs text-slate-600">Party of {session.partySize} · {mins} min · leaves ~{fmtTime(session.expectedDepartAt)}</div>
                    )}
                    {t.status === 'reserved' && <div className="mt-1 text-xs font-semibold text-blue-700">Held for {heldBy}</div>}
                    {t.status === 'available' && sug && (
                      <div className="mt-1 text-xs text-emerald-800">
                        Suggest <b>{sug.entry.id}</b> ({sug.entry.partySize})
                        <div className="text-[11px] text-slate-500">{sug.reason}</div>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.status === 'available' && sug && <button className="btn-primary !px-2.5 !py-1 text-xs" onClick={() => run('allocateTable', { entryId: sug.entry.id, tableId: t.id }, `${t.id} allocated to ${sug.entry.id}`)}>Allocate</button>}
                      {t.status === 'available' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setWalkIn(t)}>Seat walk-in</button>}
                      {t.status === 'occupied' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run('endSession', { tableId: t.id }, `${t.id} is now being cleaned`)}>Guests left</button>}
                      {t.status === 'cleaning' && <button className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run('setTableStatus', { tableId: t.id, status: 'available' }, `${t.id} available`)}>Mark clean</button>}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>
        </div>
      </div>

      {showAdd && <AddCustomer onClose={() => setShowAdd(false)} onDone={(r) => { setShowAdd(false); if (r.entry?.sessionToken) setQr({ id: r.entry.id, secret: r.entry.sessionToken, expiresAt: r.entry.sessionExpiresAt }); setMsg({ tone: 'good', text: r.seatedImmediately ? `${r.entry.id} was seated straight away at ${r.table.id}` : `Added ${r.entry.id} to the queue` }) }} />}
      {editing && <EditEntry entry={editing} onClose={() => setEditing(null)} run={run} />}
      {tablePick && (
        <Modal title={`Allocate a table to ${tablePick.id}`} onClose={() => setTablePick(null)}>
          <p className="mb-3 text-sm text-slate-600">Party of {tablePick.partySize}. Only free tables that fit are shown. Tables are matched closely to the party so big tables are not wasted.</p>
          <div className="space-y-2">
            {free.filter((t) => t.capacity >= tablePick.partySize).sort((a, b) => a.capacity - b.capacity).map((t) => (
              <button key={t.id} className="card flex w-full items-center justify-between p-3 text-left hover:border-brand-500" onClick={() => { run('allocateTable', { entryId: tablePick.id, tableId: t.id }, `${t.id} allocated to ${tablePick.id}. Customer notified.`); setTablePick(null) }}>
                <span className="font-bold">{t.id} · {t.capacity} seats · {t.zone}</span>
                <span className="text-xs text-slate-500">{t.capacity - tablePick.partySize} spare</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {walkIn && <WalkIn table={walkIn} onClose={() => setWalkIn(null)} run={run} />}
      {qr && <Modal title={`Personal QR for ${qr.id}`} onClose={() => setQr(null)}><QueueQr secret={qr.secret} expiresAt={qr.expiresAt} /></Modal>}
      {showSms && <SmsLog onClose={() => setShowSms(false)} />}
    </DashboardShell>
  )
}

function AddCustomer({ onClose, onDone }) {
  const { state, act } = useStore()
  const [phone, setPhone] = useState('')
  const [party, setParty] = useState(2)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const preview = predictWait(state, { partySize: Number(party) || 1 }, Date.now())
  return (
    <Modal title="Add customer manually" onClose={onClose}>
      <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const r = await act('joinQueue', { phone, partySize: party, name, source: 'staff' }); r.ok ? onDone(r) : setError(r.error) }}>
        <Field label="Mobile number"><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" placeholder="98765 43210" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Party size"><input className="input" type="number" min={1} value={party} onChange={(e) => setParty(e.target.value)} /></Field>
          <Field label="Name (optional)"><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></Field>
        </div>
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm">Estimated wait: <b>{preview.possible ? `${preview.waitMin} min` : 'no table fits'}</b> {preview.confidence && <Confidence level={preview.confidence} />}</div>
        {error && <Notice tone="bad">{error}</Notice>}
        <button className="btn-primary w-full"><Plus size={16} /> Add to queue</button>
      </form>
    </Modal>
  )
}

function EditEntry({ entry, onClose, run }) {
  const { state } = useStore()
  const [party, setParty] = useState(entry.partySize)
  const [minutes, setMinutes] = useState('')
  const order = state.orders.find((o) => o.queueEntryId === entry.id && o.paymentStatus === 'paid' && o.status !== 'cancelled')
  return (
    <Modal title={`Edit ${entry.id}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="Party size"><input className="input" type="number" min={1} value={party} onChange={(e) => setParty(e.target.value)} /></Field></div>
          <button className="btn-primary" onClick={async () => { const r = await run('updateEntry', { entryId: entry.id, partySize: party }, 'Party size updated'); if (r.ok) onClose() }}>Save</button>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1"><Field label="Change estimated seating time" hint="Minutes from now. Pre-order dishes are rescheduled automatically."><input className="input" type="number" min={0} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="e.g. 25" /></Field></div>
          <button className="btn-primary" disabled={minutes === ''} onClick={async () => { const r = await run('updateEntry', { entryId: entry.id, manualSeatAt: Date.now() + Number(minutes) * MIN }, `Seating time set to ${fmtTime(Date.now() + Number(minutes) * MIN)}${order ? '. Kitchen schedule recalculated.' : ''}`); if (r.ok) onClose() }}>Set</button>
        </div>
        {entry.manualSeatAt && <button className="btn-ghost w-full" onClick={() => { run('updateEntry', { entryId: entry.id, clearManualSeat: true }, 'Back to automatic prediction'); onClose() }}>Use automatic prediction again</button>}
        <button className="btn-ghost w-full" onClick={() => { run('updateEntry', { entryId: entry.id, bumpPriority: true }, `${entry.id} moved to the front (priority)`); onClose() }}><Star size={14} /> Give priority (move to front)</button>
      </div>
    </Modal>
  )
}

function WalkIn({ table, onClose, run }) {
  const [party, setParty] = useState(2)
  return (
    <Modal title={`Seat a walk-in at ${table.id}`} onClose={onClose}>
      <Field label={`Party size (max ${table.capacity})`}><input className="input" type="number" min={1} max={table.capacity} value={party} onChange={(e) => setParty(e.target.value)} /></Field>
      <button className="btn-primary mt-3 w-full" onClick={async () => { const r = await run('seatWalkIn', { tableId: table.id, partySize: party }, `${table.id} seated`); if (r.ok) onClose() }}>Seat now</button>
    </Modal>
  )
}

function SmsLog({ onClose }) {
  const { state } = useStore()
  return (
    <Modal title="Customer notifications" onClose={onClose} wide>
      <Notice tone="info">These notices appear live on each customer’s own queue page. DineFlow does not send SMS.</Notice>
      <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
        {state.notifications.slice(0, 40).map((n) => (
          <div key={n.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{fmtTime(n.createdAt)}</span>{n.entryId && <span>{n.entryId}</span>}<span>{n.kind.replace(/_/g, ' ')}</span>
            </div>
            {n.body}
          </div>
        ))}
        {!state.notifications.length && <Empty>No notifications yet.</Empty>}
      </div>
    </Modal>
  )
}
